// SPDX-License-Identifier: MPL-2.0
// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

import type { VrccBoardModel, VrccModelBoard } from '../vrccApi';
import { VrccModelsPanel } from './VrccModelsPanel';

afterEach(() => {
    cleanup();
    openLink.mockClear();
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

        // 只看**卡片正面**（`.vrcc-model-card__face--front`）。
        // 跟随指针的标签里放的是完整 BOOTH 原文，那是另一回事——它按设计
        // 就该和正面显示的名字不同，用 `getByText` 全局找会撞上。
        const fronts = [
            ...document.querySelectorAll('.vrcc-model-card__face--front')
        ];
        const texts = fronts.map((node) => node.textContent ?? '');

        expect(texts[0]).toContain('星');
        expect(texts[0]).not.toContain('オリジナル3Dモデル「星」');
        // short 全是空白 → 退回 BOOTH 原文。
        expect(texts[1]).toContain('素体モデル');
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
        const { container } = renderPanel({
            sort: 'week',
            models: board(
                [
                    model({ id: 6, rank: 9, place: 1, week: 5 }),
                    model({ id: 7, rank: 1, place: 2, week: 2 })
                ],
                { sort: 'week' }
            )
        });

        // 名次只在卡片里找：分页条是常驻的，它也有一个写着「1」的页码按钮，
        // 全局 `getByText('1')` 会同时命中两个。
        const places = [...container.querySelectorAll('[data-model-rank]')].map(
            (node) => node.textContent?.trim() ?? ''
        );

        // 第一张的 rank 是 9，若错用 rank 会显示 9 而不是 1。
        expect(places).toEqual(['1', '2']);
        expect(
            screen.getByText('vrcc.models.week_count:{"count":2}')
        ).toBeTruthy();
    });

    it('place 缺失时本周名次退回列表位置', () => {
        const { container } = renderPanel({
            sort: 'week',
            models: board(
                [
                    model({ id: 8, rank: 9, place: null, week: 1 }),
                    model({ id: 9, rank: 3, place: null, week: 1 })
                ],
                { sort: 'week' }
            )
        });

        const places = [...container.querySelectorAll('[data-model-rank]')].map(
            (node) => node.textContent?.trim() ?? ''
        );

        // 该显示 1、2（列表位置），而不是总榜名次 9 / 3。
        expect(places).toEqual(['1', '2']);
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

    it('点外链走 app__open_link，而不是 target=_blank', async () => {
        // WebView 里 `target=_blank` 什么都不做。
        renderPanel({
            models: board([
                model({ id: 10, page: 'https://vrcc.cc/models/10' })
            ])
        });

        await userEvent.click(
            screen.getByRole('button', { name: 'vrcc.models.open' })
        );

        expect(openLink).toHaveBeenCalledWith('https://vrcc.cc/models/10');
    });

    it('空榜显示空态而不是「没有这个接口」', () => {
        renderPanel({ models: board([]), available: true });

        expect(screen.getByText('vrcc.models.empty')).toBeTruthy();
        expect(screen.queryByText('vrcc.models.unavailable')).toBeNull();
    });
});
