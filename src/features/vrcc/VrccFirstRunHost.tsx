import { useEffect } from 'react';

import { openVrccTab } from '@/shared/utils/vrccNavigation';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useVrccFirstRunStore } from '@/state/vrccFirstRunStore';
import { useVrccForceAnnouncementStore } from '@/state/vrccForceAnnouncementStore';

import { VrccFirstRunCard } from './components/VrccFirstRunCard';
import { vrccApi } from './vrccApi';
import { shouldAutoOpenFirstRun } from './vrccFirstRun';

/**
 * 首连引导宿主。
 *
 * 只做两件事：把「这个账号连没连过 / 表过态没有」读回来，以及按优先级决定
 * 要不要自动弹。**它不负责连**——「现在连接」只把玩家送到「我的」页，
 * 设备授权那一步必须由玩家自己点（我们不能替他打开浏览器完成授权）。
 *
 * 判定条件集中在 [`shouldAutoOpenFirstRun`]，那里有每条理由的注释。
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

    const autoOpen = shouldAutoOpenFirstRun({
        credential,
        guidance,
        forceAnnouncementsLoaded: forceLoaded,
        forceAnnouncementsPending: forcePending
    });

    /**
     * 记下表态。
     *
     * 只在**还没表过态**时写：从「我的」页主动打开再关掉，不该把早先的
     * `seen` 降级成 `postponed`——那只表示「我知道这个功能」，和「现在不连」
     * 是两件事。
     *
     * 写失败只记日志：卡已经关了，下次最多再问一遍，比弹一半卡在屏幕上好。
     */
    const record = (state: 'seen' | 'postponed') => {
        if (useVrccFirstRunStore.getState().guidance !== 'unseen') return;
        useVrccFirstRunStore.getState().setGuidance(state);
        void vrccApi.setGuidance(state).catch((error: unknown) => {
            console.error('[vrcc] failed to record the guidance state:', error);
        });
    };

    return (
        <VrccFirstRunCard
            open={manualOpen || autoOpen}
            onStart={() => {
                // 「现在连接」= 知道有这回事了，同时把人送到连接卡片前。
                record('seen');
                useVrccFirstRunStore.getState().closeManual();
                openVrccTab('me');
            }}
            onDismiss={() => {
                // 「稍后」和关窗是一回事：现在不连。记 `postponed` 而不是
                // `seen`——他并没有看过连接流程，只是不想现在处理。
                record('postponed');
                useVrccFirstRunStore.getState().closeManual();
            }}
        />
    );
}
