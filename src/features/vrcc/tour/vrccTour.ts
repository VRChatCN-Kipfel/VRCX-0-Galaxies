import { driver, type Config, type Driver, type DriveStep } from 'driver.js';

import i18n from '@/services/i18nService';

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
     */
    prepare?: () => void;
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
    clearHitMarks();
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
function syncAnchorFrame(frame: HTMLElement): boolean {
    const targets = currentAnchorTargets();
    if (!targets || targets.length === 0) return false;

    // 目标集合每次同步都可能变（玩家点出了新面板），标记要跟着走。
    markHits(targets);

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
 * 锚点用**函数**形式而不是字符串，为的是把 `prepare` 塞进求值那一刻——
 * 见文件头「跨页」一节的第 1 点。
 */
function toDriveStep(step: TourStep, t: (key: string) => string): DriveStep {
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
                      // 先备好界面，再回答「元素在哪」。
                      // driver 拿到结果后若仍是 null 会进入等待，
                      // 而 React 在这之间已经渲染完了。
                      step.prepare?.();

                      const required = selectors[0];
                      const anchor = document.querySelector(required);
                      if (!anchor) return null as never;

                      // 只有一个目标时直接交回真元素：不必造框，也就少一个
                      // 节点、少一套跟随逻辑。
                      // 但要先把上一步遗留的框和可点标记清掉——否则那个空框会
                      // 一直挂在页面上，被标记过的元素也会一直保持「可点」。
                      if (selectors.length === 1) {
                          removeAnchorFrame();
                          return anchor as never;
                      }

                      // 多个目标：用可复用的空框，玩家点出新面板后它会长大。
                      return anchorFrameFor(selectors) as never;
                  },
                  // 兜底：元素真的不出现时等多久放弃。
                  // 有条件出现的步骤短一些——它不存在就是不适用，没必要让
                  // 玩家对着暗屏干等；核心步骤给足时间，因为那通常是慢一点
                  // 的渲染而不是缺失。
                  waitForElement: step.skipIfMissing ? 1200 : 2500,
                  skipMissingElement: step.skipIfMissing ?? false
              }
            : {}),
        advanceOnClick: step.advanceOnClick ?? false,
        // 文案每次进入这一步都重算一次，所以「已连接 / 未连接」这种随玩家
        // 操作变化的前提能跟上。玩家在**这一步之内**改变状态（点了「开始
        // 连接」）的情况另外处理：见 `syncActiveCopy`。
        popover: {
            title: t(titleKeyFor(step)),
            description: t(descriptionKeyFor(step)),
            side: step.side ?? 'bottom',
            align: step.align ?? 'center'
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

    popover.wrapper.querySelector('.driver-popover-title')!.textContent =
        t(titleKey);
    popover.wrapper.querySelector('.driver-popover-description')!.textContent =
        t(descriptionKey);
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
    const driveSteps: DriveStep[] = steps.map((step) => toDriveStep(step, t));

    return {
        steps: driveSteps,
        // 0.85 而不是 0.9：VRCX-0 的界面比 Clash Party 密，压太黑会看不见
        // 高亮洞周围的上下文，玩家反而不知道自己在哪。
        overlayOpacity: 0.85,
        smoothScroll: true,
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

    // **不要在这里调 `steps[0].prepare`**：它会由锚点求值函数触发，
    // 那是 driver 进入第一步时的必经之路。两处都调等于首步的动作跑两遍
    // ——「打开世界详情」那两步会连开两次对话框。

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
