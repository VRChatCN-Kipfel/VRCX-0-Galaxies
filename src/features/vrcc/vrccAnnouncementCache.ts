import { create } from 'zustand';

import type { VrccAnnouncements } from './vrccApi';

/**
 * 公告数据的共享缓存。
 *
 * ## 为什么需要它
 *
 * 同一个 `GET /announcements` 响应被两个地方各自拉了一遍：
 *
 * | 调用点 | 时机 | 消费什么 |
 * |---|---|---|
 * | `VrccAnnouncementHost` | VRChat 登录后 | `force` |
 * | `useVrccController` | 进入星遇同频页 | `pop` + `bar` |
 *
 * 两个问题：
 *
 * 1. **一次响应被丢掉一半**。`selectPendingAnnouncements` 的 `scope: 'global'`
 *    会把 `pop`/`bar` 全部 `continue` 掉，`scope: 'page'` 又把 `force` 跳过。
 *    于是同一份数据拉两次、各用一部分。
 * 2. **会被自己的限流误伤**。`announcements` 的 `min_gap` 是 30 秒，而
 *    `MAX_ACQUIRE_WAIT` 只有 10 秒——登录后 30 秒内进页面，第二次请求直接
 *    得到 `ThrottledLocally`，`pop` 就拉不到了。首次引导恰好容易撞上这个窗口
 *    （登录 → 导览自动弹 → 走到第 4 步进页面）。
 *
 * 所以改成**拉一次、存这里、两处都读这份**。
 *
 * ## 缓存时长为什么是 1 分钟
 *
 * 与 `min_gap: 30s` 是**两件事**，不要混：
 * - `min_gap` 是**下限**（两次请求至少隔多久），服务端限流策略；
 * - 缓存是**上限**（多久内可以复用），由数据变化快慢决定。
 *
 * 公告虽然「大约两周一条」，但 `force` 是须知（停站、条款变更），晚一分钟
 * 看到还可以接受，晚五分钟就偏久了。1 分钟同时也远大于一次页面挂载到
 * 另一个消费点读数据的间隔，足以把两次请求合成一次。
 *
 * ## 什么时候强制刷新
 *
 * `force` 被确认后立即失效：玩家刚表态，下一次进页面应当重新拉，避免
 * 一分钟后才看到新的停站通知。
 */

/** 缓存有效期：1 分钟。 */
export const ANNOUNCEMENTS_TTL_MS = 60_000;

type AnnouncementCacheState = {
    /**
     * 最近一次拿到的响应。
     *
     * `null` 有两种含义，靠 `fetchedAt` 区分：
     * - `fetchedAt === null`：从没拉过；
     * - `fetchedAt !== null && data === null`：拉过了，但服务端没有这个接口
     *   （旧版本返回 404，Rust 侧归成 `None`）。这是**有效结论**，
     *   一分钟内不必重试。
     */
    data: VrccAnnouncements | null;
    /** 拉取完成时刻（`Date.now()`）。`null` 表示从没拉过。 */
    fetchedAt: number | null;
    /** 正在拉取中：并发的第二次调用直接等这一次，不再发请求。 */
    inFlight: Promise<VrccAnnouncements | null> | null;
    setData: (data: VrccAnnouncements | null, at: number) => void;
    setInFlight: (promise: Promise<VrccAnnouncements | null> | null) => void;
    /** 清空缓存，下一次读会重新拉。 */
    invalidate: () => void;
};

export const useVrccAnnouncementCache = create<AnnouncementCacheState>(
    (set) => ({
        data: null,
        fetchedAt: null,
        inFlight: null,
        setData: (data, at) => set({ data, fetchedAt: at }),
        setInFlight: (promise) => set({ inFlight: promise }),
        invalidate: () => set({ data: null, fetchedAt: null })
    })
);

/** 缓存是否还能用。 */
export function isAnnouncementCacheFresh(
    fetchedAt: number | null,
    now: number = Date.now()
): boolean {
    if (fetchedAt === null) return false;
    // 时钟回拨（改系统时间、休眠唤醒）会让 `now - fetchedAt` 变成负数，
    // 那种情况当作过期，重新拉一次比用一份不知真假的缓存安全。
    const age = now - fetchedAt;
    if (age < 0) return false;
    return age < ANNOUNCEMENTS_TTL_MS;
}
