import { beforeEach, describe, expect, it, vi } from 'vitest';

const announcements = vi.hoisted(() => vi.fn());

vi.mock('./vrccApi', () => ({
    vrccApi: { announcements }
}));

import {
    ANNOUNCEMENTS_TTL_MS,
    isAnnouncementCacheFresh,
    useVrccAnnouncementCache
} from './vrccAnnouncementCache';
import { loadAnnouncements } from './vrccAnnouncementLoader';

/**
 * 公告的共享缓存与并发去重。
 *
 * 钉住的是一个**真实的浪费**：同一个响应以前被两个地方各拉一次
 * （登录后的全局宿主、进页面时的 controller），而第一次只用 `force`、
 * `pop`/`bar` 全被丢弃。更糟的是 `min_gap: 30s` 遇上 `MAX_ACQUIRE_WAIT: 10s`，
 * 登录后 30 秒内进页面，第二次请求会直接得到 `ThrottledLocally`。
 */
describe('loadAnnouncements', () => {
    beforeEach(() => {
        announcements.mockReset();
        useVrccAnnouncementCache.getState().invalidate();
        useVrccAnnouncementCache.getState().setInFlight(null);
    });

    it('首次调用发请求，第二次在有效期内复用缓存', async () => {
        announcements.mockResolvedValue({ posts: [], stop: null });

        await loadAnnouncements();
        await loadAnnouncements();

        // 只发一次：这是「两个消费点合成一次请求」的核心。
        expect(announcements).toHaveBeenCalledTimes(1);
    });

    it('缓存过期后重新拉', async () => {
        announcements.mockResolvedValue({ posts: [], stop: null });
        await loadAnnouncements();

        // 手动把时间推到有效期之外，避免用 fake timer 折腾 Date.now。
        useVrccAnnouncementCache
            .getState()
            .setData(
                { posts: [], stop: null },
                Date.now() - ANNOUNCEMENTS_TTL_MS - 1
            );

        await loadAnnouncements();
        expect(announcements).toHaveBeenCalledTimes(2);
    });

    it('并发调用只发一次请求', async () => {
        let resolve: (value: unknown) => void = () => {};
        announcements.mockReturnValue(
            new Promise((r) => {
                resolve = r;
            })
        );

        // 两个消费点几乎同时挂载——这正是真实场景。
        const first = loadAnnouncements();
        const second = loadAnnouncements();

        resolve({ posts: [], stop: null });
        await Promise.all([first, second]);

        expect(announcements).toHaveBeenCalledTimes(1);
    });

    it('force 绕开缓存', async () => {
        announcements.mockResolvedValue({ posts: [], stop: null });
        await loadAnnouncements();

        await loadAnnouncements({ force: true });
        expect(announcements).toHaveBeenCalledTimes(2);
    });

    it('失败不写缓存，下一次还会重试', async () => {
        announcements.mockRejectedValue(new Error('network down'));
        await expect(loadAnnouncements()).rejects.toThrow();

        // 缓存仍是「从没拉过」。
        expect(useVrccAnnouncementCache.getState().fetchedAt).toBeNull();

        announcements.mockResolvedValue({ posts: [], stop: null });
        await loadAnnouncements();
        expect(announcements).toHaveBeenCalledTimes(2);
    });

    it('接口不存在（null）也算有效结论，一分钟内不重试', async () => {
        // 旧服务器没这个接口时 Rust 侧返回 None。把它当成失败的话，
        // 每次进页面都会重试一个永远 404 的接口。
        announcements.mockResolvedValue(null);

        await loadAnnouncements();
        await loadAnnouncements();

        expect(announcements).toHaveBeenCalledTimes(1);
    });

    it('失败后清掉 inFlight，不会让后续调用永远等一个结束的 promise', async () => {
        announcements.mockRejectedValueOnce(new Error('boom'));
        await expect(loadAnnouncements()).rejects.toThrow();

        expect(useVrccAnnouncementCache.getState().inFlight).toBeNull();
    });
});

describe('isAnnouncementCacheFresh', () => {
    it('没拉过就不新鲜', () => {
        expect(isAnnouncementCacheFresh(null)).toBe(false);
    });

    it('1 分钟内新鲜，超过就不新鲜', () => {
        const now = 1_000_000;
        expect(isAnnouncementCacheFresh(now - 30_000, now)).toBe(true);
        expect(isAnnouncementCacheFresh(now - 61_000, now)).toBe(false);
    });

    it('时钟回拨时按过期处理', () => {
        // 改系统时间或休眠唤醒会让 now < fetchedAt。用一份不知真假的缓存
        // 比重拉一次危险，所以这里判过期。
        expect(isAnnouncementCacheFresh(1_000_000, 900_000)).toBe(false);
    });
});
