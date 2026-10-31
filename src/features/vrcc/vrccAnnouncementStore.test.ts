import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    markSeenId,
    markSeenIds,
    normalizeLevel,
    readBarCursor,
    readSeenIds,
    selectPendingAnnouncement,
    selectPendingAnnouncements,
    writeBarCursor
} from './vrccAnnouncementStore';
import type { VrccAnnouncement } from './vrccApi';

function post(
    id: number,
    level: string,
    extra: Partial<VrccAnnouncement> = {}
): VrccAnnouncement {
    return { id, level, title: `t${id}`, ...extra } as VrccAnnouncement;
}

beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
        getItem(key: string) {
            return store.get(key) ?? null;
        },
        setItem(key: string, value: string) {
            store.set(key, String(value));
        },
        removeItem(key: string) {
            store.delete(key);
        }
    });
});

describe('normalizeLevel', () => {
    it('认识的三种原样返回', () => {
        expect(normalizeLevel('bar')).toBe('bar');
        expect(normalizeLevel('pop')).toBe('pop');
        expect(normalizeLevel('force')).toBe('force');
    });

    it('未知值退到 bar，而不是 force', () => {
        // 反过来（未知→force）会让一条谁都没预料到的公告挡住玩家。
        expect(normalizeLevel('shiny-new')).toBe('bar');
        expect(normalizeLevel(null)).toBe('bar');
        expect(normalizeLevel(undefined)).toBe('bar');
    });
});

describe('selectPendingAnnouncement', () => {
    const seen = new Set<number>();

    it('全局作用域只挑 force，忽略 pop 与 bar', () => {
        const posts = [post(3, 'bar'), post(2, 'pop'), post(1, 'force')];
        const picked = selectPendingAnnouncement(posts, {
            barCursor: null,
            seenIds: seen,
            scope: 'global'
        });
        expect(picked?.id).toBe(1);
    });

    it('页内作用域跳过 force，免得同一份内容弹两次', () => {
        const posts = [post(2, 'force'), post(1, 'pop')];
        const picked = selectPendingAnnouncement(posts, {
            barCursor: null,
            seenIds: seen,
            scope: 'page'
        });
        expect(picked?.id).toBe(1);
    });

    it('已确认过的 pop 不再出现', () => {
        const posts = [post(1, 'pop')];
        expect(
            selectPendingAnnouncement(posts, {
                barCursor: null,
                seenIds: new Set([1]),
                scope: 'page'
            })
        ).toBeNull();
    });

    it('补发一条编号更小的公告仍然能看到', () => {
        // 这是水位线方案最致命的缺陷：旧的实现用一个数字游标，
        // 关掉 id 8 之后，站方补发 id 6 的更正永远不显示。
        const posts = [post(8, 'pop'), post(6, 'pop')];
        const picked = selectPendingAnnouncement(posts, {
            barCursor: null,
            seenIds: new Set([8]),
            scope: 'page'
        });
        expect(picked?.id).toBe(6);
    });

    it('bar 只在水位线之后才出现', () => {
        const posts = [post(5, 'bar')];
        expect(
            selectPendingAnnouncement(posts, {
                barCursor: 5,
                seenIds: seen,
                scope: 'page'
            })
        ).toBeNull();
        expect(
            selectPendingAnnouncement(posts, {
                barCursor: 4,
                seenIds: seen,
                scope: 'page'
            })?.id
        ).toBe(5);
    });

    it('不依赖服务端顺序，自己按 id 降序挑最新的', () => {
        const posts = [post(1, 'pop'), post(9, 'pop'), post(4, 'pop')];
        const picked = selectPendingAnnouncement(posts, {
            barCursor: null,
            seenIds: seen,
            scope: 'page'
        });
        expect(picked?.id).toBe(9);
    });

    it('空列表与 null 都返回 null', () => {
        const base = { barCursor: null, seenIds: seen, scope: 'page' as const };
        expect(selectPendingAnnouncement([], base)).toBeNull();
        expect(selectPendingAnnouncement(null, base)).toBeNull();
        expect(selectPendingAnnouncement(undefined, base)).toBeNull();
    });

    it('id 非正的条目直接跳过', () => {
        const posts = [post(0, 'pop'), post(-1, 'force')];
        const base = { barCursor: null, seenIds: seen, scope: 'page' as const };
        expect(selectPendingAnnouncement(posts, base)).toBeNull();
    });
});

describe('存盘', () => {
    it('bar 水位线只增不减', () => {
        writeBarCursor(5);
        expect(readBarCursor()).toBe(5);
        // 回头关掉一条更旧的，不该把水位线拉回去。
        writeBarCursor(3);
        expect(readBarCursor()).toBe(5);
        writeBarCursor(9);
        expect(readBarCursor()).toBe(9);
    });

    it('pop/force 的已读是一个 id 集合，互不覆盖', () => {
        markSeenId(8);
        markSeenId(6);
        const ids = readSeenIds();
        expect(ids.has(8)).toBe(true);
        expect(ids.has(6)).toBe(true);
        expect(ids.size).toBe(2);
    });

    it('重复标记同一个 id 不会让集合变大', () => {
        markSeenId(8);
        markSeenId(8);
        expect(readSeenIds().size).toBe(1);
    });

    it('非法 id 被忽略', () => {
        markSeenId(0);
        markSeenId(-3);
        markSeenId(Number.NaN);
        expect(readSeenIds().size).toBe(0);
    });

    it('localStorage 里存了坏数据时不炸', () => {
        localStorage.setItem('vrcc.announcement.seenIds', 'not-json');
        expect(readSeenIds().size).toBe(0);
        localStorage.setItem('vrcc.announcement.barCursor', 'abc');
        expect(readBarCursor()).toBeNull();
    });
});

describe('selectPendingAnnouncements（序列）', () => {
    const base = { barCursor: null, seenIds: new Set<number>() };

    it('返回整个未读序列，按 id 升序（旧的在前，最新的最后读）', () => {
        const posts = [post(1, 'pop'), post(3, 'pop'), post(2, 'pop')];
        const seq = selectPendingAnnouncements(posts, {
            ...base,
            scope: 'page'
        });
        expect(seq.map((p) => p.id)).toEqual([1, 2, 3]);
    });

    it('已读的从序列里消失，剩下的还能继续翻', () => {
        const posts = [post(1, 'pop'), post(2, 'pop'), post(3, 'pop')];
        const seq = selectPendingAnnouncements(posts, {
            ...base,
            seenIds: new Set([3]),
            scope: 'page'
        });
        expect(seq.map((p) => p.id)).toEqual([1, 2]);
    });

    it('全局与页内是两套互不干扰的序列', () => {
        const posts = [
            post(1, 'force'),
            post(2, 'pop'),
            post(3, 'bar'),
            post(4, 'force')
        ];
        expect(
            selectPendingAnnouncements(posts, { ...base, scope: 'global' }).map(
                (p) => p.id
            )
        ).toEqual([1, 4]);
        expect(
            selectPendingAnnouncements(posts, { ...base, scope: 'page' }).map(
                (p) => p.id
            )
        ).toEqual([2, 3]);
    });

    it('空输入得到空序列而不是 null', () => {
        expect(
            selectPendingAnnouncements([], { ...base, scope: 'page' })
        ).toEqual([]);
        expect(
            selectPendingAnnouncements(null, { ...base, scope: 'page' })
        ).toEqual([]);
    });
});

describe('selectPendingAnnouncement（单条）', () => {
    const base = { barCursor: null, seenIds: new Set<number>() };

    it('取最新的一条，不是最旧的', () => {
        // 序列按 id 升序（旧→新），所以单条提示要取末尾。
        // 页顶 tips 说「最新发生了什么」，取到最旧的那条就没意义了。
        const posts = [post(5, 'bar'), post(9, 'bar'), post(7, 'bar')];
        expect(
            selectPendingAnnouncement(posts, { ...base, scope: 'page' })?.id
        ).toBe(9);
    });

    it('没有可显示的时候是 null', () => {
        expect(
            selectPendingAnnouncement([], { ...base, scope: 'page' })
        ).toBeNull();
    });
});

describe('markSeenIds（跳过全部）', () => {
    it('一次标记多条', () => {
        markSeenIds([1, 2, 3]);
        const ids = readSeenIds();
        expect([...ids].sort((a, b) => a - b)).toEqual([1, 2, 3]);
    });

    it('已看过的不重复写，未看的一并标掉', () => {
        markSeenId(9);
        markSeenIds([9, 8, 7]);
        const ids = readSeenIds();
        expect(ids.size).toBe(3);
        expect(ids.has(9)).toBe(true);
        expect(ids.has(8)).toBe(true);
        expect(ids.has(7)).toBe(true);
    });

    it('混入非法 id 时只处理合法的', () => {
        markSeenIds([1, 0, -2, Number.NaN, 2]);
        expect(readSeenIds().size).toBe(2);
    });

    it('空数组不写任何东西', () => {
        markSeenIds([]);
        expect(readSeenIds().size).toBe(0);
    });
});
