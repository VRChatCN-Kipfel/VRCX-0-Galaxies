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
 * **`cross` 算在这里**，和 Rust 的 `VrccUnread::total()` 保持同一个口径：
 * 这个数是「星遇同频有几件事没看」，侧边栏、腕表、托盘都按它走。「提醒」
 * 页签的头部本来就会展开四项分解（`UnreadCounts`），合计里含 `cross` 是
 * 自洽的——玩家点进去能看见「星轨相交 N」并跳过去。
 *
 * 真正缺的是**入口红点**：`cross` 拆出独立页签之后，没有自己的角标，
 * 玩家不知道那一页有新的。那个由 [`countVrccCrossingsUnread`] 提供。
 */
export function countVrccUnread(
    unread: VrccUnread | null,
    recent: VrccRecentNotifications | null
): number {
    if (unread) {
        return (
            (unread.inbox ?? 0) +
            (unread.cross ?? 0) +
            (unread.chats ?? 0) +
            (unread.notes ?? 0)
        );
    }
    const read = recent?.read ?? 0;
    return (recent?.items ?? []).filter((item) => (item.id ?? 0) > read).length;
}

/**
 * 「星轨相交」页签自己的红点。
 *
 * 补的是**可发现性**：未读早就有了，只是拆出独立页签之后没有入口角标。
 * 合计（[`countVrccUnread`]）里已经含这一项，所以这不是重复计数——两个
 * 数字显示在不同的地方，含义也不同：合计是「星遇同频有几件事」，这个是
 * 「这一页有新的」。
 *
 * 只在服务器给了 `me/unread` 时才有；旧服务器不区分这几处，回退成 0 而不是
 * 拿「最近的提醒」去凑——那些条目属于提醒，不属于这里。
 */
export function countVrccCrossingsUnread(unread: VrccUnread | null): number {
    return unread?.cross ?? 0;
}
