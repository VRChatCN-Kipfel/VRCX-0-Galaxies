import { useEffect } from 'react';

import i18n from '@/services/i18nService';
import { openVrccTab } from '@/shared/utils/vrccNavigation';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useVrccFirstRunStore } from '@/state/vrccFirstRunStore';
import { useVrccForceAnnouncementStore } from '@/state/vrccForceAnnouncementStore';

import { retranslateTour, startTour, stopTour } from './tour/vrccTour';
import { buildVrccTour } from './tour/vrccTourSteps';
import { vrccApi } from './vrccApi';
import { shouldAutoOpenFirstRun } from './vrccFirstRun';

/**
 * 首连引导宿主。
 *
 * 干三件事：
 * 1. 按账号读回「连过没有」和「引导讲到哪一步」；
 * 2. 该讲的时候起一轮**操作导览**——压暗界面、在真实控件上挖洞高亮、跨页翻；
 * 3. 把玩家的表态落盘，让「稍后」真的延后。
 *
 * ## 为什么是导览而不是一张说明卡
 *
 * 这个集成的能力分散在四个页签、一个侧栏入口和世界详情对话框里。把六件事写进
 * 一张卡片，玩家读完仍然不知道去哪点；而压暗界面逐个高亮，玩家看到的是自己的
 * 界面，关掉导览就能照着做。
 *
 * ## 两种形态
 *
 * - 从没连过：完整导览（入口 → 连接 → 页签 → 所在地图 → 榜单 → 排序 → 详情 → 评分 → 提醒）
 * - 已连上但从没看过：只走「入口 → 连接」三步。后面讲的都是他已经看得见的
 *   东西，再走一遍只是拖时间。
 *
 * ## 不做什么
 *
 * 导览**不替玩家点任何按钮**。它只指出位置；连接、打分这些动作必须由玩家
 * 自己完成——打分在官方要求里就是「每次由玩家本人主动点击触发」，替点即违规。
 */
export function VrccFirstRunHost() {
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const manualOpen = useVrccFirstRunStore((state) => state.manualOpen);
    const forceLoaded = useVrccForceAnnouncementStore((state) => state.loaded);
    const forcePending = useVrccForceAnnouncementStore(
        (state) => state.pending
    );

    // 按账号读一次凭据状态与引导表态。切换账号要重读：两者都是按账号存的。
    useEffect(() => {
        if (!currentUserId) {
            useVrccFirstRunStore.getState().reset();
            return;
        }
        let cancelled = false;
        void (async () => {
            try {
                const [connection, guidance] = await Promise.all([
                    vrccApi.connection(),
                    vrccApi.guidance()
                ]);
                if (cancelled) return;
                // `credential` 缺失（后端是更早的版本）时保持 `null`，也就是
                // 「不知道」——不知道就不自动弹，不要猜成 `never` 去打扰人。
                useVrccFirstRunStore
                    .getState()
                    .setLoaded(connection.credential ?? null, guidance);
            } catch (error) {
                // 读不到就不弹：引导是附加信息，不该在启动阶段报错，
                // 也不该拿一个猜出来的状态去打扰玩家。
                console.error('[vrcc] first-run state unavailable:', error);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [currentUserId]);

    const credential = useVrccFirstRunStore((state) => state.credential);
    const guidance = useVrccFirstRunStore((state) => state.guidance);

    /** 记下表态。只在还没表过态时写，避免把 `seen` 降级成 `postponed`。 */
    const record = (state: 'seen' | 'postponed') => {
        if (useVrccFirstRunStore.getState().guidance !== 'unseen') return;
        useVrccFirstRunStore.getState().setGuidance(state);
        void vrccApi.setGuidance(state).catch((error: unknown) => {
            console.error('[vrcc] failed to record the guidance state:', error);
        });
    };

    const runTour = () => {
        const state = useVrccFirstRunStore.getState();
        startTour(buildVrccTour(), () => {
            // 走完或中途关掉都记 `seen`：玩家已经知道这件事存在了。
            record('seen');
            state.closeManual();
        });
    };

    const autoOpen = shouldAutoOpenFirstRun({
        credential,
        guidance,
        forceAnnouncementsLoaded: forceLoaded,
        forceAnnouncementsPending: forcePending
    });

    // 自动开：等两个前提都满足再起，避免在公告还没回来时抢弹。
    useEffect(() => {
        if (!autoOpen) return;
        // 稍等一下让页面先落好：首次进入时路由还在挂载中，锚点还没进 DOM。
        // driver 自己也会 `waitForElement`，但先让出一帧能少一次轮询。
        const timer = window.setTimeout(() => runTour(), 600);
        return () => window.clearTimeout(timer);
        // `runTour` 每次渲染都是新引用，故意只依赖 `autoOpen`：
        // 这条 effect 的意思是「刚刚满足条件了，起一轮」。
    }, [autoOpen]);

    // 手动入口：不管之前表过什么态都能重看。
    useEffect(() => {
        if (!manualOpen) return;
        // 先落到星遇同频页，否则第一步的锚点根本不在界面上。
        openVrccTab('maps');
        const timer = window.setTimeout(() => runTour(), 600);
        return () => window.clearTimeout(timer);
    }, [manualOpen]);

    // 语言切换：导览文本是构建时求值的，正在跑的话要跟着换。
    useEffect(() => {
        const onChange = () => retranslateTour();
        i18n.on('languageChanged', onChange);
        return () => i18n.off('languageChanged', onChange);
    }, []);

    // 卸载时收掉还没走完的导览，别把遮罩留在别人的页面上。
    useEffect(() => () => stopTour(), []);

    return null;
}
