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
 * 高亮范围可以比「可点范围」大。
 *
 * 这是反馈里一个真实的矛盾：把榜单并进高亮范围，玩家才能看到切换排序的
 * 效果；但 driver 会把锚点**整块**放行（`.driver-active-element *` 是
 * `pointer-events: auto`），于是玩家点任意一行都会跳去详情——而「换个排法」
 * 讲的是排序，不是怎么打开详情。
 *
 * driver 没有「锚点里只放行部分子元素」的开关：`disableActiveInteraction`
 * 会连该点的排序按钮一起禁掉。所以用反向标记 `data-tour-readonly`。
 */
describe('只亮不点的目标', () => {
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

    it('readOnly 里的下标会被标成只读，其余保持可点', async () => {
        const { startTour, resetTourForTests } = await load();
        resetTourForTests();

        const sorts = document.createElement('div');
        sorts.setAttribute('data-sorts', '');
        const list = document.createElement('div');
        list.setAttribute('data-list', '');
        document.body.append(sorts, list);

        startTour([
            {
                titleKey: 'a',
                descriptionKey: 'b',
                // 下标 1（榜单）只读，下标 0（排序）照常可点。
                element: ['[data-sorts]', '[data-list]'],
                readOnly: [1]
            }
        ]);

        const step = mocks.driver.mock.calls[0][0].steps[0];
        (step.element as () => Element)();

        expect(sorts.hasAttribute('data-tour-hit')).toBe(true);
        expect(sorts.hasAttribute('data-tour-readonly')).toBe(false);

        // 榜单仍要可「看见」（被并进高亮范围），但不可点。
        expect(list.hasAttribute('data-tour-readonly')).toBe(true);
    });

    it('单目标步骤会清掉上一步遗留的只读标记', async () => {
        const { startTour, resetTourForTests } = await load();
        resetTourForTests();

        const sorts = document.createElement('div');
        sorts.setAttribute('data-sorts', '');
        const list = document.createElement('div');
        list.setAttribute('data-list', '');
        const single = document.createElement('div');
        single.setAttribute('data-single', '');
        document.body.append(sorts, list, single);

        startTour([
            {
                titleKey: 'a',
                descriptionKey: 'b',
                element: ['[data-sorts]', '[data-list]'],
                readOnly: [1]
            },
            { titleKey: 'c', descriptionKey: 'd', element: '[data-single]' }
        ]);

        const steps = mocks.driver.mock.calls[0][0].steps;
        (steps[0].element as () => Element)();
        expect(list.hasAttribute('data-tour-readonly')).toBe(true);

        // 走到单目标那一步：旧标记必须清掉，否则榜单会一直点不动。
        (steps[1].element as () => Element)();
        expect(list.hasAttribute('data-tour-readonly')).toBe(false);
        expect(document.querySelectorAll('[data-tour-readonly]').length).toBe(
            0
        );
    });
});
