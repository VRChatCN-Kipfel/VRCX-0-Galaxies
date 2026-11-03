// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    driver: vi.fn(),
    setConfig: vi.fn(),
    isActive: vi.fn(),
    getActiveIndex: vi.fn(),
    getState: vi.fn(),
    moveNext: vi.fn(),
    drive: vi.fn(),
    destroy: vi.fn()
}));

vi.mock('driver.js', () => ({ driver: mocks.driver }));

vi.mock('@/services/i18nService', () => ({
    default: {
        t: (key: string) => key,
        on: vi.fn(),
        off: vi.fn()
    }
}));

/**
 * 导览的交互约定。
 *
 * 这几条都是踩过坑才定下来的，钉在这里防止被改回去：
 * 点暗层不退出、Esc 能退出、点高亮不自动前进、跨页在「求值锚点」时准备、
 * 有条件出现的步骤会跳过。
 */
describe('导览的交互边界', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.resetAllMocks();
        mocks.driver.mockReturnValue({
            setConfig: mocks.setConfig,
            isActive: mocks.isActive,
            getActiveIndex: mocks.getActiveIndex,
            getState: mocks.getState,
            moveNext: mocks.moveNext,
            drive: mocks.drive,
            destroy: mocks.destroy
        });
        mocks.isActive.mockReturnValue(true);
        document.body.innerHTML = '';
    });

    async function load() {
        return import('./vrccTour');
    }

    function firstConfig() {
        return mocks.driver.mock.calls[0][0];
    }

    it('点暗层不退出：overlayClickBehavior 必须是函数', async () => {
        const { startTour, resetTourForTests } = await load();
        resetTourForTests();
        startTour([
            { titleKey: 'a', descriptionKey: 'b', element: '[data-x]' }
        ]);

        const handler = firstConfig().overlayClickBehavior;
        // 字符串 `'close'` 会让 driver 直接销毁导览——整屏都是暗层，
        // 这是最容易被误触掉的一种点法。
        expect(typeof handler).toBe('function');
        expect(() => handler()).not.toThrow();
        expect(mocks.destroy).not.toHaveBeenCalled();
    });

    it('Esc 仍然能退出：allowClose 必须保持开启', async () => {
        const { startTour, resetTourForTests } = await load();
        resetTourForTests();
        startTour([
            { titleKey: 'a', descriptionKey: 'b', element: '[data-x]' }
        ]);

        // Esc 和「点暗层」共用 allowClose 开关，关掉它会连 Esc 一起废掉。
        expect(firstConfig().allowClose).toBe(true);
    });

    it('点高亮元素不会自动前进', async () => {
        const { startTour, resetTourForTests } = await load();
        resetTourForTests();
        startTour([
            { titleKey: 'a', descriptionKey: 'b', element: '[data-x]' }
        ]);

        // `advanceOnClick` 的语义是「点这个高亮元素就前进」。榜单那一步高亮的
        // 就是列表本身——开着它，玩家想点开一张图会被直接推走。
        for (const step of firstConfig().steps) {
            expect(step.advanceOnClick).toBeFalsy();
        }
    });

    it('跨页准备发生在「求值锚点」时，而不是进入这一步之后', async () => {
        const { startTour, resetTourForTests } = await load();
        resetTourForTests();

        const prepare = vi.fn();
        startTour([
            { titleKey: 'a', descriptionKey: 'b' },
            {
                titleKey: 'c',
                descriptionKey: 'd',
                element: '[data-x]',
                prepare
            }
        ]);

        const step = firstConfig().steps[1];

        // 关键：锚点必须是**函数**。driver 求值 element 的时刻早于
        // `onHighlightStarted`，也只有那一刻才赶得上「先切页、再找元素」。
        expect(typeof step.element).toBe('function');

        // 准备动作在求值时就跑，且此时还没进到高亮阶段。
        const found = (step.element as () => Element | null)();
        expect(prepare).toHaveBeenCalledTimes(1);
        expect(found).toBeNull(); // 页面里确实没有这个元素
    });

    it('准备动作会被重复求值，因此必须幂等', async () => {
        const { startTour, resetTourForTests } = await load();
        resetTourForTests();

        const prepare = vi.fn();
        startTour([
            {
                titleKey: 'a',
                descriptionKey: 'b',
                element: '[data-x]',
                prepare
            }
        ]);

        const step = firstConfig().steps[0];
        const resolve = step.element as () => Element | null;

        // 等待期间每次 DOM 变动都会重新求值——这正是「元素一出现就立刻进入」
        // 的机制，也意味着同一个准备动作会被调很多次。
        resolve();
        resolve();
        resolve();
        expect(prepare).toHaveBeenCalledTimes(3);
    });

    it('元素已经存在时，求值一次就拿到它，不必等', async () => {
        const { startTour, resetTourForTests } = await load();
        resetTourForTests();

        const target = document.createElement('div');
        target.setAttribute('data-x', '');
        document.body.appendChild(target);

        startTour([
            { titleKey: 'a', descriptionKey: 'b', element: '[data-x]' }
        ]);

        const step = firstConfig().steps[0];
        expect((step.element as () => Element | null)()).toBe(target);
    });

    it('有条件出现的步骤允许缺锚点，核心步骤不允许', async () => {
        const { startTour, resetTourForTests } = await load();
        resetTourForTests();
        startTour([
            { titleKey: 'a', descriptionKey: 'b', element: '[data-core]' },
            {
                titleKey: 'c',
                descriptionKey: 'd',
                element: '[data-cond]',
                skipIfMissing: true
            }
        ]);

        const [core, conditional] = firstConfig().steps;
        expect(core.skipMissingElement).toBe(false);
        expect(conditional.skipMissingElement).toBe(true);
        // 条件步骤不该等太久：不存在就是不适用，没必要让玩家干等。
        expect(conditional.waitForElement).toBeLessThan(
            core.waitForElement as number
        );
    });

    it('没有锚点的步骤不做等待，直接居中显示', async () => {
        const { startTour, resetTourForTests } = await load();
        resetTourForTests();
        startTour([{ titleKey: 'a', descriptionKey: 'b' }]);

        // 没有 element 时不设 waitForElement：driver 默认 0，立刻进入。
        expect(firstConfig().steps[0].element).toBeUndefined();
    });

    it('多个元素会合成一个正好包住它们的高亮框', async () => {
        const { startTour, resetTourForTests } = await load();
        resetTourForTests();

        const top = document.createElement('div');
        top.setAttribute('data-a', '');
        top.getBoundingClientRect = () =>
            ({ top: 10, left: 20, right: 120, bottom: 60 }) as DOMRect;
        const bottom = document.createElement('div');
        bottom.setAttribute('data-b', '');
        bottom.getBoundingClientRect = () =>
            ({ top: 60, left: 20, right: 200, bottom: 140 }) as DOMRect;
        document.body.append(top, bottom);

        startTour([
            {
                titleKey: 'a',
                descriptionKey: 'b',
                element: ['[data-a]', '[data-b]']
            }
        ]);

        const resolve = firstConfig().steps[0].element as () => Element;
        const frame = resolve() as HTMLElement;

        // 合成框要正好覆盖两块的并集：上 10、左 20、下 140、右 200。
        expect(frame.getAttribute('data-tour-frame')).not.toBeNull();
        expect(frame.style.top).toBe('10px');
        expect(frame.style.left).toBe('20px');
        expect(frame.style.width).toBe('180px');
        expect(frame.style.height).toBe('130px');
    });

    it('后出现的面板会被并进同一个框，而不是换一个新元素', async () => {
        const { startTour, resetTourForTests } = await load();
        resetTourForTests();

        const anchor = document.createElement('div');
        anchor.setAttribute('data-anchor', '');
        anchor.getBoundingClientRect = () =>
            ({ top: 0, left: 0, right: 100, bottom: 40 }) as DOMRect;
        document.body.appendChild(anchor);

        startTour([
            {
                titleKey: 'a',
                descriptionKey: 'b',
                element: ['[data-anchor]', '[data-late]']
            }
        ]);

        const resolve = firstConfig().steps[0].element as () => Element;
        const first = resolve() as HTMLElement;
        // 此刻只有必需的那个，框只包住它。
        expect(first.style.height).toBe('40px');

        // 玩家点了按钮，授权码面板出现。
        const late = document.createElement('div');
        late.setAttribute('data-late', '');
        late.getBoundingClientRect = () =>
            ({ top: 40, left: 0, right: 100, bottom: 200 }) as DOMRect;
        document.body.appendChild(late);

        // 再次求值：**必须是同一个框元素**。driver 把锚点记在 activeElement
        // 上，换新元素高亮就丢了。
        const second = resolve() as HTMLElement;
        expect(second).toBe(first);
        expect(second.style.height).toBe('200px');
    });

    it('第一个元素必需，后面的「有就一起亮」', async () => {
        const { startTour, resetTourForTests } = await load();
        resetTourForTests();

        // 只存在必需的那个：授权码面板还没生成（玩家没点连接）。
        const only = document.createElement('div');
        only.setAttribute('data-required', '');
        only.getBoundingClientRect = () =>
            ({ top: 0, left: 0, right: 10, bottom: 10 }) as DOMRect;
        document.body.appendChild(only);

        startTour([
            {
                titleKey: 'a',
                descriptionKey: 'b',
                element: ['[data-required]', '[data-optional]']
            }
        ]);

        const resolve = firstConfig().steps[0].element as () => Element;
        // 不该因为缺少可选块而返回 null（那会让整步等到超时后被跳过）。
        const resolved = resolve();
        expect(resolved).not.toBeNull();
        expect(resolved).not.toBe(only); // 多元素走合成框
        expect((resolved as HTMLElement).style.width).toBe('10px');
    });

    it('必需元素不存在时返回 null，交给等待机制', async () => {
        const { startTour, resetTourForTests } = await load();
        resetTourForTests();

        startTour([
            {
                titleKey: 'a',
                descriptionKey: 'b',
                element: ['[data-missing]', '[data-also-missing]']
            }
        ]);

        const resolve = firstConfig().steps[0].element as () => Element | null;
        expect(resolve()).toBeNull();
    });

    it('「已连接」时换一组文案，不再教人先连接', async () => {
        const { startTour, resetTourForTests } = await load();
        resetTourForTests();

        let connected = false;
        startTour([
            {
                titleKey: 'tour.connect.title',
                descriptionKey: 'tour.connect.description',
                element: '[data-x]',
                variant: {
                    when: () => connected,
                    titleKey: 'tour.connect.connected_title',
                    descriptionKey: 'tour.connect.connected_description'
                }
            }
        ]);

        const step = firstConfig().steps[0];
        // 未连接：教他连。
        expect(step.popover?.title).toBe('tour.connect.title');
        expect(step.popover?.description).toBe('tour.connect.description');

        // 连上之后重建配置，文案应当切换。
        connected = true;
        const { retranslateTour } = await load();
        retranslateTour();
        const updated = mocks.setConfig.mock.calls[0][0];
        expect(updated.steps[0].popover.title).toBe(
            'tour.connect.connected_title'
        );
    });

    it('被框覆盖的真实控件会被标成可点，否则点了没反应', async () => {
        const { startTour, resetTourForTests } = await load();
        resetTourForTests();

        const card = document.createElement('div');
        card.setAttribute('data-card', '');
        card.getBoundingClientRect = () =>
            ({ top: 0, left: 0, right: 10, bottom: 10 }) as DOMRect;
        const auth = document.createElement('div');
        auth.setAttribute('data-auth-panel', '');
        auth.getBoundingClientRect = () =>
            ({ top: 10, left: 0, right: 10, bottom: 20 }) as DOMRect;
        document.body.append(card, auth);

        startTour([
            {
                titleKey: 'a',
                descriptionKey: 'b',
                element: ['[data-card]', '[data-auth-panel]']
            }
        ]);

        const resolve = firstConfig().steps[0].element as () => Element;
        resolve();

        // driver 的 `.driver-active *{pointer-events:none}` 会把真实控件一并
        // 禁掉——它们在合成框**外面**，拿不到「只有锚点可点」那条放行规则。
        // 所以必须由我们打上 `data-tour-hit`，CSS 才放行。
        // 这个坑的表现正是「点了『开始连接』完全没反应」。
        expect(card.hasAttribute('data-tour-hit')).toBe(true);
        expect(auth.hasAttribute('data-tour-hit')).toBe(true);
    });

    it('切到单元素步骤时清掉旧框和可点标记', async () => {
        const { startTour, resetTourForTests } = await load();
        resetTourForTests();

        const card = document.createElement('div');
        card.setAttribute('data-card', '');
        card.getBoundingClientRect = () =>
            ({ top: 0, left: 0, right: 10, bottom: 10 }) as DOMRect;
        const auth = document.createElement('div');
        auth.setAttribute('data-auth-panel', '');
        auth.getBoundingClientRect = () =>
            ({ top: 10, left: 0, right: 10, bottom: 20 }) as DOMRect;
        const single = document.createElement('div');
        single.setAttribute('data-single', '');
        document.body.append(card, auth, single);

        startTour([
            {
                titleKey: 'a',
                descriptionKey: 'b',
                element: ['[data-card]', '[data-auth-panel]']
            },
            { titleKey: 'c', descriptionKey: 'd', element: '[data-single]' }
        ]);

        const steps = firstConfig().steps;
        (steps[0].element as () => Element)();
        expect(document.querySelectorAll('[data-tour-frame]').length).toBe(1);

        // 走到单元素那一步：框要收掉、标记也要清掉，否则它会一直挂在页面上。
        (steps[1].element as () => Element)();
        expect(document.querySelectorAll('[data-tour-frame]').length).toBe(0);
        expect(card.hasAttribute('data-tour-hit')).toBe(false);
        expect(auth.hasAttribute('data-tour-hit')).toBe(false);
    });
});
