// SPDX-License-Identifier: MPL-2.0

/**
 * 站外提醒在通知中心里的标识。
 *
 * 与 Rust 侧 `runtime-host-desktop::vrcc` 里的 `NOTICE_ROW_TYPE` 必须一致：
 * 那边按这个字符串写行，这边按它认行。改名要一起改，否则表现是「通知中心里
 * 出现了几条点不动的陌生条目」，而编译和类型检查都不会报错。
 */
export const VRCC_NOTIFICATION_TYPE = 'vrcc.notice';

/**
 * 站外提醒的 type 前缀。
 *
 * `vrcc.notice` 是通用提醒，`vrcc.note.<kind>` 是 `me/notes` 细分出来的族
 * （`link` / `mutual` / `gift` / `invite` / `yq` / `map` / `about`）。两者都
 * 属于站外来源，所以判定按前缀而不是等值——**新增一种 kind 时这里不用改**。
 */
const VRCC_NOTIFICATION_TYPE_PREFIX = 'vrcc.';

/**
 * 站外提醒的落点 scheme。
 *
 * 写进行里的实际值是 `vrcc:notifications`；这里只按 scheme 判，所以将来
 * 多出别的站外落点（例如指向某一位星）时不必再改这一处。
 */
const VRCC_LINK_SCHEME = 'vrcc:';

type NotificationTypeLike = { link?: string; type?: string } | null | undefined;

/** 这一行是不是站外提醒。 */
export function isVrccNotification(
    notification: NotificationTypeLike
): boolean {
    return String(notification?.type || '')
        .trim()
        .startsWith(VRCC_NOTIFICATION_TYPE_PREFIX);
}

/** 这个 link 是不是跳回本应用的指令（而不是要交给浏览器的地址）。 */
export function isVrccNotificationLink(link: unknown): boolean {
    return String(link || '')
        .trim()
        .startsWith(VRCC_LINK_SCHEME);
}
