import { tauriClient } from '@/platform/tauri/client';
import { openVrccTab } from '@/shared/utils/vrccNavigation';
import { useVrcNotificationStore } from '@/state/vrcNotificationStore';

/**
 * 后端把提醒写进通知中心后发出的信号。
 *
 * 与 Rust 侧 `runtime-host-desktop::vrcc::VRCC_NOTICES_CHANGED_EVENT` 必须一致。
 * 事件本身不带正文（玩家内容不经手事件层），这里只当作「该重新读一次」。
 */
const VRCC_NOTICES_CHANGED_EVENT = 'vrccNoticesChanged';

/**
 * 跳到星遇同频的「提醒」页。
 *
 * 页签通过查询参数传递，而不是另开一个事件：跳转本来就会带上 search，
 * 页面自己读它即可，少一条跨模块的事件契约。
 *
 * 先收起通知中心抽屉：它是浮层，不随路由关闭，不收起来的话跳过去的页面
 * 会被它盖住——和「查看全部」跳表格页是同样的处理。
 */
export function openVrccNotificationCenter(): void {
    useVrcNotificationStore.getState().setCenterOpen(false);
    openVrccTab('notifications');
}

/**
 * 让通知中心跟着站外提醒一起走。
 *
 * 后端把提醒直接写进库里，通知中心却是另一条查询（`vrcNotificationStore`），
 * 两者之间没有连线：不补这一条，红点和条目都要等到别的刷新时机才出现。
 *
 * 只重读本地库，不顺便同步 VRChat 的提醒——这里变化的是我们自己的行，
 * 没必要为此多花一次远端请求。
 */
export async function bindVrccNotificationCenterEvents(): Promise<() => void> {
    return tauriClient.events.subscribe(VRCC_NOTICES_CHANGED_EVENT, () => {
        useVrcNotificationStore
            .getState()
            .loadForCurrentUser()
            .catch((error: unknown) => {
                console.warn(
                    '[vrcc] notification centre reload failed:',
                    error
                );
            });
    });
}
