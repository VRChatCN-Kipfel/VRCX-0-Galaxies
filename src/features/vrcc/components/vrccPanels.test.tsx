// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-i18next')>();
    return {
        ...actual,
        useTranslation: () => ({ t: (key: string) => key })
    };
});

vi.mock('@/lib/dateTime', () => ({
    formatRelativeTime: () => 'now'
}));

/**
 * 好友表由每个用例自己决定。默认「就绪但空」——三态标签会显示「加好友」，
 * 和真实玩家没加过这些人的情况一致。
 */
const presenceState = {
    ready: true,
    online: new Set<string>()
};

vi.mock('../useMutualPresence', () => ({
    useMutualPresence: () => ({
        ready: presenceState.ready,
        of: (userId: string | null | undefined) => {
            const id = (userId ?? '').trim();
            if (!id) return 'unknown';
            return presenceState.online.has(id) ? 'online' : 'unknown';
        }
    })
}));

import type { VrccCrossingStar, VrccStarCard } from '../vrccApi';
import { VrccCrossingsPanel } from './VrccCrossingsPanel';
import { VrccMapsPanel } from './VrccMapsPanel';
import { VrccMutualsPanel } from './VrccMutualsPanel';
import { VrccNotificationsPanel } from './VrccNotificationsPanel';

afterEach(() => {
    cleanup();
    presenceState.ready = true;
    presenceState.online.clear();
});

function renderCrossings(
    crossings: {
        why?: string | null;
        hidden?: boolean;
        stars?: VrccCrossingStar[];
    } | null,
    options: {
        loading?: boolean;
        error?: string | null;
        needsScope?: boolean;
        /** 完整星卡；缺省为 null，等同于旧服务器 / 没有完整权限。 */
        cards?: { cards: VrccStarCard[]; left?: number; max?: number } | null;
    } = {}
) {
    const { container } = render(
        <VrccCrossingsPanel
            connected
            crossings={
                crossings
                    ? {
                          stars: [],
                          n: 0,
                          why: null,
                          hidden: false,
                          me: null,
                          ...crossings
                      }
                    : null
            }
            cards={options.cards ?? null}
            loading={options.loading ?? false}
            crossingsError={options.error ?? null}
            crossingsNeedsScope={options.needsScope ?? false}
            onOpenLink={() => {}}
            onRefresh={() => {}}
        />
    );
    return container;
}

describe('VrccCrossingsPanel', () => {
    it('hidden 时整块都不渲染，连「不可用」也不说', () => {
        // 官方要求 `hide` 时客户端不显示此模块。把 `hide` 当成普通空列表，
        // 等于向不该看到的人确认「这里有星轨相交」这个事实本身——所以这里
        // 断言的是**一片空白**，不是某段文案。
        const container = renderCrossings({ why: 'hide', hidden: true });
        expect(container.innerHTML).toBe('');
    });

    it('其余 why 要显示原因，而不是把功能藏掉', () => {
        // `verify` / `friend` 这些是「功能在但暂时用不了」，玩家需要知道
        // 下一步做什么。藏起来会让人以为功能消失了。
        renderCrossings({ why: 'verify', hidden: false });
        expect(screen.getByText('vrcc.crossings.why.verify')).toBeTruthy();
    });

    it('有旧记录时也要说原因，不能只在列表为空时才提', () => {
        // `queued` / `sent` / `gone` / `friend` 这几种前置没满足时，历史记录
        // 照样留在 `stars` 里，服务端只是不再产生新的。只在空列表时提示，
        // 等于让玩家看着一屏旧记录以为一切照常。
        renderCrossings({
            why: 'friend',
            hidden: false,
            stars: [{ n: 9, name: '旧记录' }]
        });
        expect(screen.getByText('vrcc.crossings.why.friend')).toBeTruthy();
        expect(screen.getByText('旧记录')).toBeTruthy();
    });

    it('卡上带「在哪遇见」时，行里补一行世界名与时间', () => {
        // 「在哪个世界擦肩」只有 `/me/crossings/cards` 的 `pair.met.world`
        // 有，列表端点里完全没有这个字段。所以这一行必须靠卡片补。
        const container = renderCrossings(
            { stars: [{ n: 5, name: '旧记录' }] },
            {
                cards: {
                    cards: [
                        {
                            n: 5,
                            pair: {
                                at: 1792778779575,
                                src: 'yq',
                                met: {
                                    at: 1792900800000,
                                    world: '天井 Skywell｜中文社区 Chinese Community'
                                }
                            }
                        }
                    ],
                    left: 5,
                    max: 5
                }
            }
        );
        // 这里的 `t` 只回显键名、`formatRelativeTime` 恒为 now，所以断言键名
        // 和拼接出来的时间即可；世界名本身由 title 带着。
        const text = container.textContent ?? '';
        expect(text).toContain('vrcc.crossings.met_world');
        expect(text).toContain('· now');
    });

    it('没有完整星卡时不补那一行，列表照常显示', () => {
        const container = renderCrossings({
            stars: [{ n: 5, name: '旧记录' }]
        });
        const text = container.textContent ?? '';
        expect(text).toContain('旧记录');
        expect(text).not.toContain('vrcc.crossings.met_world');
    });

    it('卡片还在路上时先占住那一行，别让列表等会儿被顶下去', () => {
        // 列表和卡片是两个请求：列表先回来时整行已经渲染，「在哪遇见」还
        // 没有。这段空档如果不占高度，卡片一到整列会往下一跳。
        const container = renderCrossings(
            { stars: [{ n: 5, name: '旧记录' }] },
            { loading: true }
        );
        expect(container.querySelector('[role="status"]')).toBeTruthy();
    });

    it('请求结束后仍没有卡片就不占位，别留一条永远转圈的空行', () => {
        const container = renderCrossings(
            { stars: [{ n: 5, name: '旧记录' }] },
            { loading: false }
        );
        expect(container.querySelector('[role="status"]')).toBeNull();
    });

    it('服务器给没见过的 why 时退回 unknown，不拼键名', () => {
        // 原来的写法是 `t(`vrcc.crossings.why.${why}`)`——`why` 是服务器给的
        // 字符串，拼出来可能是 `constructor` / `__proto__` 这种本来就存在的
        // 对象属性，拿到的不是文案而是对象或 undefined，界面直接炸。
        // 现在只有白名单里的才拼键名，其余一律 unknown。
        renderCrossings({ why: 'brand-new-reason', hidden: false });
        expect(screen.getByText('vrcc.crossings.why.unknown')).toBeTruthy();
    });

    /**
     * 加载中不能说「还没有擦肩」。
     *
     * `crossings === null` 既可能是「还没拉」也可能是「拉失败了」，
     * 早先两者都落到空态分支，于是每次开页都先闪一下「还没有擦肩记录」，
     * 而失败时那句话干脆就是错的。
     */
    it('加载中说「加载中」，不说空态', () => {
        renderCrossings(null, { loading: true });
        expect(screen.getByText('vrcc.crossings.loading')).toBeTruthy();
        expect(screen.queryByText('vrcc.crossings.empty')).toBeNull();
    });

    it('失败且没有数据时说「没拿到」并给重试', () => {
        renderCrossings(null, { error: 'boom' });
        expect(screen.getByText('vrcc.crossings.load_failed')).toBeTruthy();
        expect(screen.getByText('vrcc.crossings.retry')).toBeTruthy();
        expect(screen.queryByText('vrcc.crossings.empty')).toBeNull();
    });

    /**
     * 缺权限是**永久性**的：引导重新授权，而不是让玩家反复点重试。
     */
    it('缺权限时说「不可用」并引导重连，不给重试按钮', () => {
        renderCrossings(null, { error: 'scope', needsScope: true });
        expect(screen.getByText('vrcc.crossings.unavailable')).toBeTruthy();
        expect(screen.getByText('vrcc.crossings.needs_scope')).toBeTruthy();
        expect(screen.queryByText('vrcc.crossings.retry')).toBeNull();
    });

    /** 确实拿到过响应且 `stars` 为空，才是空态。 */
    it('确实拿到空列表时才显示空态', () => {
        renderCrossings({ stars: [], hidden: false });
        expect(screen.getByText('vrcc.crossings.empty')).toBeTruthy();
    });

    /**
     * 有旧数据、这次刷新失败：**留着列表**，加一条提示，不要清成空态。
     */
    it('刷新失败但手上有旧数据时，保留列表并提示', () => {
        renderCrossings(
            { stars: [{ n: 5, name: '旧记录' }], hidden: false },
            { error: 'boom' }
        );
        expect(screen.getByText('旧记录')).toBeTruthy();
        expect(screen.getByText('vrcc.crossings.stale_hint')).toBeTruthy();
        expect(screen.queryByText('vrcc.crossings.empty')).toBeNull();
    });

    /**
     * `n` 缺失时不能拿 `0` 当 React key，也不能拼出 `?cross=0`。
     */
    it('缺编号的记录不给网页直达按钮，编号位显示占位', () => {
        renderCrossings({
            stars: [{ name: '甲' }, { name: '乙' }] as VrccCrossingStar[],
            hidden: false
        });
        // 两条都缺编号：都不该出现「打开网页」的按钮。
        expect(screen.queryByText('vrcc.crossings.open_page')).toBeNull();
        // 列表照常渲染两条。
        expect(screen.getByText('甲')).toBeTruthy();
        expect(screen.getByText('乙')).toBeTruthy();
    });

    it('没连接时提示先去连接', () => {
        render(
            <VrccCrossingsPanel
                connected={false}
                crossings={null}
                cards={null}
                loading={false}
                crossingsError={null}
                onOpenLink={() => {}}
                onRefresh={() => {}}
            />
        );
        expect(screen.getByText('vrcc.crossings.need_connect')).toBeTruthy();
    });
});

function renderNotifications(unread: {
    inbox?: number;
    cross?: number | null;
    chats?: number;
    notes?: number;
}) {
    render(
        <VrccNotificationsPanel
            connected
            recent={{ items: [], read: 0 }}
            unread={unread}
            view="recent"
            notes={null}
            notesSupported={null}
            onViewChange={() => {}}
            onConnect={() => {}}
            onOpenWorld={() => {}}
        />
    );
}

describe('VrccNotificationsPanel', () => {
    it('令牌没有 crossings 时不显示「星轨相交」，而不是显示 0', () => {
        renderNotifications({ inbox: 2, chats: 1, notes: 0 });
        expect(screen.getByText(/vrcc\.unread\.inbox/)).toBeTruthy();
        expect(screen.queryByText(/vrcc\.unread\.cross/)).toBeNull();
    });

    it('有 crossings 时照常显示，0 也显示', () => {
        renderNotifications({ inbox: 0, cross: 0, chats: 0, notes: 0 });
        expect(screen.getByText(/vrcc\.unread\.cross/)).toBeTruthy();
    });
});

describe('VrccMapsPanel', () => {
    const board = {
        board: 'maps',
        min: 1,
        at: 1,
        maps: [
            { world: 'wrld_a', name: 'A', rank: 7, week: 5 },
            { world: 'wrld_b', name: 'B', rank: 1, week: 2 }
        ]
    };

    function renderMaps(sort: 'top' | 'week') {
        render(
            <VrccMapsPanel
                boards={{ ...board, sort }}
                sort={sort}
                sortSupported
                onSortChange={() => {}}
                onRefresh={() => {}}
                onOpenWorld={() => {}}
            />
        );
    }

    it('本周榜按列表位置编号，不显示总榜名次', () => {
        // 本周榜只按本周的打分排，`rank` 还是总榜名次。
        renderMaps('week');
        expect(screen.queryByText('7')).toBeNull();
        expect(screen.getByText('2')).toBeTruthy();
    });

    it('总榜显示服务器给的名次', () => {
        renderMaps('top');
        expect(screen.getByText('7')).toBeTruthy();
    });
});

describe('VrccMutualsPanel', () => {
    function renderMutuals(stars: Array<Record<string, unknown>>) {
        render(
            <VrccMutualsPanel
                connected
                mutuals={{ stars } as never}
                onOpenUser={() => {}}
                onOpenGroup={() => {}}
            />
        );
    }

    it('有连上时间时显示它', () => {
        // `formatRelativeTime` 在本文件顶部被 mock 成固定返回 'now'。
        renderMutuals([{ n: 1, name: 'A', at: 1_700_000_000_000 }]);
        expect(screen.getByText('now')).toBeTruthy();
    });

    it('没有连上时间时整块不渲染，而不是留一个占位符', () => {
        renderMutuals([{ n: 2, name: 'B' }]);
        // 留「—」会让玩家以为记录丢了，所以这里应该是彻底没有这个节点。
        expect(screen.queryByText('now')).toBeNull();
    });

    it('四个有专属色的星群各上各的色', () => {
        const { container } = render(
            <VrccMutualsPanel
                connected
                mutuals={
                    {
                        stars: [
                            { n: 1, name: 'G', group: 'G' },
                            { n: 2, name: 'W', group: 'W' },
                            { n: 3, name: 'Z', group: 'Z' },
                            { n: 4, name: 'L', group: 'L' }
                        ]
                    } as never
                }
                onOpenUser={() => {}}
                onOpenGroup={() => {}}
            />
        );
        const dots = container.querySelectorAll('li > span[aria-hidden]');
        expect(dots).toHaveLength(4);
        const colors = Array.from(dots).map(
            (dot) => (dot as HTMLElement).style.backgroundColor
        );
        expect(colors).toEqual([
            'rgb(77, 180, 255)',
            'rgb(255, 181, 71)',
            'rgb(214, 155, 255)',
            'rgb(95, 224, 180)'
        ]);
    });

    it('万象（A）没有专属色，退回前景色而不是硬造一个', () => {
        const { container } = render(
            <VrccMutualsPanel
                connected
                mutuals={{ stars: [{ n: 5, name: 'A', group: 'A' }] } as never}
                onOpenUser={() => {}}
                onOpenGroup={() => {}}
            />
        );
        const dot = container.querySelector(
            'li > span[aria-hidden]'
        ) as HTMLElement;
        // 官方颜色表里没有 A，官方也用文字色，所以这里不该有内联底色。
        expect(dot.style.backgroundColor).toBe('');
    });

    it('在线的好友排到最前面，其余保持服务端顺序', () => {
        presenceState.online.add('usr_second');
        const { container } = render(
            <VrccMutualsPanel
                connected
                mutuals={
                    {
                        stars: [
                            { n: 1, name: 'first', vrcUser: 'usr_first' },
                            { n: 2, name: 'second', vrcUser: 'usr_second' },
                            { n: 3, name: 'third', vrcUser: 'usr_third' }
                        ]
                    } as never
                }
                onOpenUser={() => {}}
                onOpenGroup={() => {}}
            />
        );
        const names = Array.from(container.querySelectorAll('li')).map(
            (row) => row.textContent ?? ''
        );
        // 在线的 #2 提到最前；#1 和 #3 都不是好友，保持原顺序。
        expect(names[0]).toContain('second');
        expect(names[1]).toContain('first');
        expect(names[2]).toContain('third');
    });

    it('同状态之间保持服务端顺序，即使是十几条的大列表', () => {
        // 三个元素时怎么排都像对的——V8 对短数组用插入排序，天然稳定，
        // 上面那条用例因此证不了什么。这里用 13 条、交错两种状态，让
        // 「同状态被重新排序」有机会真的暴露出来。
        const stars = Array.from({ length: 13 }, (_, index) => ({
            n: index + 1,
            name: `star-${index + 1}`,
            vrcUser: `usr_${index + 1}`
        }));
        // 下标 0/3/6/9/12 在线，其余离线，交错排列。
        for (const index of [0, 3, 6, 9, 12]) {
            presenceState.online.add(`usr_${index + 1}`);
        }

        const { container } = render(
            <VrccMutualsPanel
                connected
                mutuals={{ stars } as never}
                onOpenUser={() => {}}
                onOpenGroup={() => {}}
            />
        );
        const names = Array.from(container.querySelectorAll('li')).map(
            (row) => row.textContent ?? ''
        );

        // 期望：先把在线的按原顺序排出来，再是离线的按原顺序。
        const onlineNames = [1, 4, 7, 10, 13].map((n) => `star-${n}`);
        const offlineNames = [2, 3, 5, 6, 8, 9, 11, 12].map((n) => `star-${n}`);
        const expected = [...onlineNames, ...offlineNames];

        expected.forEach((name, position) => {
            expect(names[position]).toContain(name);
        });
    });

    it('好友表没就绪时不显示三态标签', () => {
        presenceState.ready = false;
        const { container } = render(
            <VrccMutualsPanel
                connected
                mutuals={
                    {
                        stars: [{ n: 1, name: 'a', vrcUser: 'usr_a' }]
                    } as never
                }
                onOpenUser={() => {}}
                onOpenGroup={() => {}}
            />
        );
        // 没就绪时所有人都是 unknown，显示「加好友」会误导玩家。
        expect(container.textContent).not.toContain('vrcc.mutuals.presence.');
    });
});
