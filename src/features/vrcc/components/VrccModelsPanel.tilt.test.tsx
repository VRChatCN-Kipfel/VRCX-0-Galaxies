// SPDX-License-Identifier: MPL-2.0
// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-i18next')>();
    return {
        ...actual,
        useTranslation: () => ({ t: (key: string) => key })
    };
});

vi.mock('../useOpenExternalLink', () => ({
    useOpenExternalLink: () => ({ open: vi.fn(), pending: false })
}));

import type { VrccBoardModel, VrccModelBoard } from '../vrccApi';
import { VrccModelsPanel } from './VrccModelsPanel';

/**
 * 这一组测**接线**，不测手感（数值行为由 `useTiltGrid.test.tsx` 覆盖）。
 *
 * 它存在的理由是一个真踩过的坑：模型榜异步加载，首帧网格不渲染，
 * `ref.current` 是 null，`useEffect(…, [])` 当场退出且永不重跑——界面上
 * 「鼠标移上去完全没反应」，而单元测试全绿。
 */
let frames: FrameRequestCallback[] = [];
let clock = 0;

function tick(count = 1) {
    for (let i = 0; i < count; i++) {
        clock += 16;
        const pending = frames;
        frames = [];
        for (const callback of pending) {
            act(() => {
                callback(clock);
            });
        }
    }
}

beforeEach(() => {
    frames = [];
    clock = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        frames.push(callback);
        return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {
        frames = [];
    });
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

function model(overrides: Partial<VrccBoardModel> = {}): VrccBoardModel {
    return {
        id: 1,
        name: 'オリジナル3Dモデル「星」',
        short: '星',
        shop: '星屋',
        price: '¥1,500',
        likes: 42,
        week: null,
        rank: 1,
        page: null,
        img: null,
        booth: null,
        hot: null,
        place: null,
        move: null,
        fresh: null,
        ...overrides
    };
}

function board(models: VrccBoardModel[]): VrccModelBoard {
    return {
        board: 'models',
        sort: 'top',
        total: models.length,
        next: null,
        weeks: [],
        w: null,
        at: 1,
        models
    };
}

function stubRect(element: Element) {
    element.getBoundingClientRect = () =>
        ({
            left: 0,
            top: 0,
            width: 200,
            height: 300,
            right: 200,
            bottom: 300,
            x: 0,
            y: 0,
            toJSON: () => ({})
        }) as DOMRect;
}

describe('VrccModelsPanel 倾斜接线', () => {
    it('数据异步到齐之后，网格仍然接上了指针监听', () => {
        const { container, rerender } = render(
            <VrccModelsPanel
                models={null}
                sort="top"
                sortSupported
                available
                onSortChange={() => {}}
                onRefresh={() => {}}
            />
        );
        expect(container.querySelector('ul')).toBeNull();
        rerender(
            <VrccModelsPanel
                models={board([model()])}
                sort="top"
                sortSupported
                available
                onSortChange={() => {}}
                onRefresh={() => {}}
            />
        );

        const card = container.querySelector<HTMLElement>('[data-tilt]')!;
        expect(card).not.toBeNull();
        stubRect(card);

        // 派发到**卡片**上：真实指针也是落在卡片里再冒泡到网格。
        const event = new MouseEvent('pointermove', {
            bubbles: true,
            clientX: 200,
            clientY: 300
        });
        Object.defineProperty(event, 'pointerType', { value: 'mouse' });
        fireEvent(card, event);
        tick(120);

        expect(card.style.getPropertyValue('--tilt-y')).not.toBe('');
    });

    it('点封面翻到背面，点背面翻回来', () => {
        const { container } = render(
            <VrccModelsPanel
                models={board([model()])}
                sort="top"
                sortSupported
                available
                onSortChange={() => {}}
                onRefresh={() => {}}
            />
        );

        const card = container.querySelector<HTMLElement>('[data-tilt]')!;
        const flipButton = container.querySelector<HTMLElement>(
            '.vrcc-model-card__face--front button'
        )!;
        const backButton = container.querySelector<HTMLElement>(
            '.vrcc-model-card__face--back'
        )!;

        expect(card.hasAttribute('data-flipped')).toBe(false);

        fireEvent.click(flipButton);
        expect(card.hasAttribute('data-flipped')).toBe(true);

        fireEvent.click(backButton);
        expect(card.hasAttribute('data-flipped')).toBe(false);
    });

    it('同一时刻只允许一张翻着', () => {
        const { container } = render(
            <VrccModelsPanel
                models={board([model({ id: 1 }), model({ id: 2 })])}
                sort="top"
                sortSupported
                available
                onSortChange={() => {}}
                onRefresh={() => {}}
            />
        );

        const cards = [
            ...container.querySelectorAll<HTMLElement>('[data-tilt]')
        ];
        const flipButtons = [
            ...container.querySelectorAll<HTMLElement>(
                '.vrcc-model-card__face--front button'
            )
        ];

        fireEvent.click(flipButtons[0]);
        expect(cards[0].hasAttribute('data-flipped')).toBe(true);

        // 翻第二张时第一张自己翻回去——网格是拿来扫的，全都翻过去就认不出谁了。
        fireEvent.click(flipButtons[1]);
        expect(cards[0].hasAttribute('data-flipped')).toBe(false);
        expect(cards[1].hasAttribute('data-flipped')).toBe(true);
    });

    it('换排序时把翻着的收回来', () => {
        const { container, rerender } = render(
            <VrccModelsPanel
                models={board([model()])}
                sort="top"
                sortSupported
                available
                onSortChange={() => {}}
                onRefresh={() => {}}
            />
        );

        const flipButton = container.querySelector<HTMLElement>(
            '.vrcc-model-card__face--front button'
        )!;
        fireEvent.click(flipButton);
        expect(
            container.querySelector('[data-tilt]')!.hasAttribute('data-flipped')
        ).toBe(true);

        rerender(
            <VrccModelsPanel
                models={board([model()])}
                sort="week"
                sortSupported
                available
                onSortChange={() => {}}
                onRefresh={() => {}}
            />
        );

        expect(
            container.querySelector('[data-tilt]')!.hasAttribute('data-flipped')
        ).toBe(false);
    });
});
