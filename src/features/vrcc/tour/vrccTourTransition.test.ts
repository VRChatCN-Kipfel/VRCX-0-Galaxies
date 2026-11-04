// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    driver: vi.fn(),
    setConfig: vi.fn(),
    isActive: vi.fn(),
    getActiveIndex: vi.fn(),
    getActiveElement: vi.fn(),
    getState: vi.fn(),
    moveNext: vi.fn(),
    movePrevious: vi.fn(),
    refresh: vi.fn(),
    drive: vi.fn(),
    destroy: vi.fn()
}));

vi.mock('driver.js', () => ({ driver: mocks.driver }));
vi.mock('@/services/i18nService', () => ({
    default: { t: (k: string) => k, on: vi.fn(), off: vi.fn() }
}));

/**
 * 步骤之间的过渡。
 *
 * 钉住的是一个真实的观感问题：第 9 步（打分）在**世界详情对话框里**，
 * 第 10 步（排序）在榜单页。按「下一步」时准备动作会关掉详情，于是同一帧里
 * 发生了两件事——对话框消失、高亮移动。反馈原话：「详情突然消失，显得很突兀」。
 *
 * 解法是等对话框真的退场再推进；**没有对话框要关时立即推进**，不给正常步骤
 * 加延迟。
 */
describe('切换步骤时等对话框退场', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.resetAllMocks();
        mocks.driver.mockReturnValue({
            setConfig: mocks.setConfig,
            isActive: mocks.isActive,
            getActiveIndex: mocks.getActiveIndex,
            getActiveElement: mocks.getActiveElement,
            getState: mocks.getState,
            moveNext: mocks.moveNext,
            movePrevious: mocks.movePrevious,
            refresh: mocks.refresh,
            drive: mocks.drive,
            destroy: mocks.destroy
        });
        mocks.isActive.mockReturnValue(true);
        mocks.getActiveIndex.mockReturnValue(0);
        document.body.innerHTML = '';
    });

    async function load() {
        return import('./vrccTour');
    }

    /** 造一个正在退场的对话框（base-ui 用 `data-closed` 表示退场中）。 */
    function closingDialog() {
        const el = document.createElement('div');
        el.setAttribute('data-slot', 'dialog-content');
        el.setAttribute('data-closed', '');
        document.body.appendChild(el);
        return el;
    }

    it('没有对话框要关时立即推进，不加延迟', async () => {
        const { startTour, resetTourForTests } = await load();
        resetTourForTests();

        startTour([
            { titleKey: 'a', descriptionKey: 'b', element: '[data-x]' },
            { titleKey: 'c', descriptionKey: 'd', element: '[data-y]' }
        ]);

        const step = mocks.driver.mock.calls[0][0].steps[0];
        step.popover?.onNextClick?.(undefined, step, {} as never);

        // 同一帧就推进——正常步骤不该为这个特性付代价。
        expect(mocks.moveNext).toHaveBeenCalledTimes(1);
    });

    it('对话框在退场时，等它消失再推进', async () => {
        const { startTour, resetTourForTests } = await load();
        resetTourForTests();

        startTour([
            { titleKey: 'a', descriptionKey: 'b', element: '[data-x]' },
            { titleKey: 'c', descriptionKey: 'd', element: '[data-y]' }
        ]);

        const dialog = closingDialog();
        const step = mocks.driver.mock.calls[0][0].steps[0];
        step.popover?.onNextClick?.(undefined, step, {} as never);

        // 退场中：还不能推进。
        expect(mocks.moveNext).not.toHaveBeenCalled();

        // 对话框真的从 DOM 里消失后，才推进。
        dialog.remove();
        await new Promise((resolve) => setTimeout(resolve, 80));
        expect(mocks.moveNext).toHaveBeenCalledTimes(1);
    });

    it('等待期间重复点击不会跳两步', async () => {
        const { startTour, resetTourForTests } = await load();
        resetTourForTests();

        startTour([
            { titleKey: 'a', descriptionKey: 'b', element: '[data-x]' },
            { titleKey: 'c', descriptionKey: 'd', element: '[data-y]' }
        ]);

        const dialog = closingDialog();
        const step = mocks.driver.mock.calls[0][0].steps[0];

        // 触摸板抖一下 = 连点两次。第二次必须被挡掉。
        step.popover?.onNextClick?.(undefined, step, {} as never);
        step.popover?.onNextClick?.(undefined, step, {} as never);

        dialog.remove();
        await new Promise((resolve) => setTimeout(resolve, 80));
        expect(mocks.moveNext).toHaveBeenCalledTimes(1);
    });

    it('退场卡住时不会永远不推进', async () => {
        const { startTour, resetTourForTests } = await load();
        resetTourForTests();

        startTour([
            { titleKey: 'a', descriptionKey: 'b', element: '[data-x]' },
            { titleKey: 'c', descriptionKey: 'd', element: '[data-y]' }
        ]);

        // 停在退场状态、永远不消失：500ms 上限之后必须放行，
        // 否则玩家点了没反应。
        closingDialog();
        const step = mocks.driver.mock.calls[0][0].steps[0];
        step.popover?.onNextClick?.(undefined, step, {} as never);

        await new Promise((resolve) => setTimeout(resolve, 700));
        expect(mocks.moveNext).toHaveBeenCalledTimes(1);
    });
});
