import { openVrccTab } from '@/shared/utils/vrccNavigation';
import { useDialogStore } from '@/state/dialogStore';

import type { TourStep } from './vrccTour';

/**
 * 星遇同频导览的内容。
 *
 * ## 顺序
 *
 * 照玩家真正会走的路径：认识入口 → 连接 → 地图榜（所在地图 / 榜单 / 排序 /
 * 详情 / 概览 / 打分短评）→ 提醒（视图切换 / 未读红点 / 点开看原文）→
 * 连上（在线状态 / 社区群）→ 星轨相交 → 用量与结束。
 *
 * ## 每步只讲一个动作
 *
 * 高亮一个控件、给一句话。把三件事塞进一句话，等于三件都没讲。
 *
 * ## 有条件出现的功能
 *
 * 星轨相交在 16–17 岁星池、或玩家关掉它时整个页签都不存在；社区群要特定权限。
 * 这类步骤标 `skipIfMissing`：缺了跳过，不把玩家卡在半空中。核心步骤（入口、
 * 连接、榜单）不标——那些锚点缺了就是真出问题，应该看得出来。
 *
 * ## 会真的打开一个对话框
 *
 * 「详情」「概览」「打分」三步必须先把世界详情打开，否则锚点不在 DOM 里。用玩家
 * 自己的入口打开，导览结束时关掉。**不替玩家打分**——那一步只高亮控件。
 */

/** 拿到榜单里第一张图的 world id，用来打开它的详情。 */
function firstBoardWorld(): string | null {
    // 从 DOM 取，而不是再请求一次榜单：导览只需要「玩家此刻看得见的第一行」。
    const row = document.querySelector<HTMLElement>(
        '[data-tour="vrcc-maps-list"] [data-world]'
    );
    return row?.dataset.world?.trim() || null;
}

function openFirstBoardWorld(): void {
    const world = firstBoardWorld();
    if (!world) return;
    // 复用玩家自己的入口，取数与跳转逻辑一致，不会造出一个假的对话框。
    void import('@/services/dialogService').then(({ openWorldDialog }) => {
        openWorldDialog({ worldId: world, title: '' });
    });
}

function closeAnyDialog(): void {
    useDialogStore.getState().closeDialog();
}

export function buildVrccTour(): readonly TourStep[] {
    return [
        // ── 认识它 ────────────────────────────────────────────────
        {
            // 首步没有锚点：先讲「这是什么」。遮罩下面就是真实界面，
            // 不需要额外截图。
            titleKey: 'vrcc.tour.intro.title',
            descriptionKey: 'vrcc.tour.intro.description',
            side: 'bottom',
            align: 'center'
        },
        {
            element: '[data-tour="nav-vrcc"]',
            titleKey: 'vrcc.tour.entry.title',
            descriptionKey: 'vrcc.tour.entry.description',
            side: 'right',
            align: 'center'
        },

        // ── 连接 ──────────────────────────────────────────────────
        {
            element: '[data-tour="vrcc-me-connect"]',
            before: () => openVrccTab('me'),
            titleKey: 'vrcc.tour.connect.title',
            descriptionKey: 'vrcc.tour.connect.description',
            side: 'right',
            align: 'start'
        },

        // ── 地图榜 ────────────────────────────────────────────────
        {
            element: '[data-tour="vrcc-tabs"]',
            before: () => openVrccTab('maps'),
            titleKey: 'vrcc.tour.tabs.title',
            descriptionKey: 'vrcc.tour.tabs.description',
            side: 'bottom',
            align: 'start'
        },
        {
            element: '[data-tour="vrcc-current-map"]',
            titleKey: 'vrcc.tour.current_map.title',
            descriptionKey: 'vrcc.tour.current_map.description',
            side: 'bottom',
            align: 'start',
            // 不在榜上时这张卡不渲染——那不是说错话，是根本不适用。
            skipIfMissing: true
        },
        {
            element: '[data-tour="vrcc-maps-list"]',
            titleKey: 'vrcc.tour.board.title',
            descriptionKey: 'vrcc.tour.board.description',
            side: 'top',
            align: 'start',
            // 这一屏没有可点的东西，点遮罩往前走是合理的：等的是
            // 「看完了」，不是「做完了某件事」。
            advanceOnClick: true
        },
        {
            element: '[data-tour="vrcc-maps-sorts"]',
            titleKey: 'vrcc.tour.sorts.title',
            descriptionKey: 'vrcc.tour.sorts.description',
            side: 'bottom',
            align: 'start',
            skipIfMissing: true
        },

        // ── 地图详情（会真的打开一个对话框）────────────────────────
        {
            element: '[data-tour="world-vrcc-overview"]',
            before: openFirstBoardWorld,
            titleKey: 'vrcc.tour.detail.title',
            descriptionKey: 'vrcc.tour.detail.description',
            side: 'left',
            align: 'start',
            // 榜单为空（或全不在榜）时打不开详情，这两步就没有意义。
            skipIfMissing: true
        },
        {
            element: '[data-tour="world-vrcc-rating"]',
            titleKey: 'vrcc.tour.rating.title',
            descriptionKey: 'vrcc.tour.rating.description',
            side: 'left',
            align: 'center',
            skipIfMissing: true
        },

        // ── 提醒 ──────────────────────────────────────────────────
        {
            element: '[data-tour="vrcc-notif-header"]',
            before: () => {
                closeAnyDialog();
                openVrccTab('notifications');
            },
            titleKey: 'vrcc.tour.notif_views.title',
            descriptionKey: 'vrcc.tour.notif_views.description',
            side: 'bottom',
            align: 'start',
            skipIfMissing: true
        },
        {
            element: '[data-tour="vrcc-notif-header"]',
            titleKey: 'vrcc.tour.unread.title',
            descriptionKey: 'vrcc.tour.unread.description',
            side: 'bottom',
            align: 'end',
            skipIfMissing: true
        },
        {
            element: '[data-tour="vrcc-notif-list"]',
            titleKey: 'vrcc.tour.notif_open.title',
            descriptionKey: 'vrcc.tour.notif_open.description',
            side: 'top',
            align: 'start',
            skipIfMissing: true
        },

        // ── 连上 ──────────────────────────────────────────────────
        {
            element: '[data-tour="vrcc-mutuals-list"]',
            before: () => openVrccTab('mutuals'),
            titleKey: 'vrcc.tour.mutuals.title',
            descriptionKey: 'vrcc.tour.mutuals.description',
            side: 'top',
            align: 'start',
            // 没连上人、或没有 `mutuals` 权限时列表是空的。
            skipIfMissing: true
        },
        {
            element: '[data-tour="vrcc-community"]',
            titleKey: 'vrcc.tour.community.title',
            descriptionKey: 'vrcc.tour.community.description',
            side: 'top',
            align: 'start',
            skipIfMissing: true
        },

        // ── 星轨相交 ──────────────────────────────────────────────
        {
            element: '[data-tour="vrcc-crossings-list"]',
            before: () => openVrccTab('crossings'),
            titleKey: 'vrcc.tour.crossings.title',
            descriptionKey: 'vrcc.tour.crossings.description',
            side: 'top',
            align: 'start',
            // 16–17 岁星池、或玩家在隐私设置里关了它 → 页签不存在。
            skipIfMissing: true
        },

        // ── 用量与结束 ────────────────────────────────────────────
        {
            element: '[data-tour="vrcc-me-usage"]',
            before: () => openVrccTab('me'),
            titleKey: 'vrcc.tour.usage.title',
            descriptionKey: 'vrcc.tour.usage.description',
            side: 'top',
            align: 'start',
            skipIfMissing: true
        },
        {
            titleKey: 'vrcc.tour.outro.title',
            descriptionKey: 'vrcc.tour.outro.description',
            side: 'bottom',
            align: 'center'
        }
    ];
}

/**
 * 只讲「入口 → 连接」的最短版本。
 *
 * 给已经连上、但重看引导的人：后面那些步骤讲的是他本来就看得到的东西，
 * 再走一遍只是拖时间。
 */
export function buildVrccConnectOnlyTour(): readonly TourStep[] {
    return [
        {
            titleKey: 'vrcc.tour.intro.title',
            descriptionKey: 'vrcc.tour.intro.description',
            side: 'bottom',
            align: 'center'
        },
        {
            element: '[data-tour="nav-vrcc"]',
            titleKey: 'vrcc.tour.entry.title',
            descriptionKey: 'vrcc.tour.entry.description',
            side: 'right',
            align: 'center'
        },
        {
            element: '[data-tour="vrcc-me-connect"]',
            before: () => openVrccTab('me'),
            titleKey: 'vrcc.tour.connect.title',
            descriptionKey: 'vrcc.tour.connect.description',
            side: 'right',
            align: 'start'
        }
    ];
}
