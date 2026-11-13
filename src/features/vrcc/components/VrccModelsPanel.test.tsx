// SPDX-License-Identifier: MPL-2.0
// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-i18next')>();
    return {
        ...actual,
        // 带上参数，否则 `week_count` 里的 `{count}` 无处可验。
        useTranslation: () => ({
            t: (key: string, vars?: Record<string, unknown>) =>
                vars ? `${key}:${JSON.stringify(vars)}` : key
        })
    };
});

const openLink = vi.hoisted(() => vi.fn());
vi.mock('../useOpenExternalLink', () => ({
    useOpenExternalLink: () => ({ open: openLink, pending: false })
}));

// 评论对话框会调 `vrccApi.model`。这里整体替换掉 API 层，避免真发 IPC：
// `commands` 在测试环境里根本不存在，未 mock 时拿到的是 undefined。
const apiModel = vi.hoisted(() => vi.fn());
vi.mock('../vrccApi', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../vrccApi')>();
    return {
        ...actual,
        vrccApi: { ...actual.vrccApi, model: apiModel }
    };
});

import type { VrccBoardModel, VrccModelBoard } from '../vrccApi';
import { VrccModelsPanel } from './VrccModelsPanel';

/**
 * jsdom 没有 `IntersectionObserver`，也没有 `matchMedia`。
 *
 * 面板用 `IntersectionObserver` 判断「这一行要不要挂封面图」（和地图榜同一套
 * `useVrccRowVisibility`），`matchMedia` 则是主题/动效偏好那条链路上的常见
 * 依赖。缺了会在 effect 里抛 `ReferenceError`。
 *
 * 桩只装在本文件里，不动 `src/test/setup.ts`——那是全局的，为 600 多个既有
 * 测试改它风险太大。`isIntersecting` 恒为 false 是有意的：测试只关心 DOM
 * 内容，不需要真的触发懒加载。
 */
function installDomMotionStubs() {
    class NoopIntersectionObserver {
        readonly root = null;
        readonly rootMargin = '';
        readonly thresholds: readonly number[] = [];
        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() {
            return [];
        }
    }
    vi.stubGlobal('IntersectionObserver', NoopIntersectionObserver);
    vi.stubGlobal(
        'matchMedia',
        vi.fn(() => ({
            matches: false,
            media: '',
            onchange: null,
            addListener: () => {},
            removeListener: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => false
        }))
    );
}

beforeEach(installDomMotionStubs);

beforeEach(() => {
    // 默认：这个模型不在榜上（后端把 404 收敛成了 null）。
    // 需要热评的用例自己铺 `mockResolvedValueOnce`。
    apiModel.mockReset();
    apiModel.mockResolvedValue(null);
});

afterEach(() => {
    cleanup();
    openLink.mockClear();
    vi.unstubAllGlobals();
});

function model(overrides: Partial<VrccBoardModel> = {}): VrccBoardModel {
    return {
        id: 8962830,
        name: 'オリジナル3Dモデル「星」',
        short: '星',
        shop: '星屋',
        price: '¥1,500',
        likes: 42,
        week: null,
        rank: 1,
        page: 'https://vrcc.cc/models/8962830',
        img: 'https://booth.pximg.net/example.jpg',
        booth: 'https://booth.pm/ja/items/8962830',
        hot: null,
        place: null,
        move: null,
        fresh: null,
        ...overrides
    };
}

function board(
    models: VrccBoardModel[],
    overrides: Partial<VrccModelBoard> = {}
): VrccModelBoard {
    return {
        board: 'models',
        sort: 'top',
        total: models.length,
        next: null,
        weeks: [],
        w: null,
        at: 1,
        models,
        ...overrides
    };
}

function renderPanel(
    props: Partial<Parameters<typeof VrccModelsPanel>[0]> = {}
) {
    return render(
        <VrccModelsPanel
            models={board([])}
            sort="top"
            sortSupported
            available
            onSortChange={() => {}}
            onRefresh={() => {}}
            {...props}
        />
    );
}

describe('VrccModelsPanel', () => {
    it('有简称时显示简称，没有才退回 BOOTH 原文', () => {
        renderPanel({
            models: board([
                model({ id: 1, short: '星', name: 'オリジナル3Dモデル「星」' }),
                model({ id: 2, short: '   ', name: '素体モデル' })
            ])
        });

        expect(screen.getByText('星')).toBeTruthy();
        expect(screen.getByText('素体モデル')).toBeTruthy();
        expect(screen.queryByText('オリジナル3Dモデル「星」')).toBeNull();
    });

    it('价格原样显示，不解析成数字', () => {
        // 「無料」「￥1,500〜」这类写法解析成数字只会显示错价，
        // 所以组件只负责把原文摆出来。
        renderPanel({
            models: board([model({ id: 3, price: '￥1,500〜' })])
        });

        expect(screen.getByText('￥1,500〜')).toBeTruthy();
    });

    it('有热评时显示热评和出处，没有才显示店铺', () => {
        renderPanel({
            models: board([
                model({
                    id: 4,
                    hot: {
                        text: '表情很多，换装方便',
                        by: '某位彩蛋猎人',
                        up: 3
                    }
                }),
                model({ id: 5, hot: null, shop: '星屋' })
            ])
        });

        expect(
            screen.getByText('「表情很多，换装方便」 · 某位彩蛋猎人')
        ).toBeTruthy();
        expect(screen.getByText('星屋')).toBeTruthy();
    });

    it('本周榜用 place 当名次，并显示本周几个喜欢', () => {
        // 本周榜只按本周的喜欢排，`rank` 仍是总榜名次；本周名次是 `place`。
        renderPanel({
            sort: 'week',
            models: board(
                [
                    model({ id: 6, rank: 9, place: 1, week: 5 }),
                    model({ id: 7, rank: 1, place: 2, week: 2 })
                ],
                { sort: 'week' }
            )
        });

        // 第一行的 rank 是 9，若错用 rank 会显示 9 而不是 1。
        expect(screen.getByText('1')).toBeTruthy();
        expect(
            screen.getByText('vrcc.models.week_count:{"count":2}')
        ).toBeTruthy();
    });

    it('place 缺失时本周名次退回列表位置', () => {
        renderPanel({
            sort: 'week',
            models: board(
                [
                    model({ id: 8, rank: 9, place: null, week: 1 }),
                    model({ id: 9, rank: 3, place: null, week: 1 })
                ],
                { sort: 'week' }
            )
        });

        // 第一行该显示 1、第二行 2（列表位置），而不是总榜名次 9 / 3。
        expect(screen.getByText('2')).toBeTruthy();
        expect(screen.queryByText('9')).toBeNull();
        expect(screen.queryByText('3')).toBeNull();
    });

    it('旧服务器上不显示排序切换，也不用转圈骗玩家', () => {
        // 「这台服务器还没有模型榜」和「正在加载」是两件事：
        // 后者会转一个永远不会停的圈。
        const { container } = renderPanel({ available: false, models: null });

        expect(screen.getByText('vrcc.models.unavailable')).toBeTruthy();
        expect(screen.queryByText('vrcc.models.empty')).toBeNull();
        expect(container.querySelector('.animate-spin')).toBeNull();
    });

    it('服务器认 sort 时才显示切换组', () => {
        const { container: withSort } = renderPanel({ sortSupported: true });
        expect(withSort.textContent).toContain('vrcc.models.sort.week');
        cleanup();
        const { container: withoutSort } = renderPanel({
            sortSupported: false
        });
        expect(withoutSort.textContent).not.toContain('vrcc.models.sort.week');
    });

    it('点排序时把值报给上层', async () => {
        const onSortChange = vi.fn();
        renderPanel({ onSortChange });

        await userEvent.click(screen.getByText('vrcc.models.sort.week'));

        expect(onSortChange).toHaveBeenCalledWith('week');
    });

    it('点整行走 app__open_link 打开外链', async () => {
        // WebView 里 `target=_blank` 什么都不做，必须走 app__open_link。
        renderPanel({
            models: board([
                model({
                    id: 10,
                    short: '星',
                    page: 'https://vrcc.cc/models/10'
                })
            ])
        });

        // 外链按钮和「点整行看评论」是两个不同的动作：前者去网页，
        // 后者在客户端里看热评。这里点的是前者。
        await userEvent.click(
            screen.getByRole('button', { name: 'vrcc.models.open' })
        );

        expect(openLink).toHaveBeenCalledWith('https://vrcc.cc/models/10');
    });

    it('没有公开页时外链回退到按 id 拼的星遇地址', async () => {
        // `page` 是可选的：缺了也不能给一个打不开的空链接。
        renderPanel({
            models: board([model({ id: 11, short: '无页', page: null })])
        });

        await userEvent.click(
            screen.getByRole('button', { name: 'vrcc.models.open' })
        );

        expect(openLink).toHaveBeenCalledWith('https://vrcc.cc/models/11');
    });

    it('点整行打开评论对话框，而不是跳网页', async () => {
        renderPanel({
            models: board([model({ id: 12, short: '星', page: null })])
        });

        await userEvent.click(
            screen.getByRole('button', { name: 'vrcc.models.comments: 星' })
        );

        // 对话框出现，并且说明了「只有热评」这个接口边界。
        expect(
            await screen.findByText('vrcc.models.hot_comments')
        ).toBeTruthy();
        expect(openLink).not.toHaveBeenCalled();
    });

    it('对话框显示拿到的热评和点赞数', async () => {
        apiModel.mockResolvedValueOnce({
            model: null,
            at: 1,
            hots: [
                { text: '表情很多，换装方便', by: '某位彩蛋猎人', up: 3 },
                { text: '换装方便', by: '某位星语者', up: 2 }
            ]
        });

        renderPanel({
            models: board([model({ id: 13, short: '星', page: null })])
        });

        await userEvent.click(
            screen.getByRole('button', { name: 'vrcc.models.comments: 星' })
        );

        expect(await screen.findByText('表情很多，换装方便')).toBeTruthy();
        expect(screen.getByText('某位彩蛋猎人')).toBeTruthy();
        expect(screen.getByText('3')).toBeTruthy();
        expect(screen.getByText('换装方便')).toBeTruthy();
    });

    it('模型不在榜上时说明原因，而不是当成错误', async () => {
        // 后端把 `404 not_found` 收敛成 null，对话框要说清「已不在榜上」。
        apiModel.mockResolvedValueOnce(null);

        renderPanel({
            models: board([model({ id: 14, short: '星', page: null })])
        });

        await userEvent.click(
            screen.getByRole('button', { name: 'vrcc.models.comments: 星' })
        );

        expect(
            await screen.findByText('vrcc.models.comments_gone')
        ).toBeTruthy();
    });

    it('空榜显示空态而不是「没有这个接口」', () => {
        renderPanel({ models: board([]), available: true });

        expect(screen.getByText('vrcc.models.empty')).toBeTruthy();
        expect(screen.queryByText('vrcc.models.unavailable')).toBeNull();
    });

    it('重复打开同一个模型不会重新请求', async () => {
        // 点开 → 关掉 → 再点开是很常见的动作。每次都走 IPC 会先转一下圈，
        // 手感是「慢」。第二、三次必须直接命中缓存。
        apiModel.mockResolvedValue({
            model: null,
            at: 1,
            hots: [{ text: '表情很多', by: '某位彩蛋猎人', up: 3 }]
        });

        renderPanel({
            models: board([model({ id: 30, short: '缓存', page: null })])
        });

        const openRow = () =>
            screen.getByRole('button', {
                name: 'vrcc.models.comments: 缓存'
            });

        await userEvent.click(openRow());
        expect(await screen.findByText('表情很多')).toBeTruthy();
        expect(apiModel).toHaveBeenCalledTimes(1);

        // 关掉再开：Esc 走 `onOpenChange(false)`，即关闭。
        await userEvent.keyboard('{Escape}');
        await userEvent.click(openRow());

        expect(screen.getByText('表情很多')).toBeTruthy();
        expect(apiModel).toHaveBeenCalledTimes(1);
    });

    it('不在榜上的结果不缓存：下次还要重新问', async () => {
        // 下架和重新上架都会发生。把「没有」记住，玩家会以为它消失了。
        apiModel.mockResolvedValue(null);

        renderPanel({
            models: board([model({ id: 31, short: '下架', page: null })])
        });

        const openRow = () =>
            screen.getByRole('button', {
                name: 'vrcc.models.comments: 下架'
            });

        await userEvent.click(openRow());
        expect(
            await screen.findByText('vrcc.models.comments_gone')
        ).toBeTruthy();
        expect(apiModel).toHaveBeenCalledTimes(1);

        await userEvent.keyboard('{Escape}');
        await userEvent.click(openRow());
        await screen.findByText('vrcc.models.comments_gone');

        expect(apiModel).toHaveBeenCalledTimes(2);
    });
});
