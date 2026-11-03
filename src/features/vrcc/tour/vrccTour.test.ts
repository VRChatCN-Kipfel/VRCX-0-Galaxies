// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    driver: vi.fn(),
    setConfig: vi.fn(),
    isActive: vi.fn(),
    getActiveIndex: vi.fn(),
    getState: vi.fn(),
    moveNext: vi.fn(),
    movePrevious: vi.fn(),
    refresh: vi.fn(),
    getActiveElement: vi.fn(),
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
            movePrevious: mocks.movePrevious,
            refresh: mocks.refresh,
            getActiveElement: mocks.getActiveElement,
            drive: mocks.drive,
            destroy: mocks.destroy
        });
        mocks.isActive.mockReturnValue(true);
        // `advanceOnce` 用当前步号去重，所以默认给 0——不设的话是 `undefined`，
        // 去重逻辑会直接返回、什么都不推进。
        mocks.getActiveIndex.mockReturnValue(0);
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

    it('锚点求值不做副作用，prepareNext 由前一步触发', async () => {
        const { startTour, resetTourForTests } = await load();
        resetTourForTests();

        const prepare = vi.fn();
        const prepareNext = vi.fn();
        startTour([
            { titleKey: 'a', descriptionKey: 'b' },
            {
                titleKey: 'c',
                descriptionKey: 'd',
                element: '[data-x]',
                prepare,
                prepareNext
            }
        ]);

        const step = firstConfig().steps[1];

        // **求值锚点不能有副作用**。
        // driver 会为了「判断后面还有没有步骤」扫描后续步骤并调用求值函数，
        // 副作用会在玩家还没走到时就被触发——正是「我没点，详情却自己打开了」
        // 那个 bug。
        (step.element as () => Element | null)();
        expect(prepare).not.toHaveBeenCalled();
        expect(prepareNext).not.toHaveBeenCalled();
    });

    it('进入这一步时不准备下一步（否则界面会在讲这一步时被切走）', async () => {
        const { startTour, resetTourForTests } = await load();
        resetTourForTests();

        const nextPrepareNext = vi.fn();
        startTour([
            { titleKey: 'a', descriptionKey: 'b' },
            {
                titleKey: 'c',
                descriptionKey: 'd',
                element: '[data-x]',
                prepareNext: nextPrepareNext
            }
        ]);

        const steps = firstConfig().steps;
        steps[0].onHighlightStarted!(undefined, steps[0], {} as never);

        // **不该在这里准备下一步**。早先这么做过，结果第 3 步「先连接一次」
        // 的气泡停着、界面已经跳到地图榜——第 N 步刚开始就去准备第 N+1 步，
        // 第 N 步的气泡还指着旧锚点。
        expect(nextPrepareNext).not.toHaveBeenCalled();
    });

    it('点「下一步」时才准备下一步，并且自己推进', async () => {
        const { startTour, resetTourForTests } = await load();
        resetTourForTests();

        const nextPrepareNext = vi.fn();
        startTour([
            { titleKey: 'a', descriptionKey: 'b' },
            {
                titleKey: 'c',
                descriptionKey: 'd',
                element: '[data-x]',
                prepareNext: nextPrepareNext
            }
        ]);

        const step = firstConfig().steps[0];
        mocks.moveNext.mockClear();
        step.popover?.onNextClick?.(undefined, step, {} as never);

        // 先准备，再推进。
        expect(nextPrepareNext).toHaveBeenCalledTimes(1);
        // **必须自己推进**：driver 里 `popover.onNextClick ?? 默认推进` 是二选一，
        // 我提供了回调它就不要再执行内置的 moveNext——只做准备不推进的话，
        // 按钮点了没反应。
        expect(mocks.moveNext).toHaveBeenCalled();
    });

    it('预告步骤会自己往前走，不要求玩家点', async () => {
        vi.useFakeTimers();
        try {
            const { startTour, resetTourForTests } = await load();
            resetTourForTests();

            startTour([
                {
                    titleKey: 'a',
                    descriptionKey: 'b',
                    element: '[data-x]',
                    autoAdvanceMs: 1000
                },
                { titleKey: 'c', descriptionKey: 'd', element: '[data-y]' }
            ]);

            const step = firstConfig().steps[0];
            mocks.moveNext.mockClear();
            step.onHighlightStarted!(undefined, step, {} as never);

            // 还没到时间：不该动。
            await vi.advanceTimersByTimeAsync(500);
            expect(mocks.moveNext).not.toHaveBeenCalled();

            // 到点了：自己前进。这是兜底路径——玩家既没点、也没按按钮时，
            // 教学流程不能停在这儿。
            await vi.advanceTimersByTimeAsync(600);
            expect(mocks.moveNext).toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('玩家自己点开目标时也会前进（和「下一步」双管齐下）', async () => {
        const { startTour, resetTourForTests } = await load();
        resetTourForTests();

        const target = document.createElement('div');
        target.setAttribute('data-opened', '');

        startTour([
            {
                titleKey: 'a',
                descriptionKey: 'b',
                element: '[data-x]',
                advanceWhen: '[data-opened]'
            },
            { titleKey: 'c', descriptionKey: 'd', element: '[data-y]' }
        ]);

        mocks.moveNext.mockClear();
        const step = firstConfig().steps[0];

        // 目标还不存在：观察者等着。
        step.onHighlightStarted!(undefined, step, {} as never);
        expect(mocks.moveNext).not.toHaveBeenCalled();

        // 玩家点了高亮区里的真实控件，详情被渲染出来。
        document.body.appendChild(target);
        await new Promise((resolve) => setTimeout(resolve, 20));

        // 立刻前进——不必等定时器，也不必他去按按钮。
        expect(mocks.moveNext).toHaveBeenCalled();
        document.body.removeChild(target);
    });

    it('两条路都通时只前进一次，不会跳两步', async () => {
        const { startTour, resetTourForTests } = await load();
        resetTourForTests();

        startTour([
            {
                titleKey: 'a',
                descriptionKey: 'b',
                element: '[data-x]',
                autoAdvanceMs: 3000
            },
            { titleKey: 'c', descriptionKey: 'd', element: '[data-y]' }
        ]);

        const step = firstConfig().steps[0];
        mocks.moveNext.mockClear();
        step.onHighlightStarted!(undefined, step, {} as never);

        // 玩家先按了「下一步」。
        step.popover?.onNextClick?.(undefined, step, {} as never);
        expect(mocks.moveNext).toHaveBeenCalledTimes(1);

        // 随后自动前进的计时器到点——**不该再推一次**，
        // 否则一次操作会跳两步，玩家会莫名少看一屏。
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(mocks.moveNext).toHaveBeenCalledTimes(1);
    });

    it('玩家自己点「下一步」会取消待执行的自动前进', async () => {
        vi.useFakeTimers();
        try {
            const { startTour, resetTourForTests } = await load();
            resetTourForTests();

            startTour([
                {
                    titleKey: 'a',
                    descriptionKey: 'b',
                    element: '[data-x]',
                    autoAdvanceMs: 1000
                },
                { titleKey: 'c', descriptionKey: 'd', element: '[data-y]' }
            ]);

            const step = firstConfig().steps[0];
            step.onHighlightStarted!(undefined, step, {} as never);

            // 玩家先自己点了。
            mocks.moveNext.mockClear();
            step.popover?.onNextClick?.(undefined, step, {} as never);
            expect(mocks.moveNext).toHaveBeenCalledTimes(1);

            // 计时器到点后**不该再推一次**。
            await vi.advanceTimersByTimeAsync(1500);
            expect(mocks.moveNext).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('点「上一步」时先准备目标步骤，再回退', async () => {
        const { startTour, resetTourForTests } = await load();
        resetTourForTests();

        const prevPrepareNext = vi.fn();
        startTour([
            { titleKey: 'a', descriptionKey: 'b' },
            {
                titleKey: 'c',
                descriptionKey: 'd',
                prepareNext: prevPrepareNext
            },
            { titleKey: 'e', descriptionKey: 'f', element: '[data-x]' }
        ]);

        const step = firstConfig().steps[2];
        // `startTour` 会替首步跑一次 `prepareNext`，先清掉计数。
        prevPrepareNext.mockClear();
        mocks.movePrevious.mockClear();
        step.popover?.onPrevClick?.(undefined, step, {} as never);

        // 从详情往后退时，目标步骤的锚点被对话框盖着——先准备才能正确高亮。
        expect(prevPrepareNext).toHaveBeenCalledTimes(1);
        expect(mocks.movePrevious).toHaveBeenCalled();
    });

    it('锚点求值可以被反复调用，因为 driver 会为了别的原因也调它', async () => {
        const { startTour, resetTourForTests } = await load();
        resetTourForTests();

        const target = document.createElement('div');
        target.setAttribute('data-x', '');
        document.body.appendChild(target);

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

        // driver 的跳过判断会扫描后续步骤并调用求值函数（`R` → `L` → `f`），
        // 所以求值被调用很多次是**正常现象**。
        resolve();
        resolve();
        resolve();

        // 关键：无论调多少次，都不能有副作用。
        expect(prepare).not.toHaveBeenCalled();
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

    it('高亮画好后会跟随元素位移，否则框会停在原处', async () => {
        const { startTour, resetTourForTests } = await load();
        resetTourForTests();

        const target = document.createElement('div');
        target.setAttribute('data-x', '');
        document.body.appendChild(target);

        let top = 100;
        target.getBoundingClientRect = () =>
            ({ top, left: 0, width: 50, height: 20 }) as DOMRect;

        startTour([
            { titleKey: 'a', descriptionKey: 'b', element: '[data-x]' }
        ]);

        // 模拟 driver 画完高亮：它会调 onHighlighted，并从 activeElement
        // 取当前锚点。
        mocks.getActiveElement.mockReturnValue(target);
        const step = firstConfig().steps[0];
        step.onHighlighted!(target, step, {} as never);
        mocks.refresh.mockClear();

        // 元素被上面的列表推下去了（尺寸没变，纯位移）。
        top = 300;
        document.body.appendChild(document.createElement('div'));
        await new Promise((resolve) => setTimeout(resolve, 60));

        // 必须让 driver 重新测量——否则实测就是「第 14 步社区群的高亮框
        // 停在卡片原来的位置，卡片已经被推到下面去了，看起来像没有高亮」。
        expect(mocks.refresh).toHaveBeenCalled();

        document.body.removeChild(target);
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
