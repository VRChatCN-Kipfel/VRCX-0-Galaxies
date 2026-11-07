// SPDX-License-Identifier: MPL-2.0

import { driver, type Config, type Driver, type DriveStep } from 'driver.js';

import i18n from '@/services/i18nService';
import { useVrccTourActiveStore } from '@/state/vrccTourActiveStore';
import { useVrccTourDemoStore } from '@/state/vrccTourDemoStore';

import { renderTourMarkdown } from './TourMarkdown';

/**
 * 星遇同频的导览引擎。
 *
 * 用 driver.js 做「压暗整个界面、在真实控件上挖一个洞高亮它」——玩家看到的是
 * 自己的界面，不是一张截图或一段说明。每步只讲一个动作。
 *
 * ## 一个单例
 *
 * 高亮层挂在 `body` 上，同一时刻只能有一份。做成单例还顺带解决语言切换：
 * 文本是构建时求值的，切语言后要 `setConfig` 重放。
 *
 * ## 跨页：靠「求值锚点时顺手准备界面」
 *
 * 这一步是踩过坑才定下来的，写清楚免得以后改回去。
 *
 * driver 进入某一步的顺序（压缩后的源码）：
 * ```js
 * function v(i) {
 *   let a = step.waitForElement ?? config.waitForElement ?? 0;
 *   // ① 元素不在 → 开 MutationObserver 等它，命中立刻继续，超时才兜底
 *   if (a > 0 && step.element && !f(step.element)) { _(step, a, () => v(i, true)); return }
 *   // ② 进入这一步：先解析元素，再调 onHighlightStarted
 *   X(ctx, step)   // X 里 f(step.element)，然后 oe() 调 onHighlightStarted
 * }
 * function f(e) {
 *   return typeof e === 'function' ? e() : typeof e === 'string' ? document.querySelector(e) : e
 * }
 * ```
 *
 * 三个要点：
 *
 * 1. `f()` 对**函数形式**的 element 每次都调用，而且**先于** `onHighlightStarted`。
 *    所以「切页签 / 开对话框」必须写在 element 的求值函数里——那是唯一早于
 *    解析的时刻。放进 `onHighlightStarted` 就晚了：那时元素已被判定不存在、
 *    换成了居中的 dummy，于是页切过去了、高亮却没了。
 * 2. 等待器是 MutationObserver 驱动的（DOM 一变就重查），命中**立刻**进入，
 *    不会傻等满超时。所以超时值只是「元素一直不出现」时的兜底，正常路径是
 *    几十毫秒。前提是准备动作在等待**之前**就发出去了——也就是第 1 点。
 * 3. 函数必须幂等：等待期间每次 DOM 变动都会重新求值，同一个切换动作可能
 *    被调用很多次。
 */

/** 一步导览。 */
export type TourStep = {
    /**
     * 高亮哪个元素。省略表示不依赖 DOM（居中气泡）。
     *
     * 可以给**多个选择器**：它们会一起被挖进同一个高亮洞里。用在「这几块
     * 合起来才是一件事」的地方——例如连接那一步，连接卡片与它下方弹出的
     * 授权码面板必须同时亮着，玩家才能看懂「点了会出码、码会自动复制、
     * 页面会自动打开」这条完整链路。
     *
     * **第一个是必需的，其余是「有就一起亮」**。因为有些块是点过之后才出现
     * 的（授权码面板要等玩家真的点了「开始连接」），把它当必需条件会让那一步
     * 永远等不到、最后整步被跳过。
     */
    element?: string | readonly string[];
    /**
     * 求值锚点时先做的事：切页签、开对话框这类。
     *
     * **可以且会被多次调用**（等待期间每次 DOM 变动都会重新求值），
     * 所以必须幂等——重复切到同一个页签没问题，重复开对话框就不行。
     *
     * ⚠️ 只在**已经进入这一步**时执行（`onHighlightStarted`），所以它不能用来
     * 「让锚点出现」——那时元素早就解析完了。要变出锚点请用 `prepareNext`。
     */
    prepare?: () => void;
    /**
     * 在**上一步**就把这一步需要的界面准备好。
     *
     * 这是「切页签 / 开对话框」的正确落点：`prepare` 跑的时候 driver 已经找过
     * 元素了，此时才切页就晚了——它会在旧页面上找新页面的锚点，等着超时，
     * 最后退化成居中的 dummy 气泡。
     *
     * 为什么不能塞进 element 的求值函数（我试过）：driver 会为了「判断后面还有
     * 没有步骤」而**扫描**后续步骤并调用求值函数，于是这些动作在玩家还没走到时
     * 就被提前触发了——表现是「我没点，详情却自己打开了」。
     *
     * `prepareNext` 只在真正进入**前一步**时调一次，既有足够的提前量，又不会被
     * 无关的扫描触发。
     */
    prepareNext?: () => void;
    /** 标题与正文的本地化键。 */
    titleKey: string;
    descriptionKey: string;
    /**
     * 另一种状态下要说的话。
     *
     * 有的步骤在不同前提下讲的不是同一件事：连接那一步，没连上时该教他点，
     * 已经连上时再喊「先连接一次」只会让人困惑——界面明明白白写着「已连接」。
     * 用 `when` 现判一次，命中就用这一组文案。
     */
    variant?: {
        when: () => boolean;
        titleKey: string;
        descriptionKey: string;
    };
    side?: 'top' | 'right' | 'bottom' | 'left';
    align?: 'start' | 'center' | 'end';
    /** 点高亮元素本身前进（只用于「这里没什么可操作」的讲解步）。 */
    advanceOnClick?: boolean;
    /**
     * 关掉高亮区域的可点性，让这一步只能「看」。
     *
     * 对应 driver 的 `disableActiveInteraction`（给锚点加
     * `driver-no-interaction`，CSS 是 `pointer-events: none !important`）。
     *
     * 用在两种地方：
     * - 高亮范围很大、又不是要玩家点的（例如整个榜单）——玩家随手一点就会
     *   打开详情，而后续步骤是按「还没打开」编排的，顺序立刻乱掉；
     * - 纯粹是「预告」的一步（指认接下来要打开的那一行），点了会和下一步重复。
     *
     * 反过来说，**要玩家真的去点的步骤绝不能开**——那会让他点不动，看起来
     * 就是「按钮坏了」。
     */
    blockInteraction?: boolean;
    /**
     * 高亮范围内**只读**的那些目标（按下标，对应 `element` 的第几项）。
     *
     * 用途：有些步骤要把一大块拉进高亮范围好让玩家看清上下文，但那一块里
     * 只有一小部分该可点。例如「换个排法」同时点亮排序行和榜单——不点亮
     * 榜单就看不到切换的效果，可点亮之后 driver 会把**整块**都放行，玩家
     * 随手点一行就跳去详情了，而这个步骤不是在讲「怎么打开详情」。
     *
     * driver 没有「锚点里只放行部分子元素」的开关：
     * - `.driver-active-element *` 会放行整块；
     * - `disableActiveInteraction` 又会连该点的排序按钮一起禁掉。
     *
     * 所以用反向标记 `data-tour-readonly`（见 `globals.css`）：被标上的子树
     * 整体关掉指针事件，其余部分照常可点。
     *
     * **按下标而不是选择器**：同一个元素在不同步骤里可能要可点、可能只读，
     * 用下标只影响这一步。
     */
    readOnly?: readonly number[];
    /**
     * 停多久之后**自动进入下一步**（毫秒）。省略表示不自动前进。
     *
     * 给「纯预告」的步骤用：它没有操作可做，也不该让玩家自己点——例如
     * 「下一屏会打开这一行」，指完就该自动过去。留着让玩家点「下一步」，
     * 他多半会先试着点高亮区（而那里被 `blockInteraction` 关掉了），
     * 感觉像「点了没反应」。
     */
    autoAdvanceMs?: number;
    /**
     * 这个元素一出现，就**立刻进入下一步**。
     *
     * 用在「玩家可能自己动手」的步骤上，和「点下一步」**双管齐下**：
     * - 玩家点了高亮区里的真实控件 → 目标元素出现 → 自动前进；
     * - 玩家没点、直接按「下一步」→ `prepareNext` 把那东西打开 → 也是前进。
     *
     * 两条路都通向同一步，谁先到算谁，靠一个「已经推进过」的标记去重，
     * 所以不会因为打开了一次就跳两步。
     *
     * 例：第 7 步高亮榜单第一行，玩家点开详情就进第 8 步；不点就按「下一步」，
     * 同样打开详情并进第 8 步。
     */
    advanceWhen?: string;
    /**
     * 元素不存在时跳过这一步，而不是停下来。
     *
     * 给**有条件出现**的功能用：星轨相交在 16–17 岁星池、或玩家关掉它时整个
     * 页签都不存在；没有权限时社区群也不显示。这些不是故障，硬停在半空中
     * 让玩家盯着一句「找不到元素」才是故障。
     *
     * 核心步骤（入口、连接、榜单）不用这一项：那些锚点必须存在，缺了就是
     * 真出问题，应该看得出来。
     */
    skipIfMissing?: boolean;
    /**
     * 等锚点多长时间（毫秒）。省略按默认：可跳过的步骤 1200、核心步骤 2500。
     *
     * 给「导览自己保证会出现、但渲染可能要久一点」的步骤用——例如地图详情，
     * 它由上一步的 `prepareNext` 打开，慢一拍的渲染不该被当成「不存在」。
     */
    waitForElement?: number;
};

let instance: Driver | null = null;
let activeSteps: TourStep[] = [];
/** 导览结束（走完或被关掉）时回调，用来记「看过」和清理临时打开的东西。 */
let onFinished: (() => void) | null = null;
/**
 * 多元素高亮时临时插进 DOM 的包裹层。
 *
 * driver 只接受**一个**元素作为高亮目标。要同时亮好几块，只能造一个覆盖它们
 * 包围盒的空框，把那个框交给 driver。框本身不可见、不拦截点击（见 CSS
 * `[data-tour-frame]`），真正还能点的仍然是被它盖住的那几个真实控件。
 */
let anchorFrame: HTMLElement | null = null;
/** 当前这一步要一起点亮的那些选择器（第一个必需）。 */
let anchorSelectors: readonly string[] = [];
/** 观察 DOM 变化，用来跟上「玩家点出来的新面板」。 */
let anchorObserver: MutationObserver | null = null;
/** 合并同一帧内的多次 mutation。 */
let anchorQueued: number | null = null;
/** 高亮框位移跟随的清理函数。 */
let stopFollow: (() => void) | null = null;

/**
 * 让高亮框跟着元素走。
 *
 * ## 为什么需要
 *
 * driver 在**画高亮的那一刻**量一次元素位置，之后不再量。页面一旦重排——
 * 上面的列表加载完了、图片撑开了、内容被挤了——元素就移位了，而高亮框还留在
 * 原处。实测：第 14 步「社区群」的高亮框停在卡片原来的位置，卡片已经被上面的
 * 互关列表推到下面去了，看起来就是「这一步没有高亮」。
 *
 * ## 做法
 *
 * 记下量到的几何，之后每次变化都跟原值比；真的偏了才 `refresh()`
 * （它会重画高亮洞与气泡，位置重新量）。两种触发源：
 * - `ResizeObserver`：元素自身尺寸变了（内容加载、图片撑开）；
 * - DOM 变动：元素尺寸没变、但被上面的东西推下去了。
 *
 * 只在偏移 >1px 时刷新，否则每次细微抖动都重画，反而闪。
 */
function followAnchor(element: Element, refresh: () => void): void {
    stopAnchorFollow();

    let last = toRect(element);
    let frame: number | null = null;

    const check = () => {
        frame = null;
        const next = toRect(element);
        if (!next) return;
        const moved =
            Math.abs(next.top - last!.top) > 1 ||
            Math.abs(next.left - last!.left) > 1 ||
            Math.abs(next.width - last!.width) > 1 ||
            Math.abs(next.height - last!.height) > 1;
        if (!moved) return;
        last = next;
        refresh();
    };

    const schedule = () => {
        if (frame !== null) return;
        frame = window.requestAnimationFrame(check);
    };

    const layout = new MutationObserver(schedule);
    layout.observe(document.body, { childList: true, subtree: true });

    let resize: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
        resize = new ResizeObserver(schedule);
        resize.observe(element);
    }

    stopFollow = () => {
        layout.disconnect();
        resize?.disconnect();
        if (frame !== null) window.cancelAnimationFrame(frame);
        frame = null;
        stopFollow = null;
    };
}

function toRect(element: Element) {
    const r = element.getBoundingClientRect();
    return { top: r.top, left: r.left, width: r.width, height: r.height };
}

function stopAnchorFollow(): void {
    stopFollow?.();
    stopFollow = null;
}

/** 自动前进的计时器（`autoAdvanceMs`）。 */
let autoAdvanceTimer: number | null = null;
/** 监听「目标元素出现就前进」（`advanceWhen`）。 */
let advanceWhenObserver: MutationObserver | null = null;
/**
 * 这一步是否已经推进过。
 *
 * 两条路（玩家自己点 / 按「下一步」）都会触发推进，必须去重，
 * 否则一次打开详情会跳两步。每进入新的一步时重置。
 */
let advancedForStep: number | null = null;
/**
 * 正在推进中（等待对话框退场那一小段时间）。
 *
 * 这段时间里气泡和按钮都还在，玩家可能又点一次。不挡的话，第二次点击会
 * 再推进一步——表现就是「抖一下就跳过去两步」。
 */
let advancing = false;

/**
 * 等对话框的退场动画放完，再执行 `done`；没有对话框在退场就立刻执行。
 *
 * ## 为什么需要
 *
 * 第 9 步（打分）在**世界详情对话框里**，第 10 步（排序）在榜单页。按
 * 「下一步」时准备动作会关掉详情，于是同一帧里发生了两件事：对话框消失、
 * 高亮移动。反馈里那句「详情突然消失，显得很突兀」就是这两件事叠在一起。
 *
 * ## 为什么用轮询而不是写死一个毫秒数
 *
 * 对话框的退场是 base-ui 的动画（`data-closed` + `animate-out`，当前
 * 100ms），元素会在动画期间保持挂载。写死「等 120ms」的话，以后有人调整
 * 那个时长，这里就悄悄失准了。改成**等它真的从 DOM 里消失**，自适应。
 *
 * 匹配 `[data-closed]` 而不是只看元素在不在：准备动作也可能**打开**一个
 * 对话框（例如第 7 步要打开详情），那种是 `data-open`，不该等。
 *
 * 上限 500ms 是保险：万一动画卡住或属性变了，不能让玩家点不动。
 */
function afterDialogsSettle(done: () => void): void {
    const closing = () =>
        document.querySelector('[data-slot="dialog-content"][data-closed]');

    if (!closing()) {
        done();
        return;
    }

    const deadline = Date.now() + 500;
    const tick = () => {
        if (!closing() || Date.now() > deadline) {
            done();
            return;
        }
        window.requestAnimationFrame(tick);
    };
    window.requestAnimationFrame(tick);
}

function clearAutoAdvance(): void {
    if (autoAdvanceTimer !== null) {
        window.clearTimeout(autoAdvanceTimer);
        autoAdvanceTimer = null;
    }
    advanceWhenObserver?.disconnect();
    advanceWhenObserver = null;
}

function stopAnchorWatch(): void {
    anchorObserver?.disconnect();
    anchorObserver = null;
    if (anchorQueued !== null) {
        window.cancelAnimationFrame(anchorQueued);
        anchorQueued = null;
    }
}

function removeAnchorFrame(): void {
    stopAnchorWatch();
    anchorFrame?.remove();
    anchorFrame = null;
    anchorSelectors = [];
    anchorReadOnly = [];
    clearHitMarks();
    clearReadOnlyMarks();
}

/**
 * 给被框覆盖的真实控件打标记，让它们保持可点击。
 *
 * driver 的规则是「只有 `.driver-active-element` 及其子元素可以点」。用合成框
 * 当锚点时，真实按钮在框**外面**，于是被 `.driver-active *` 全禁掉了——玩家
 * 点「开始连接」不会有任何反应。这个标记就是那条放行规则的补丁。
 *
 * 每次重新同步都清掉旧的：玩家点出新面板后，目标集合会变。
 */
function markHits(targets: readonly Element[]): void {
    clearHitMarks();
    for (const element of targets) {
        element.setAttribute('data-tour-hit', '');
    }
}

function clearHitMarks(): void {
    for (const element of document.querySelectorAll('[data-tour-hit]')) {
        element.removeAttribute('data-tour-hit');
    }
}

/**
 * 给「只亮不点」的目标打标记。
 *
 * driver 会把锚点**整块**放行（`.driver-active-element *` 是 `auto`），所以
 * 把榜单并进高亮范围之后，玩家点任意一行都会跳去详情——而「换个排法」这一步
 * 讲的不是怎么打开详情。`data-tour-readonly` 让那棵子树整体关掉指针事件，
 * 排序按钮仍在框外/框内可点。
 *
 * 每次重新同步都清掉旧的：目标集合会随步骤变化。
 */
function markReadOnly(targets: readonly Element[]): void {
    clearReadOnlyMarks();
    for (const element of targets) {
        element.setAttribute('data-tour-readonly', '');
    }
}

function clearReadOnlyMarks(): void {
    for (const element of document.querySelectorAll('[data-tour-readonly]')) {
        element.removeAttribute('data-tour-readonly');
    }
}

/** 当前选择器命中的元素（第一个必需，缺了就算没就位）。 */
function currentAnchorTargets(): Element[] | null {
    const [required, ...optional] = anchorSelectors;
    if (!required) return null;
    const anchor = document.querySelector(required);
    if (!anchor) return null;
    const extras = optional
        .map((selector) => document.querySelector(selector))
        .filter((element): element is Element => !!element);
    return [anchor, ...extras];
}

/**
 * 把空框移动/缩放到正好包住当前所有目标。
 *
 * 返回是否发生了变化——没变就不必让 driver 重新测量，省掉一次重排。
 */
/** 当前步骤里「只亮不点」的目标下标（对应 `element` 的项）。 */
let anchorReadOnly: readonly number[] = [];

function syncAnchorFrame(frame: HTMLElement): boolean {
    const targets = currentAnchorTargets();
    if (!targets || targets.length === 0) return false;

    // 目标集合每次同步都可能变（玩家点出了新面板），标记要跟着走。
    markHits(targets);

    // 只读的那些目标：从可点集合里摘出来，单独标成只读。
    // 两件事都要做——`markHits` 已经把整批设成可点了，`data-tour-readonly`
    // 的 `!important` 才压得回它。
    markReadOnly(
        anchorReadOnly
            .map((index) => targets[index])
            .filter((element): element is Element => !!element)
    );

    const rects = targets.map((element) => element.getBoundingClientRect());
    const top = Math.min(...rects.map((rect) => rect.top));
    const left = Math.min(...rects.map((rect) => rect.left));
    const bottom = Math.max(...rects.map((rect) => rect.bottom));
    const right = Math.max(...rects.map((rect) => rect.right));

    const width = `${right - left}px`;
    const height = `${bottom - top}px`;
    const nextTop = `${top}px`;
    const nextLeft = `${left}px`;
    const changed =
        frame.style.width !== width ||
        frame.style.height !== height ||
        frame.style.top !== nextTop ||
        frame.style.left !== nextLeft;
    if (!changed) return false;

    frame.style.top = nextTop;
    frame.style.left = nextLeft;
    frame.style.width = width;
    frame.style.height = height;
    return true;
}

/**
 * 让空框跟随目标**变化**。
 *
 * 有些块是玩家点出来的：授权码面板要在点了「开始连接」之后才出现，而 driver
 * 只在**进入步骤的那一刻**解析一次锚点——那时面板还不存在。只算一次的话，
 * 玩家点出授权码后，下面那块仍被暗层盖着，等于讲了一半（「点它会出码」讲了，
 * 「码在这里、已自动复制、这里打开浏览器」没讲）。
 *
 * 用 MutationObserver 而不是每帧轮询：只有 DOM 真的变了才可能变，而我们关心
 * 的正是「授权码面板出现了 / 消失了」这种变化。回调里再按 rAF 合并一次，
 * 因为一次渲染可能连着来好几条 mutation。
 */
function watchAnchorFrame(frame: HTMLElement): void {
    stopAnchorWatch();
    const sync = () => {
        anchorQueued = null;
        // 玩家可能已经退出导览、或界面把框连带移除。
        if (!instance?.isActive() || !frame.isConnected) return;
        if (syncAnchorFrame(frame)) {
            // 只有几何真的变了才让 driver 重画，避免无谓的重排。
            instance.refresh();
        }
        // 顺便看一眼文案前提有没有变（例如玩家点了「开始连接」，
        // 「已连接」的判定随之成立）。
        syncActiveCopy();
    };
    const observer = new MutationObserver(() => {
        if (anchorQueued !== null) return;
        anchorQueued = window.requestAnimationFrame(sync);
    });
    observer.observe(document.body, {
        childList: true,
        subtree: true,
        // 面板可能是靠 class 显隐，不看属性会漏。
        attributes: true
    });
    anchorObserver = observer;
}

/**
 * 给多元素步骤造（或复用）那个空框。
 *
 * **复用同一个元素**很关键：driver 把锚点记在 `activeElement` 上，换一个新
 * 元素它就不认了，高亮会消失。所以这里只改已有框的几何，绝不重建。
 */
function anchorFrameFor(newSelectors: readonly string[]): HTMLElement {
    const sameShape =
        anchorSelectors.length === newSelectors.length &&
        anchorSelectors.every((value, index) => value === newSelectors[index]);

    if (!anchorFrame || !anchorFrame.isConnected || !sameShape) {
        anchorFrame?.remove();
        const frame = document.createElement('div');
        frame.setAttribute('data-tour-frame', '');
        document.body.appendChild(frame);
        anchorFrame = frame;
        anchorSelectors = [...newSelectors];
        syncAnchorFrame(frame);
    } else {
        syncAnchorFrame(anchorFrame);
    }

    watchAnchorFrame(anchorFrame);
    return anchorFrame;
}

/**
 * 把一个 `TourStep` 变成 driver 的 `DriveStep`。
 *
 * ## `prepare` 为什么不能放在 element 求值里
 *
 * 早先我把 `prepare` 写在 element 的求值函数里，理由是「求值比进入晚不了多少」。
 * 结果它被**提前执行**了，表现是：还没走到打开详情那一步，详情就自己弹出来了。
 *
 * 原因在 driver 的这个逻辑：
 * ```js
 * function L(e,t){ return !t.skipMissingElement || !t.element ? false : !f(t.element) }
 * function R(e,t,n){ for (let i=t; ...; i+=n) if (!L(e,r[i])) return i }   // 找下一个可用步骤
 * ```
 * `R()` 每渲染一次气泡都会**扫描后续步骤**、对每一步调 `f(t.element)` 判断它
 * 会不会被跳过。也就是说 element 的求值函数会被**为了别的问题**反复调用，
 * 根本不代表「玩家进到这一步了」。
 *
 * `onHighlightStarted` 才是真正进入这一步时调一次（且只在此时）。所以准备动作
 * 挂在那里，element 求值保持**纯粹**——只回答「元素在哪」。
 */
function toDriveStep(
    step: TourStep,
    t: (key: string) => string,
    next?: TourStep,
    previous?: TourStep
): DriveStep {
    const selectors =
        step.element === undefined
            ? []
            : typeof step.element === 'string'
              ? [step.element]
              : [...step.element];

    return {
        ...(selectors.length > 0
            ? {
                  element: () => {
                      // 只回答「元素在哪」，**不做任何副作用**。
                      const required = selectors[0];
                      const anchor = document.querySelector(required);
                      if (!anchor) return null as never;

                      // 只有一个目标时直接交回真元素：不必造框，也就少一个
                      // 节点、少一套跟随逻辑。
                      // 但要先把上一步遗留的框和可点标记清掉——否则那个空框会
                      // 一直挂在页面上，被标记过的元素也会一直保持「可点」。
                      if (selectors.length === 1) {
                          removeAnchorFrame();
                          // 单目标步骤没有「只读列表」可言，清掉上一步的标记。
                          anchorReadOnly = [];
                          clearReadOnlyMarks();
                          return anchor as never;
                      }

                      // 多个目标：用可复用的空框，玩家点出新面板后它会长大。
                      anchorReadOnly = step.readOnly ?? [];
                      return anchorFrameFor(selectors) as never;
                  },
                  // 兜底：元素真的不出现时等多久放弃。
                  //
                  // **不要给「可跳过」的步骤更短的等待。** 早先这里是
                  // `skipIfMissing ? 1200 : 2500`，理由是「它不存在就是不适用，
                  // 没必要让玩家干等」。但实测这个判断是错的：切页之后组件要
                  // 重新挂载、列表还要抓数据，1.2 秒经常不够——于是那一步被
                  // 判成「不存在」而跳过，而 driver 的跳过是**递归**的
                  // （`r[e+dir] ? v(e+dir) : ...`，见 vendor 里的 `v()`），
                  // 下一步也可能超时、也被跳过……一路连跳好几步，玩家看到的是
                  // 「卡一下，然后直接到结尾」。
                  //
                  // 统一给 2500ms：等不到再跳过。多等一两秒远好过连跳六步。
                  waitForElement: step.waitForElement ?? 2500,
                  skipMissingElement: step.skipIfMissing ?? false
              }
            : {}),
        advanceOnClick: step.advanceOnClick ?? false,
        // 关掉高亮区可点性：driver 会给锚点加 `driver-no-interaction`，
        // 对应 CSS 是 `pointer-events: none !important`。
        disableActiveInteraction: step.blockInteraction ?? false,
        /**
         * 高亮**已经画好**之后调一次。
         *
         * 用它在此时机启动「位移跟随」：driver 刚量过位置、画完高亮洞，从这一刻
         * 起盯着元素别跑偏。不能放在 `onHighlightStarted`——那时位置还没量。
         */
        onHighlighted: () => {
            // driver 把当前锚点记在 `activeElement` 上；集中高亮时那是合成框，
            // 跟着它也合理（它就是目标的包围盒）。
            const anchor = instance?.getActiveElement();
            if (!anchor) return;
            followAnchor(anchor, () => instance?.refresh());
        },
        /**
         * 真正**进入**这一步时调一次，只保当前这一步的界面。
         *
         * `prepare` 在这里跑，不是因为它「只能在这跑」，而是因为此刻气泡已经
         * 挂上去、玩家看的确实是这一步。下一步的界面**不在这里准备**——早先
         * 在这里调下一步的 `prepareNext`，等于「第 N 步刚开始就把界面切到第
         * N+1 步该去的地方」，第 N 步的气泡还指着旧锚点。实测故障：第 3 步
         * 「先连接一次」的气泡停着，界面已经跳到地图榜，高亮框落在地图列表上。
         */
        onHighlightStarted: () => {
            step.prepare?.();
            // 进入新的一步，先把上一步的位移跟随停掉。
            stopAnchorFollow();

            // 每进入新的一步，重置「已推进」标记——去重是按步算的。
            clearAutoAdvance();
            advancedForStep = null;
            // 进入新步骤说明上一次推进已经完成，这里兜底清掉防重入标记。
            // 万一某次推进因为异常没有走到 `advancing = false`，不在这里
            // 复位的话，后续所有按钮都会失灵。
            advancing = false;

            /**
             * 统一的推进：两条路（玩家自己点 / 按「下一步」/ 定时）都走这里，
             * 靠 `advancedForStep` 保证同一步只推一次。
             */
            const advanceOnce = () => {
                const index = instance?.getActiveIndex();
                if (index === undefined) return;
                if (advancedForStep === index) return;
                advancedForStep = index;
                // **必须走和「下一步」一样的路**：先准备下一步的界面，再前进。
                // 直接 `moveNext()` 会跳过 `prepareNext`，于是下一步永远等不到
                // 锚点、被当成不存在跳过——「第 7 步过去直接跳到第 10 步」就是
                // 这么来的。
                next?.prepareNext?.();
                instance?.moveNext();
            };

            // 纯预告的步骤：停一会儿自动前进。
            if (step.autoAdvanceMs && step.autoAdvanceMs > 0) {
                autoAdvanceTimer = window.setTimeout(() => {
                    autoAdvanceTimer = null;
                    if (!instance?.isActive()) return;
                    advanceOnce();
                }, step.autoAdvanceMs);
            }

            // 玩家自己动手也算数：目标元素一出现就前进。
            // 和上面的定时器、和「下一步」按钮**双管齐下**，谁先到算谁。
            if (step.advanceWhen) {
                const selector = step.advanceWhen;
                // 已经在了就直接走（玩家在上一步就点开了）。
                if (document.querySelector(selector)) {
                    advanceOnce();
                } else {
                    const observer = new MutationObserver(() => {
                        if (!instance?.isActive()) return;
                        if (!document.querySelector(selector)) return;
                        observer.disconnect();
                        advanceWhenObserver = null;
                        advanceOnce();
                    });
                    observer.observe(document.body, {
                        childList: true,
                        subtree: true
                    });
                    advanceWhenObserver = observer;
                }
            }
        },
        // 文案每次进入这一步都重算一次，所以「已连接 / 未连接」这种随玩家
        // 操作变化的前提能跟上。玩家在**这一步之内**改变状态（点了「开始
        // 连接」）的情况另外处理：见 `syncActiveCopy`。
        popover: {
            // driver 用 `innerHTML` 写入，所以这里给 HTML 字符串。
            // `renderTourMarkdown` 是**同步**的（`renderToStaticMarkup`）——
            // 这条链路必须同步：driver 写完 `innerHTML` 立刻定位气泡，
            // 异步渲染会赶不上，气泡里就会露出 `**` 这样的原始标记。
            title: renderTourMarkdown(t(titleKeyFor(step))),
            description: renderTourMarkdown(t(descriptionKeyFor(step))),
            side: step.side ?? 'bottom',
            align: step.align ?? 'center',
            /**
             * **玩家点「下一步」的那一刻**准备下一步的界面。
             *
             * 这是 `prepareNext` 唯一该跑的时候：
             * - 比 driver 解析下一步的锚点更早（点击 → 切页 → driver 查找），
             *   所以元素一次命中，不必等 `waitForElement` 超时；
             * - 又不会在**当前**这一步还没讲完时就把界面切走。
             *
             * 早先把它挂在 `onHighlightStarted` 上，等于「第 N 步刚开始就去
             * 准备第 N+1 步的界面」——第 N 步的气泡还指着旧锚点，界面已经跑了。
             *
             * ⚠️ **必须自己推进**：driver 里 `popover.onNextClick ?? 默认推进`
             * 是二选一（`m || n.onNextClick`），我提供了这个回调，它就**不会**
             * 再执行内置的 `moveNext`。只做准备不推进的话，按钮点了没反应。
             */
            onNextClick: () => {
                // 玩家自己点了：取消可能存在的自动前进，否则会连推两步。
                clearAutoAdvance();
                // **防重入**：推进可能因为「等对话框退场」而延后几十毫秒，
                // 那段时间按钮还在，触摸板一抖就会再点一次、直接跳两步。
                if (advancing) return;
                advancing = true;
                // 标记「本步已推进」，让还在路上的观察者/定时器不要重复推。
                const index = instance?.getActiveIndex();
                if (index !== undefined) advancedForStep = index;
                next?.prepareNext?.();
                // 准备动作可能关掉了一个对话框（第 9 步就在详情里，下一步要
                // 回榜单）。等它退场动画放完再推进，否则「对话框消失」和
                // 「高亮移动」挤在同一帧，看起来像整屏炸了一下——反馈说的
                // 「详情突然消失，显得很突兀」就是这个。
                //
                // 没有对话框要退场时**立即推进**，不给正常步骤加延迟。
                afterDialogsSettle(() => {
                    advancing = false;
                    instance?.moveNext();
                });
            },
            /**
             * 「上一步」同样要先准备目标步骤的界面，再回退。
             *
             * 不处理的话，从详情两步往后退时：详情还开着，而排序/榜单的锚点
             * 在页面上被它盖着——玩家按「上一步」，回是回去了，却看到一片遮罩。
             *
             * 用 `previous` 的 `prepareNext`（那份动作是幂等的、会关对话框并
             * 切页），再 `movePrevious()`。同样必须自己推进，理由同上。
             */
            onPrevClick: () => {
                clearAutoAdvance();
                // 同「下一步」：等待期间按钮还在，挡掉重复触发。
                if (advancing) return;
                advancing = true;
                previous?.prepareNext?.();
                // 回退同样可能要关掉对话框（从详情回到榜单页），等它退场完
                // 再移动高亮，理由和 `onNextClick` 一样。
                afterDialogsSettle(() => {
                    advancing = false;
                    instance?.movePrevious();
                });
            }
        }
    };
}

/**
 * 状态变了之后，把当前这一步的文案也更新掉。
 *
 * 场景：玩家在「连接」这一步里点了「开始连接」，授权码面板出现。这时文案
 * 不该还是「点它会出码」——码已经出来了。用 `setConfig` 重建会重放整步、
 * 把玩家的位置和遮罩都抖一遍，所以这里只改 DOM 里那两个节点。
 *
 * 只在当前步骤的文案键**真的变了**时才动 DOM，避免每秒都写一次。
 */
function syncActiveCopy(): void {
    if (!instance?.isActive()) return;
    const index = instance.getActiveIndex();
    if (index === undefined) return;
    const step = activeSteps[index];
    if (!step?.variant) return;

    const t = i18n.t.bind(i18n);
    const popover = instance.getState('popover');
    if (!popover) return;

    const titleKey = titleKeyFor(step);
    const descriptionKey = descriptionKeyFor(step);
    if (popover.wrapper.dataset.tourCopy === titleKey) return;
    popover.wrapper.dataset.tourCopy = titleKey;

    // 重新渲染成 HTML。走和初始渲染同一个函数，避免两套逻辑迟早不一致。
    popover.wrapper.querySelector('.driver-popover-title')!.innerHTML =
        renderTourMarkdown(t(titleKey));
    popover.wrapper.querySelector('.driver-popover-description')!.innerHTML =
        renderTourMarkdown(t(descriptionKey));
}

/**
 * 按当前状态选这一组文案。
 *
 * `variant.when` 在构建配置时求一次（每次进入步骤都会重算），所以「已连接」
 * 这种随玩家操作变化的前提能跟上。
 */
function titleKeyFor(step: TourStep): string {
    return step.variant?.when() ? step.variant.titleKey : step.titleKey;
}

function descriptionKeyFor(step: TourStep): string {
    return step.variant?.when()
        ? step.variant.descriptionKey
        : step.descriptionKey;
}

function buildConfig(steps: readonly TourStep[]): Config {
    const t = i18n.t.bind(i18n);
    const driveSteps: DriveStep[] = steps.map((step, index) =>
        toDriveStep(step, t, steps[index + 1], steps[index - 1])
    );

    return {
        steps: driveSteps,
        /**
         * **关掉平滑滚动。**
         *
         * driver 的顺序是「先滚动、紧接着就画高亮与气泡」：
         * ```js
         * g(el, config.smoothScroll)      // 滚动
         * !_ && step.popover && W(...)    // 立刻画
         * ```
         * 而平滑滚动是**异步动画**。开着它，画高亮的那一刻元素还在半路上，
         * 框就落在错误的位置，要等动画结束、跟随机制重新测量后才归位——
         * 表现就是「背景滑到底了，高亮卡一下才出现」。
         *
         * 关掉它之后滚动是瞬时的，画高亮时元素已经就位，一次就对。
         * 代价是少了滚动动画；对导览来说「指哪亮哪」比「滑得好看」重要得多。
         */
        smoothScroll: false,
        // 高亮洞周围留一点空隙，别把按钮贴边的描边切掉。
        stagePadding: 6,
        stageRadius: 8,
        // 气泡与高亮框的**实际间距 = stagePadding + popoverOffset**。
        //
        // 默认 10 时只有 16px，而气泡本身带阴影和 3px 主色描边：看起来就像
        // 贴在高亮框上、甚至压住它。这里加到 28（合计 34px），气泡明确「悬在
        // 旁边」而不是「盖在上面」。
        //
        // 这一步不能省：driver 的避让只在**整边放不下**时才换边
        // （`h = 上方空间 >= 气泡高度 + offset`），放得下但很挤的时候它不会
        // 帮你多让——所以间距本身必须够。
        popoverOffset: 28,
        showProgress: true,
        progressText: '{{current}} / {{total}}',
        nextBtnText: t('vrcc.tour.next'),
        prevBtnText: t('vrcc.tour.prev'),
        doneBtnText: t('vrcc.tour.done'),
        // **点遮罩什么都不做**。
        //
        // 必须写成函数，不能是字符串 `'none'`：
        //   if (allowClose && behavior === 'close') destroy('overlay')
        //   else if (typeof behavior === 'function') { 只调回调、不销毁 }
        //   else if (behavior === 'nextStep') { 前进 }
        // 早先这里写的是 `'close'`：玩家想点界面上某个东西却点在暗层上，
        // 导览直接消失——整屏都是暗层，这是最容易被误触掉的一种点法。
        overlayClickBehavior: () => {
            // 刻意留空：点暗层既不该退出，也不该前进。
        },
        // **不能关掉 allowClose**：Esc 也走这条开关
        // （`escapePress` → `r('escape')` → `allowClose && destroy`），
        // 关掉它等于把 Esc 一起废了，而那是唯一的逃生口。
        allowClose: true,
        allowKeyboardControl: true,
        onDestroyed: () => {
            // 多元素高亮用的临时空框必须收掉，否则它会一直贴在页面上。
            removeAnchorFrame();
            clearAutoAdvance();
            // 位移跟随也要停，否则导览结束后还在后台测几何、调 refresh。
            stopAnchorFollow();
            // 导览期间的演示数据到此为止——真实界面不能留着编出来的红点。
            useVrccTourDemoStore.getState().setActive(false);
            // 导览结束：`pop` 公告从这一步起可以正常弹了（被挂起的那条不会丢，
            // 已读状态也没被碰过）。
            useVrccTourActiveStore.getState().setActive(false);
            const finish = onFinished;
            onFinished = null;
            activeSteps = [];
            finish?.();
        }
    };
}

/** 导览是否正在跑。 */
export function isTourActive(): boolean {
    return instance?.isActive() === true;
}

/**
 * 开始一轮导览。
 *
 * `onDone` 在这个导览**以任何方式结束**时调用一次（走完、按 Esc、点关闭）：
 * 调用方用它记「看过了」，以及关掉导览期间临时打开的对话框。
 */
export function startTour(
    steps: readonly TourStep[],
    onDone?: () => void
): void {
    if (steps.length === 0) return;

    // 上一轮还在跑就先收掉，避免两层遮罩叠着。
    if (instance?.isActive()) {
        instance.destroy();
    }

    activeSteps = [...steps];
    onFinished = onDone ?? null;

    // 导览期间开启演示数据：首次引导的对象是「从没连过」的玩家，他们没有
    // 任何真实红点，而「四处红点」那一步要讲的就是那四个数字。
    useVrccTourDemoStore.getState().setActive(true);

    // 告诉页面「导览开始了」。优先级链是一条队列：
    //   force 公告 → 挂起导览（见 shouldAutoOpenFirstRun）
    //   导览       → 挂起 pop 公告（见 VrccPage）
    // 同一时刻只该有一样东西在对玩家说话。
    useVrccTourActiveStore.getState().setActive(true);

    // 第一步没有人替它「提前准备」——`prepareNext` 是靠**前一步**进入时触发的。
    // 所以这里把首步自己的 `prepareNext` 放出去，否则第一屏若是「切到某页再
    // 高亮」，页面永远等不到。
    //
    // 注意只调 `prepareNext`，不调 `prepare`：后者由 `onHighlightStarted` 负责，
    // 两处都调等于首步动作跑两遍。
    steps[0]?.prepareNext?.();

    if (instance) {
        instance.setConfig(buildConfig(activeSteps));
    } else {
        instance = driver(buildConfig(activeSteps));
    }
    instance.drive();
}

/** 中止当前导览（会走 `onDestroyed`，但不会额外做别的事）。 */
export function stopTour(): void {
    if (instance?.isActive()) {
        instance.destroy();
    }
}

/**
 * 语言变了之后重放文本。
 *
 * 文本是构建配置时求值的，不重建就会停在旧语言上。正在跑的时候按当前步号
 * 原地重放，进度不丢。
 */
export function retranslateTour(): void {
    if (!instance) return;
    const index = instance.getActiveIndex() ?? 0;
    const wasActive = instance.isActive();
    instance.setConfig(buildConfig(activeSteps));
    if (wasActive) {
        instance.drive(index);
    }
}

/** 只在测试里用：丢掉单例，避免测试之间互相污染。 */
export function resetTourForTests(): void {
    removeAnchorFrame();
    instance = null;
    activeSteps = [];
    onFinished = null;
}
