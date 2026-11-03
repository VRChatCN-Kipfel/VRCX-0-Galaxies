import { openVrccTab, type VrccTabTarget } from '@/shared/utils/vrccNavigation';
import { useDialogStore } from '@/state/dialogStore';
import { useVrccUnreadStore } from '@/state/vrccUnreadStore';

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

/**
 * 已经为哪张图开过详情。
 *
 * `prepare` 会被反复调用（等待期间每次 DOM 变动都重求值），而开对话框不是
 * 幂等的——不去重就会连开好几次、还叠出一串历史记录。这里记住「上一次开的
 * 是哪张」，同一张图重复请求直接跳过；换一张图（玩家在榜单里翻到了别的）
 * 才重新开。
 */
let openedWorld: string | null = null;

/**
 * 回到「页面级」：把导览期间打开的地图详情关掉。
 *
 * **每个页面级步骤都要先调它。** 玩家可以自己点开详情（那是被允许的，
 * 高亮区可点），然后按「下一步」——下一个页面级步骤（例如排序切换）高亮的是
 * 榜单页上的控件，而此时它被详情对话框整个盖住。driver 照样能 `querySelector`
 * 到它（它在 DOM 里），于是画出一块被对话框遮住的高亮和气泡，玩家看到的就是
 * 「全屏遮罩、找不到控件」。
 *
 * 幂等：没有对话框时 `closeDialog()` 什么也不做。
 */
function backToPage(): void {
    openedWorld = null;
    useDialogStore.getState().closeDialog();
}

/**
 * 页面级步骤的准备动作：关掉对话框（可选）再切到某个页签。
 *
 * 每个锚点在**页面**上的步骤都用它。玩家可以自己点开地图详情（高亮区可点，
 * 那是被允许的），然后按「下一步」——下一个页面级步骤高亮的是榜单页上的控件，
 * 而它此刻被对话框整个盖住。driver 照样 `querySelector` 得到它（它在 DOM 里），
 * 于是画出一块被遮住的高亮和气泡，玩家看到的就是「全屏遮罩、找不到控件」。
 *
 * 组合成一个函数而不是让每步各写两行：少一处漏写，就少一次这种故障。
 */
function onPage(tab?: VrccTabTarget): () => void {
    return () => {
        backToPage();
        if (tab) openVrccTab(tab);
    };
}

function openFirstBoardWorld(): void {
    const world = firstBoardWorld();
    if (!world) return;
    if (openedWorld === world) return;

    // **先关掉玩家自己开的那个。**
    //
    // `openEntityDialog` 换一个实体时是**压栈**（`[...breadcrumbs, crumb]`），
    // 不是替换。玩家在第 6 步点开过图 A，这里再开图 B，就会得到 A→B 的历史，
    // 玩家在导览结束按返回时会莫名回到 A——那不是导览该留下的东西。
    //
    // 关掉再开等于「只打开导览要讲的那一张」。同一张图时上面已经提前返回，
    // 不会出现关了又开的闪烁。
    backToPage();

    openedWorld = world;
    // 复用玩家自己的入口，取数与跳转逻辑一致，不会造出一个假的对话框。
    void import('@/services/dialogService').then(({ openWorldDialog }) => {
        openWorldDialog({ worldId: world, title: '' });
    });
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
            // 连接卡片**和它下方弹出的授权码面板一起点亮**。
            //
            // 只亮上面那块的话，玩家看不到「点了会出码、码已自动复制、
            // 页面会自动打开」这条链路——那三样都在下面那块里，被暗层盖住
            // 等于没讲。授权码面板只在点了「开始连接」之后才存在，所以这里
            // 把它列为可选：还没点的时候只亮连接卡片，不为此卡住。
            element: [
                '[data-tour="vrcc-me-connect"]',
                '[data-tour="vrcc-me-auth"]'
            ],
            prepare: onPage('me'),
            titleKey: 'vrcc.tour.connect.title',
            descriptionKey: 'vrcc.tour.connect.description',
            // 已经连上的人不该再被教「先连接一次」——界面明明写着「已连接」。
            variant: {
                when: () => useVrccUnreadStore.getState().connected,
                titleKey: 'vrcc.tour.connect.connected_title',
                descriptionKey: 'vrcc.tour.connect.connected_description'
            },
            side: 'right',
            align: 'start'
        },

        // ── 地图榜 ────────────────────────────────────────────────
        {
            element: '[data-tour="vrcc-tabs"]',
            prepare: onPage('maps'),
            titleKey: 'vrcc.tour.tabs.title',
            descriptionKey: 'vrcc.tour.tabs.description',
            side: 'bottom',
            align: 'start'
        },
        {
            element: '[data-tour="vrcc-current-map"]',
            prepare: onPage(),
            titleKey: 'vrcc.tour.current_map.title',
            descriptionKey: 'vrcc.tour.current_map.description',
            side: 'bottom',
            align: 'start',
            // 不在榜上时这张卡不渲染——那不是说错话，是根本不适用。
            skipIfMissing: true
        },
        {
            element: '[data-tour="vrcc-maps-list"]',
            prepare: onPage(),
            titleKey: 'vrcc.tour.board.title',
            descriptionKey: 'vrcc.tour.board.description',
            // 榜单几乎占满内容区宽度，左右两侧都没有放气泡的地方（`left`
            // 会挤到侧栏上）。放 `bottom` 让它压在列表下缘：整个列表都被高亮，
            // 气泡盖住其中几行不影响「这是什么」，而且离窗口底还有空间。
            side: 'bottom',
            align: 'end'
            // **不要 `advanceOnClick`**。它的语义是「点这个高亮元素就前进」，
            // 而这一屏高亮的正是榜单本身——玩家想点一行看详情，导览会把他
            // 推到下一步，等于抢走了这个动作。
            //
            // 高亮区可点、暗层不可点，正是我们要的：让他真的点开一张图，
            // 下一步「详情」才接得上。
        },
        {
            element: '[data-tour="vrcc-maps-sorts"]',
            // 玩家很可能在上一屏自己点开了一张图的详情，然后按「下一步」。
            // 这条 `onPage()` 就是那次「把详情关掉、回到榜单页」——
            // 少了它，排序控件被对话框盖住，玩家看到的是全屏遮罩。
            prepare: onPage(),
            titleKey: 'vrcc.tour.sorts.title',
            descriptionKey: 'vrcc.tour.sorts.description',
            side: 'bottom',
            align: 'start',
            skipIfMissing: true
        },

        // ── 地图详情（会真的打开一个对话框）────────────────────────
        {
            element: '[data-tour="world-vrcc-overview"]',
            prepare: openFirstBoardWorld,
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
            // 从详情页回来：关掉对话框、切到提醒页。
            prepare: onPage('notifications'),
            titleKey: 'vrcc.tour.notif_views.title',
            descriptionKey: 'vrcc.tour.notif_views.description',
            side: 'bottom',
            align: 'start',
            skipIfMissing: true
        },
        {
            element: '[data-tour="vrcc-notif-header"]',
            prepare: onPage(),
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
            // 列表占满剩余高度、左右都占满，上方是视图切换与红点那一行。
            // 放 `bottom` 压在列表下缘：那一行刚讲完，不该被盖住。
            side: 'bottom',
            align: 'end',
            skipIfMissing: true
        },

        // ── 连上 ──────────────────────────────────────────────────
        {
            element: '[data-tour="vrcc-mutuals-list"]',
            prepare: onPage('mutuals'),
            titleKey: 'vrcc.tour.mutuals.title',
            descriptionKey: 'vrcc.tour.mutuals.description',
            // 列表撑满整页高度，左右都占满；放 `bottom` 压在列表下缘，
            // 下面是社区群卡片，不会被遮到关键内容。
            side: 'bottom',
            align: 'end',
            // 没连上人、或没有 `mutuals` 权限时列表是空的。
            skipIfMissing: true
        },
        {
            element: '[data-tour="vrcc-community"]',
            titleKey: 'vrcc.tour.community.title',
            descriptionKey: 'vrcc.tour.community.description',
            // 社区群卡片在页面最底部：`bottom` 会顶出窗口，`top` 会盖住列表尾部，
            // `left` 在卡片左侧、正好有空间。
            side: 'left',
            align: 'start',
            skipIfMissing: true
        },

        // ── 星轨相交 ──────────────────────────────────────────────
        {
            element: '[data-tour="vrcc-crossings-list"]',
            prepare: onPage('crossings'),
            titleKey: 'vrcc.tour.crossings.title',
            descriptionKey: 'vrcc.tour.crossings.description',
            // 列表纵向很长、左右占满；放 `bottom` 压在它下缘，不与页签条打架。
            side: 'bottom',
            align: 'end',
            // 16–17 岁星池、或玩家在隐私设置里关了它 → 页签不存在。
            skipIfMissing: true
        },

        // ── 用量与结束 ────────────────────────────────────────────
        {
            element: '[data-tour="vrcc-me-usage"]',
            prepare: onPage('me'),
            titleKey: 'vrcc.tour.usage.title',
            descriptionKey: 'vrcc.tour.usage.description',
            // 用量卡片在「我的」页靠下的位置，它下面还有免责声明和重看入口。
            // 放 `bottom` 会正正压住那两块；放 `left` 则在卡片左侧、不挡任何东西。
            side: 'left',
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
            prepare: onPage('me'),
            titleKey: 'vrcc.tour.connect.title',
            descriptionKey: 'vrcc.tour.connect.description',
            side: 'right',
            align: 'start'
        }
    ];
}
