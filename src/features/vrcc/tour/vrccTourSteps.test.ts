// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

// 只关心「哪些步骤会把玩家带回页面级」，不真的渲染界面，
// 所以把页面/对话框那些副作用整体打桩。
const openVrccTab = vi.hoisted(() => vi.fn());
const closeDialog = vi.hoisted(() => vi.fn());

vi.mock('@/shared/utils/vrccNavigation', () => ({ openVrccTab }));
vi.mock('@/state/dialogStore', () => ({
    useDialogStore: { getState: () => ({ closeDialog }) }
}));
vi.mock('@/state/vrccUnreadStore', () => ({
    useVrccUnreadStore: { getState: () => ({ connected: false }) }
}));

describe('页面级步骤会先回到页面', () => {
    it('每个锚点在页面上的步骤都关一次对话框', async () => {
        const { buildVrccTour } = await import('./vrccTourSteps');
        const steps = buildVrccTour();

        // 第 7 步（排序切换）是踩过的那个：玩家在第 6 步自己点开了地图详情，
        // 按「下一步」后，排序控件被详情对话框盖住——driver 照样能查到它，
        // 于是画出一块被遮住的高亮，玩家看到的是「全屏遮罩、找不到控件」。
        const sortIndex = 6;
        expect(steps[sortIndex].element).toBe('[data-tour="vrcc-maps-sorts"]');

        closeDialog.mockClear();
        steps[sortIndex].prepare?.();
        expect(closeDialog).toHaveBeenCalled();

        // 提醒页那一步同理（玩家可能还停在详情里）。
        const notifIndex = 9;
        closeDialog.mockClear();
        steps[notifIndex].prepare?.();
        expect(closeDialog).toHaveBeenCalled();
        expect(openVrccTab).toHaveBeenCalledWith('notifications');
    });

    it('打开详情前会先关掉已有对话框，避免压栈', async () => {
        const { buildVrccTour } = await import('./vrccTourSteps');
        const steps = buildVrccTour();

        const detailIndex = 7;
        expect(steps[detailIndex].element).toBe(
            '[data-tour="world-vrcc-overview"]'
        );

        // 模拟玩家在第 6 步自己点开过一张图的详情：榜单容器里有一行。
        // 选择器是 `[data-tour="vrcc-maps-list"] [data-world]`——行在**里面**。
        const list = document.createElement('div');
        list.setAttribute('data-tour', 'vrcc-maps-list');
        const row = document.createElement('div');
        row.setAttribute('data-world', 'wrld_example');
        list.appendChild(row);
        document.body.appendChild(list);

        closeDialog.mockClear();
        steps[detailIndex].prepare?.();

        // `openEntityDialog` 换实体会**压栈**（`[...breadcrumbs, crumb]`），
        // 不是替换。玩家自己开过 A、导览再开 B，会留下 A→B 的历史——
        // 导览结束后按返回会莫名回到 A。所以必须先关再开。
        expect(closeDialog).toHaveBeenCalled();
        document.body.removeChild(list);
    });
});
