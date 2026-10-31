import type {
    VrccRecentNotifications,
    VrccUnread
} from '@/features/vrcc/vrccApi';

/**
 * 星遇同频几处红点的合计。
 *
 * 服务器有 `me/unread`（1.13.0 起）时直接加总；旧服务器上没有这个接口，
 * 退回「最近的提醒」里 `id > read` 的条数（`read` 没有时都算未读）。
 *
 * 放在这里而不是页面上，是因为侧边栏那个条目也要显示同一个数字：两处各自
 * 算一遍迟早会算歪，而「侧边栏和页面标题显示不同数字」很难被发现。
 *
 * **`cross` 不算在这里**：它属于「星轨相交」那个页签自己的红点，挂在
 * 「提醒」页签上会让玩家点进去却找不到那几条东西。它走
 * [`countVrccCrossingsUnread`]，由那个页签单独显示。
 */
export function countVrccUnread(
    unread: VrccUnread | null,
    recent: VrccRecentNotifications | null
): number {
    if (unread) {
        return (unread.inbox ?? 0) + (unread.chats ?? 0) + (unread.notes ?? 0);
    }
    const read = recent?.read ?? 0;
    return (recent?.items ?? []).filter((item) => (item.id ?? 0) > read).length;
}

/**
 * 「星轨相交」页签自己的红点。
 *
 * 只在服务器给了 `me/unread` 时才有；旧服务器不区分这几处，回退成 0 而不是
 * 拿「最近的提醒」去凑——那些条目属于提醒，不属于这里。
 */
export function countVrccCrossingsUnread(unread: VrccUnread | null): number {
    return unread?.cross ?? 0;
}
