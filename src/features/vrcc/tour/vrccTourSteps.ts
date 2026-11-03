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
 * **同时用作 `prepare` 和 `prepareNext`**，这不是偷懒：
 *
 * - 作为 `prepareNext`（上一步进入时）：提前把页面切好，等 driver 来找锚点时
 *   它已经在 DOM 里了，**不会等超时**；
 * - 作为 `prepare`（这一步进入时）：**兜底保证自己所在的页面还在**。
 *
 * 只写 `prepareNext` 会出事：第 N 步进入时会去执行第 N+1 步的 `prepareNext`，
 * 于是第 N+1 步还没讲，页面已经被切到第 N+2 步的地方了。实测就是这样——
 * 第 3 步「先连接一次」的气泡停着，界面却已经跳到地图榜，高亮框落在地图列表上。
 *
 * 幂等：切到已经在的页签是空操作，`closeDialog()` 在没有对话框时也是空操作。
 */
function onPage(tab?: VrccTabTarget): () => void {
    return () => {
        backToPage();
        if (tab) openVrccTab(tab);
    };
}

function openFirstBoardWorld(): void {
    const state = useDialogStore.getState();

    // **详情已经开着时，直接用它。**
    //
    // 早先这里无条件 `backToPage()`（关掉再开），理由是「换实体是压栈，
    // 不关会留下 A→B 历史」。但玩家在第 7 步点开第一行时，详情已经弹出来
    // 了，我们再关掉等于把他刚打开的东西掐掉——实测就是「窗口弹出来又被
    // 生生掐掉，然后跳到第 10 步」。
    //
    // 这里**不用**去比对「开的是不是第一行那一张」：第 6 步封住了整个榜单，
    // 第 7 步只亮第一行，玩家能点开的就只有第一行。多写一个 id 比对等于
    // 为一个不存在的场景写分支，反而容易在 id 格式不一致时误判成「不对」
    // 然后关掉重开——又是同一类掐断。
    if (state.activeDialog?.kind === 'world' && state.activeDialog.entityId) {
        // 页签可能还停在「房间」，顺手切过去。
        openVrccTabInDialog();
        return;
    }

    const target = firstBoardWorld();
    if (!target) return;
    // 没有详情开着时，`openedWorld` 记住「这次导览开过哪张」，
    // 避免 `prepareNext` 被调用多次时反复打开。
    if (openedWorld === target) return;

    openedWorld = target;
    // 复用玩家自己的入口，取数与跳转逻辑一致，不会造出一个假的对话框。
    void import('@/services/dialogService').then(({ openWorldDialog }) => {
        openWorldDialog({ worldId: target, title: '' });
        // 详情默认落在「房间」页，「星遇同频」那页未激活时不渲染。
        // 等它挂载出来再点页签——直接点会因为元素还不存在而落空。
        openVrccTabInDialog();
    });
}

/**
 * 点开世界详情里的「星遇同频」页签。
 *
 * 那一页的内容**未激活时不渲染**（`EntityDialogTabContent` 没开 `keepMounted`），
 * 所以只打开详情还不够——还得切到这一页，概览和打分才有元素可以高亮。
 * 不切的话 driver 会等 1.2 秒后把这两步**跳过**，玩家看到的就是
 * 「第 7 步完了直接跳到第 10 步」。
 *
 * 用 `click()` 而不是直接改 store：对话框的页签状态是它内部的 `useState`，
 * 没有对外暴露。点一下与玩家自己点完全等价。
 *
 * **轮询等页签出现**，而不是写死一个 `setTimeout`：详情刚打开时页签条可能
 * 还没挂载（React 渲染 + 对话框过渡动画），固定延时在慢机器上会落空。
 */
function openVrccTabInDialog(retries = 20): void {
    const tab = document.querySelector<HTMLElement>(
        '[data-tour="dialog-vrcc-tab"]'
    );
    if (!tab) {
        // 页签条还没出来，下一帧再看。总共约 300ms，够一次渲染。
        if (retries > 0) {
            window.setTimeout(() => openVrccTabInDialog(retries - 1), 15);
        }
        return;
    }
    // 已经在这一页了就别再点一次（重复点会触发一次无意义的重渲染）。
    if (tab.getAttribute('data-active') !== null) return;
    tab.click();
}

/**
 * 详情两步的兜底：**详情没开着就重新打开**。
 *
 * 为什么需要：`prepare` 在元素解析之后才跑，此时如果详情已经被关掉（玩家自己
 * 关的，或者来回翻页时被某一步的 `onPage()` 顺手关了），这一步就永远等不到
 * 锚点。这里按「对话框还在不在」判断，不在就再开一次。
 *
 * 和 `openFirstBoardWorld` 的区别：那个是**无条件的提前打开**（还负责去重，
 * 避免重复压栈）；这个是**只在缺失时补**，已经开着就什么都不做——否则会在
 * 玩家正看着详情时又触发一次打开，闪一下。
 */
function reopenIfMissing(): void {
    if (!useDialogStore.getState().activeDialog) {
        openedWorld = null;
        openFirstBoardWorld();
        // 刚打开时页签是「房间」，要等它渲染出来才能点。
        openVrccTabInDialog();
        return;
    }
    openVrccTabInDialog();
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
            prepareNext: onPage('me'),
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
            prepareNext: onPage('maps'),
            prepare: onPage('maps'),
            titleKey: 'vrcc.tour.tabs.title',
            descriptionKey: 'vrcc.tour.tabs.description',
            side: 'bottom',
            align: 'start'
        },
        // 原来这里还有一步「你正在的地图」（`vrcc-current-map`）。
        // 删掉了：它要求玩家**正待在 VR 里**、且**那张图在榜上**才有东西可亮，
        // 而导览面向的是刚打开应用的新人——几乎总是被跳过。
        // 「榜单会标出你所在的那张图」这条信息并进了下面这一步的正文。
        {
            element: '[data-tour="vrcc-maps-list"]',
            prepareNext: onPage(),
            prepare: onPage(),
            titleKey: 'vrcc.tour.board.title',
            descriptionKey: 'vrcc.tour.board.description',
            // 榜单几乎占满内容区宽度，左右两侧都没有放气泡的地方（`left`
            // 会挤到侧栏上）。放 `bottom` 让它压在列表下缘：整个列表都被高亮，
            // 气泡盖住其中几行不影响「这是什么」，而且离窗口底还有空间。
            side: 'bottom',
            align: 'end',
            // **这一步关掉可点**。
            //
            // 高亮的正是整个榜单，如果这里允许点，玩家随手点一行就会打开详情，
            // 而后面的步骤是按「还没打开详情」编排的——顺序立刻乱掉，还得靠
            // 下一步把它关掉。先让他把这一屏看完，下一步再单独指一行。
            blockInteraction: true
        },
        {
            // 指认「具体是哪一行」。
            //
            // 下一步是地图详情页。不给这个预告的话，详情会**凭空弹出来**——
            // 玩家刚看完榜单，突然多一个窗口，像受了惊吓，也不明白在讲哪张图。
            // 所以先高亮第一行、说明「这就是接下来要打开的那张」，再自动进入。
            element: '[data-tour="vrcc-maps-first-row"]',
            prepareNext: onPage(),
            prepare: onPage(),
            titleKey: 'vrcc.tour.first_row.title',
            descriptionKey: 'vrcc.tour.first_row.description',
            side: 'right',
            align: 'center',
            // **允许点。** 这一行本来就是玩家会点的那一行，把它锁住只会让人
            // 觉得「点了没反应」。
            //
            // 两条路通向第 8 步（详情概览），谁先到算谁，引擎用「本步已推进」
            // 标记去重：
            // 1. 玩家自己点开详情 → `advanceWhen` 监听到 → 前进；
            // 2. 玩家按「下一步」→ `prepareNext` 打开详情 → 前进。
            //
            // **不设 `autoAdvanceMs`。** 那个定时器会在玩家什么都不做时把
            // 他推走——实测就是「放着不动也会自己步进」，而它本来只是我早期
            // 没有监听方案时的兜底。现在 `advanceWhen` 才是真正的「跟着玩家
            // 的动作走」，不需要也不该再有倒计时。
            //
            // 监听对象是**页签条上的「星遇同频」**，不是概览区。
            // 概览区在「星遇同频」页签内，而详情打开时默认停在「房间」——
            // 拿它当信号等于在等一个永远不出现的东西（实测：点了行、详情也
            // 弹出来了，却一直不跳步）。页签条在详情挂载时就存在，任何一行
            // 都适用。
            advanceWhen: '[data-tour="dialog-vrcc-tab"]',
            // 榜单为空时没有这一行可以指，直接跳到排序。
            skipIfMissing: true
        },

        // ── 地图详情（导览在这里替玩家打开第一张图）──────────────────
        {
            element: '[data-tour="world-vrcc-overview"]',
            // 提前打开（上一步进入时），这样 driver 找锚点时详情已经在渲染了。
            prepareNext: openFirstBoardWorld,
            // **这里不能再调 `onPage()`**：那会先把详情关掉，然后在「关掉之后」
            // 才去准备——详情没了，这一步永远等不到锚点。详情两步的兜底是
            // 「确保详情开着」，见下面。
            prepare: reopenIfMissing,
            titleKey: 'vrcc.tour.detail.title',
            descriptionKey: 'vrcc.tour.detail.description',
            side: 'left',
            align: 'start',
            // **不标 `skipIfMissing`。**
            //
            // 详情是导览自己负责打开的（上一步的 prepareNext），所以锚点缺失
            // 只可能是「渲染慢了一拍」，不是「这个功能不适用」。标成可跳过
            // 会让 driver 等 1.2 秒后就放弃——表现就是「第 7 步完了直接跳到
            // 第 10 步」。这里宁可多等一点，交给 driver 的默认 `waitForElement`
            // 去等它渲染出来。
            //
            // 例外只有一种：榜单为空时根本没有图可开。那种情况下 `prepareNext`
            // 打不开详情，`waitForElement` 会等满后停在原地——可接受，因为
            // 那本来就是数据不完整的状态。
            waitForElement: 4000
        },
        {
            element: '[data-tour="world-vrcc-rating"]',
            prepareNext: reopenIfMissing,
            prepare: reopenIfMissing,
            titleKey: 'vrcc.tour.rating.title',
            descriptionKey: 'vrcc.tour.rating.description',
            side: 'left',
            align: 'center',
            // 同上：详情由导览保证开着，等渲染，不当作「不存在」跳过。
            waitForElement: 4000
        },

        // ── 换个排法（讲完详情回到榜单页再讲）─────────────────────────
        {
            element: '[data-tour="vrcc-maps-sorts"]',
            // 详情还开着，先关掉再讲排序——排序是**榜单页**上的控件。
            prepareNext: onPage(),
            prepare: onPage(),
            titleKey: 'vrcc.tour.sorts.title',
            descriptionKey: 'vrcc.tour.sorts.description',
            side: 'bottom',
            align: 'start',
            // 不标 `skipIfMissing`：排序控件在榜单页上**必然存在**（榜单渲染出来
            // 才有这一页）。标了反而危险——从详情回来的那一帧元素还没就位，
            // driver 会把它当成「不存在」直接跳过，玩家按「上一步」就像退了两步。
            blockInteraction: false
        },

        // ── 提醒 ──────────────────────────────────────────────────
        {
            element: '[data-tour="vrcc-notif-header"]',
            // 从详情页回来：关掉对话框、切到提醒页。
            prepareNext: onPage('notifications'),
            prepare: onPage('notifications'),
            titleKey: 'vrcc.tour.notif_views.title',
            descriptionKey: 'vrcc.tour.notif_views.description',
            side: 'bottom',
            align: 'start',
            skipIfMissing: true
        },
        {
            // 高亮**红点区本身**，不是整个表头。
            //
            // 之前用的是 `vrcc-notif-header`，和上一步（视图切换）同一个锚点：
            // 同一块区域讲两遍，而且高亮框罩住的是「切换按钮 + 一片空白」，
            // 文案却在讲那四个数字——说的和指的完全不是一回事。
            element: '[data-tour="vrcc-unread-counts"]',
            prepareNext: onPage(),
            prepare: onPage(),
            titleKey: 'vrcc.tour.unread.title',
            descriptionKey: 'vrcc.tour.unread.description',
            side: 'bottom',
            align: 'end',
            // 星轨相交被服务端关掉、或一个计数都没有时这一块不存在，
            // 跳过比停在空白上好。
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
            prepareNext: onPage('mutuals'),
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
            prepareNext: onPage('crossings'),
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
            prepareNext: onPage('me'),
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
            prepareNext: onPage('me'),
            prepare: onPage('me'),
            titleKey: 'vrcc.tour.connect.title',
            descriptionKey: 'vrcc.tour.connect.description',
            side: 'right',
            align: 'start'
        }
    ];
}
