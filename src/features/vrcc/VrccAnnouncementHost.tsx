import { useEffect, useState } from 'react';

import { useRuntimeStore } from '@/state/runtimeStore';

import { VrccAnnouncementDialog } from './components/VrccAnnouncementDialog';
import {
    markSeenIds,
    readSeenIds,
    selectPendingAnnouncements
} from './vrccAnnouncementStore';
import type { VrccAnnouncement } from './vrccApi';
import { vrccApi } from './vrccApi';

/**
 * 全局的 `force` 公告宿主。
 *
 * 只在 VRChat 登录成功之后拉一次：没登录 VRChat 的玩家，站点公告对他基本没有
 * 意义（`force` 讲的是停站、条款变更这类跟账号相关的事）。
 *
 * `GET /announcements` 本身不需要令牌也不需要 `X-Client`（官方 `security` 里
 * 只有 client），所以这里不经过 `useVrccController`——那个只在星遇同频页面
 * 挂载时才有实例，而 `force` 必须能在这个页面之外也弹出来。
 *
 * 只处理 `force`：`pop` 属于信息性公告，归星遇同频页面内，弹到全局就是打扰。
 * 两套序列互相独立。
 */
export function VrccAnnouncementHost() {
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const [posts, setPosts] = useState<readonly VrccAnnouncement[]>([]);
    // 每次登录只拉一次：公告变化频率是「两周一条」，不值得轮询。
    const [loadedFor, setLoadedFor] = useState<string | null>(null);

    useEffect(() => {
        if (!currentUserId) {
            // 退登后清掉未完成的弹窗，避免换账号时把上一个账号的公告顶出来。
            setPosts([]);
            setLoadedFor(null);
            return;
        }
        if (loadedFor === currentUserId) return;

        let cancelled = false;
        void (async () => {
            try {
                const announcements = await vrccApi.announcements();
                if (cancelled) return;
                setLoadedFor(currentUserId);
                setPosts(
                    selectPendingAnnouncements(announcements?.posts, {
                        barCursor: null,
                        seenIds: readSeenIds(),
                        scope: 'global'
                    })
                );
            } catch (error) {
                // 拉不到就算了：公告是附加信息，不该在启动阶段报错。
                console.error(
                    '[vrcc] global announcement fetch failed:',
                    error
                );
                if (!cancelled) setLoadedFor(currentUserId);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [currentUserId, loadedFor]);

    const advance = (id: number) => {
        markSeenIds([id]);
        // 从序列里摘掉这条，弹窗自己会夹住索引并前进到下一条。
        setPosts((prev) => prev.filter((post) => (post.id ?? 0) !== id));
    };

    const skipAll = (ids: readonly number[]) => {
        markSeenIds(ids);
        setPosts([]);
    };

    return (
        <VrccAnnouncementDialog
            posts={posts}
            onAdvance={advance}
            onSkipAll={skipAll}
        />
    );
}
