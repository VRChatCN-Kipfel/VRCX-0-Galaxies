// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

// 只关心「哪些步骤会把玩家带回页面级」，不真的渲染界面，
// 所以把页面/对话框那些副作用整体打桩。
const openVrccTab = vi.hoisted(() => vi.fn());
const closeDialog = vi.hoisted(() => vi.fn());

vi.mock('@/shared/utils/vrccNavigation', () => ({ openVrccTab }));
// `activeDialog` 要在测试里改，所以用一个可变的持有对象——
// 直接 `getState: () => ({ activeDialog: null })` 就没法模拟「详情已经开着」。
let activeDialog: { kind: string; entityId: string } | null = null;
vi.mock('@/state/dialogStore', () => ({
    useDialogStore: {
        getState: () => ({ closeDialog, activeDialog })
    }
}));
vi.mock('@/state/vrccUnreadStore', () => ({
    useVrccUnreadStore: { getState: () => ({ connected: false }) }
}));

import type { TourStep } from './vrccTour';

/**
 * 按锚点选择器找步骤，**不按下标**。
 *
 * 导览的步骤顺序调整过几次（排序从第 7 步挪到详情之后），
 * 硬编码下标会让测试在「顺序变了但行为没变」时误报。
 */
function findStep(
    steps: readonly TourStep[],
    selector: string,
    occurrence = 0
): TourStep {
    let seen = 0;
    for (const step of steps) {
        const list =
            step.element === undefined
                ? []
                : typeof step.element === 'string'
                  ? [step.element]
                  : [...step.element];
        if (list.includes(selector)) {
            if (seen === occurrence) return step;
            seen += 1;
        }
    }
    throw new Error(`没有找到锚点为 ${selector} 的第 ${occurrence} 个步骤`);
}

describe('页面级步骤会先回到页面', () => {
    it('排序那一步会先关掉对话框', async () => {
        const { buildVrccTour } = await import('./vrccTourSteps');
        const steps = buildVrccTour();

        // 排序是**榜单页**上的控件。讲它的那一刻如果详情还开着，
        // 控件就被对话框盖住：driver 照样能查到它（它在 DOM 里），
        // 于是画出一块被遮住的高亮，玩家看到的是「全屏遮罩、找不到控件」。
        const sortStep = findStep(steps, '[data-tour="vrcc-maps-sorts"]');

        closeDialog.mockClear();
        sortStep.prepareNext?.();
        expect(closeDialog).toHaveBeenCalled();
    });

    it('提醒那一步会关掉对话框并切页', async () => {
        const { buildVrccTour } = await import('./vrccTourSteps');
        const steps = buildVrccTour();

        const notifStep = findStep(steps, '[data-tour="vrcc-notif-header"]');

        closeDialog.mockClear();
        openVrccTab.mockClear();
        notifStep.prepareNext?.();
        expect(closeDialog).toHaveBeenCalled();
        expect(openVrccTab).toHaveBeenCalledWith('notifications');
    });

    it('详情已经开着时不再关掉重开', async () => {
        const { buildVrccTour } = await import('./vrccTourSteps');
        const steps = buildVrccTour();

        const detailStep = findStep(steps, '[data-tour="world-vrcc-overview"]');

        // 模拟玩家在第 7 步点开了第一行的详情：对话框已经开着。
        activeDialog = { kind: 'world', entityId: 'wrld_example' };

        closeDialog.mockClear();
        detailStep.prepareNext?.();

        // **不能关**。早先无条件 `backToPage()`，等于把玩家刚点开的详情
        // 掐掉——实测就是「窗口弹出来又被生生掐掉，然后跳到第 10 步」。
        expect(closeDialog).not.toHaveBeenCalled();

        activeDialog = null;
    });

    it('没有详情时才由导览打开，且只用第一行', async () => {
        const { buildVrccTour } = await import('./vrccTourSteps');
        const steps = buildVrccTour();

        const detailStep = findStep(steps, '[data-tour="world-vrcc-overview"]');

        // 第 6 步封住整个榜单、第 7 步只亮第一行，所以玩家能点开的只有
        // 第一行——不存在「打开了别的行」这种情况。
        const list = document.createElement('div');
        list.setAttribute('data-tour', 'vrcc-maps-list');
        const row = document.createElement('div');
        row.setAttribute('data-world', 'wrld_example');
        list.appendChild(row);
        document.body.appendChild(list);

        activeDialog = null;
        detailStep.prepareNext?.();

        // 没有详情开着时，导览负责打开；此时不需要先关（本来就没什么可关）。
        expect(closeDialog).not.toHaveBeenCalled();
        document.body.removeChild(list);
    });

    it('「第一行」那一步允许点，并且三种前进方式都通向详情', async () => {
        const { buildVrccTour } = await import('./vrccTourSteps');
        const steps = buildVrccTour();

        const firstRowStep = findStep(
            steps,
            '[data-tour="vrcc-maps-first-row"]'
        );

        closeDialog.mockClear();
        firstRowStep.prepareNext?.();
        expect(closeDialog).toHaveBeenCalled();

        // **允许点**：这一行本来就是玩家会点的那一行，锁住它只会让人觉得
        // 「点了没反应」。两条路通向第 8 步（详情概览）：
        //   1. 玩家点开详情 → advanceWhen 监听到 → 前进
        //   2. 玩家按「下一步」→ prepareNext 打开详情 → 前进
        expect(firstRowStep.blockInteraction).toBeFalsy();
        // 监听的是**页签条**，不是概览区。
        // 概览区在「星遇同频」页签内，而详情默认停在「房间」——拿它当信号
        // 等于等一个永远不出现的东西（实测：点了行、详情也弹出来了，却不跳步）。
        expect(firstRowStep.advanceWhen).toBe('[data-tour="dialog-vrcc-tab"]');
        // **不该有倒计时**：定时器会在玩家什么都不做时把他推走，
        // 实测就是「放着不动也自己步进」。真正的推进信号是玩家点开详情。
        expect(firstRowStep.autoAdvanceMs).toBeUndefined();
    });

    it('榜单整体那一步同样不允许点', async () => {
        const { buildVrccTour } = await import('./vrccTourSteps');
        const steps = buildVrccTour();

        const boardStep = findStep(steps, '[data-tour="vrcc-maps-list"]');
        // 高亮的是整个榜单，随手一点就会打开详情，
        // 而后面的步骤是按「还没打开」编排的——顺序会立刻乱掉。
        expect(boardStep.blockInteraction).toBe(true);
    });

    it('顺序：榜单 → 第一行 → 详情 → 打分 → 排序', async () => {
        const { buildVrccTour } = await import('./vrccTourSteps');
        const steps = buildVrccTour();

        const order = [
            'vrcc-maps-list',
            'vrcc-maps-first-row',
            // 左栏那张评分卡片排在详情页签**之前**：它不用切页签就能看到，
            // 是玩家打开一张图时的第一眼。
            'world-vrcc-rating-card',
            'world-vrcc-overview',
            'world-vrcc-rating',
            'vrcc-maps-sorts'
        ].map((selector) =>
            steps.indexOf(findStep(steps, `[data-tour="${selector}"]`))
        );

        // 严格递增：排序必须排在详情后面。
        // 排在中间会把「点一行开详情」和「详情页」拆成两半，
        // 而且中场还要把玩家打开的详情关掉——讲得断断续续。
        for (let i = 1; i < order.length; i += 1) {
            expect(order[i]).toBeGreaterThan(order[i - 1]);
        }
    });

    it('打开详情的动作**不会**在走不到那一步时提前执行', async () => {
        const { buildVrccTour } = await import('./vrccTourSteps');
        const steps = buildVrccTour();

        // 这是踩过的坑：早先把 prepare 写在 element 的求值函数里，而 driver
        // 会为了「判断后面还有没有步骤」扫描后续步骤并调用求值函数，
        // 于是玩家还在第 7 步，第 8 步的「打开详情」就自己执行了。
        //
        // 现在「提前准备」只挂在 `prepareNext` 上，由**前一步**的
        // onHighlightStarted 触发，不会被扫描带出来。
        for (const step of steps) {
            expect(typeof step.element === 'function').toBe(false);
        }
    });

    it('只有一份导览，不按连接状态分叉', async () => {
        const mod = await import('./vrccTourSteps');

        // 早先这里还有个 `buildVrccConnectOnlyTour`，给「已经连上」的人只走
        // 三步就结束。那个设计是错的：
        // - 它把「连接做过了」当成「后面都不必看」，玩家在第三步就到终点，
        //   看起来像导览坏了；
        // - 连接状态本来只需要改变**那一步怎么说**——连接步骤自己有
        //   `variant.when`，已连接时讲「这一步你已经做完了，点下一步继续」，
        //   高亮照样落在连接卡片上。
        expect(
            (mod as Record<string, unknown>).buildVrccConnectOnlyTour
        ).toBeUndefined();
    });

    it('已连接时连接步骤改说「你已经做完了」，而不是跳过它', async () => {
        const { buildVrccTour } = await import('./vrccTourSteps');
        const steps = buildVrccTour();

        const connectStep = findStep(steps, '[data-tour="vrcc-me-connect"]');
        expect(connectStep.variant).toBeTruthy();
        // 文案键切成「已连接」那一组：行程不变、高亮不变。
        expect(connectStep.variant?.titleKey).toBe(
            'vrcc.tour.connect.connected_title'
        );
    });

    it('每个页面级步骤都自己切页，不依赖上一步没被跳过', async () => {
        const { buildVrccTour } = await import('./vrccTourSteps');
        const steps = buildVrccTour();

        // 锚点归属哪一页。`null` 表示不挑页（哪一页都在）。
        const pageOf: Record<string, string | null> = {
            'vrcc-tabs': 'maps',
            'vrcc-maps-list': 'maps',
            'vrcc-maps-first-row': 'maps',
            'vrcc-maps-sorts': 'maps',
            'world-vrcc-rating-card': null,
            'world-vrcc-overview': null,
            'world-vrcc-rating': null,
            'vrcc-notif-header': 'notifications',
            'vrcc-unread-counts': 'notifications',
            'vrcc-notif-list': 'notifications',
            'vrcc-mutuals-list': 'mutuals',
            'vrcc-community': 'mutuals',
            'vrcc-crossings-list': 'crossings',
            'vrcc-me-usage': 'me'
        };

        for (const step of steps) {
            const selectors =
                typeof step.element === 'string'
                    ? [step.element]
                    : Array.isArray(step.element)
                      ? [...step.element]
                      : [];
            const anchor = selectors[0];
            if (!anchor) continue;
            const key = anchor.replace(/^\[data-tour="|"\]$/g, '');
            if (!(key in pageOf)) continue;
            if (pageOf[key] === null) continue; // 不挑页的（详情内两步）

            // driver 的跳过是递归的：一步没等到锚点就立刻试下一步。
            // 所以「上一个同页步骤被跳过」不能把页面留在别处——每一步都必须
            // 自报它需要哪一页。早先第 12 步（通知列表）和第 14 步（社区群）
            // 就漏了这个，靠前一步切页；前一步一被跳过，它们也接连失败。
            expect(step.prepare).toBeTruthy();
            openVrccTab.mockClear();
            step.prepare?.();
            expect(openVrccTab).toHaveBeenCalledWith(pageOf[key]);
        }
    });
});
