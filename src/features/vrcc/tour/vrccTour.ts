import { driver, type Config, type Driver, type DriveStep } from 'driver.js';

import i18n from '@/services/i18nService';

/**
 * 星遇同频的导览引擎。
 *
 * 用 driver.js 做「压暗整个界面、在真实控件上挖一个洞高亮它」——玩家看到的是
 * 自己的界面，不是一张截图或一段说明。每步只讲一个动作。
 *
 * ## 为什么是一个单例
 *
 * driver.js 的高亮层挂在 `body` 上，同一时刻只能有一份。做成单例还顺带解决了
 * 语言切换：文本是构建时求值的，切语言后要 `setConfig` 重放。
 *
 * ## 跨页怎么办
 *
 * 页签和对话框切换后，目标元素要等 React 渲染完才在 DOM 里。所以步骤里给的是
 * `before` 回调（先切页/开对话框），真正 `drive()` 由调用方在渲染之后调，
 * 中途换页用 `onNextClick` + `setTimeout(..., 0)` 把控制权交回事件循环。
 */

/** 一步导览。 */
export type TourStep = {
    /** 等这个 CSS 选择器出现再高亮；省略表示不依赖 DOM（居中气泡）。 */
    element?: string;
    /** 高亮前先做的事：切页签、开对话框这类。 */
    before?: () => void;
    /** 标题与正文的本地化键。 */
    titleKey: string;
    descriptionKey: string;
    side?: 'top' | 'right' | 'bottom' | 'left';
    align?: 'start' | 'center' | 'end';
    /** 只有这一条讲解、没有别的可点时才允许点遮罩跳过。 */
    advanceOnClick?: boolean;
    /**
     * 元素不存在时直接跳过这一步，而不是停下来。
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

function buildConfig(steps: readonly TourStep[]): Config {
    const t = i18n.t.bind(i18n);
    const driveSteps: DriveStep[] = steps.map((step) => ({
        // driver.js 允许元素暂时不在：`waitForElement` 会轮询等它。
        // 有条件出现的功能标了 `skipIfMissing`，等不到就跳过这一步；
        // 核心步骤等不到就停下——那是真出问题，静默跳过会让「5/17」这种
        // 进度忽然错位，玩家以为是自己的问题。
        ...(step.element
            ? {
                  element: step.element,
                  waitForElement: step.skipIfMissing ? 1500 : 3000,
                  skipMissingElement: step.skipIfMissing ?? false
              }
            : { element: undefined }),
        advanceOnClick: step.advanceOnClick ?? false,
        popover: {
            title: t(step.titleKey),
            description: t(step.descriptionKey),
            side: step.side ?? 'bottom',
            align: step.align ?? 'center'
        }
    }));

    return {
        steps: driveSteps,
        // 0.85 而不是 0.9：VRCX-0 的界面比 Clash Party 密，压太黑会看不见
        // 高亮洞周围的上下文，玩家反而不知道自己在哪。
        overlayOpacity: 0.85,
        smoothScroll: true,
        // 高亮洞周围留一点空隙，别把按钮贴边的描边切掉。
        stagePadding: 6,
        stageRadius: 8,
        showProgress: true,
        progressText: '{{current}} / {{total}}',
        nextBtnText: t('vrcc.tour.next'),
        prevBtnText: t('vrcc.tour.prev'),
        doneBtnText: t('vrcc.tour.done'),
        // 不允许点遮罩前进：那会让「正在看第 3 步」的人莫名其妙跳到下一步。
        overlayClickBehavior: 'close',
        allowKeyboardControl: true,
        onDestroyed: () => {
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
 * 调用方用它记「看过了」，以及关掉导览过程中临时打开的对话框。
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

    if (instance) {
        instance.setConfig(buildConfig(activeSteps));
    } else {
        instance = driver(buildConfig(activeSteps));
    }

    // 第一步如果要先切页/开对话框，先把动作放出去，再让 driver 等元素。
    // `waitForElement` 会轮询，所以这里不必自己 setTimeout。
    activeSteps[0]?.before?.();
    instance.drive();
}

/** 中止当前导览（不回调 `onDone` 之外的任何东西，但会走 `onDestroyed`）。 */
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
    instance = null;
    activeSteps = [];
    onFinished = null;
}
