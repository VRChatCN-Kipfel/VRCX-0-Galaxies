// SPDX-License-Identifier: MPL-2.0

import type { GroupDialogInstanceRow } from '@/domain/entities/group';

/**
 * 从星遇同频的社团房间（`/me/clubs/{code}` 的 `rooms[]`）造出群组详情能直接
 * 渲染的实例行。
 *
 * ## 为什么需要这个
 *
 * VRCX 自己拉群组房间走 `users/{me}/instances/groups/{group}`——它只返回
 * **当前玩家作为成员能看到的实例**。所以打开一个自己没加入的公开群组时，
 * 「房间列表」永远是「没有房间」。
 *
 * 实测 `星夜吧｜STAR NIGHT`（`ONLYFR.5576`）就是这种：VRCX 一个房都拿不到，
 * 而星遇给了两个公开房，还带完整启动链接：
 *
 * ```text
 * https://vrchat.com/home/launch?worldId=wrld_410b9d63-…&instanceId=05026~group(grp_f0b1a7b9-…)~groupAccessType(public)~region(jp)
 * ```
 *
 * 所以这里做的**不是补一份已有的数据，而是补 VRCX 拿不到的那一份**。
 *
 * ## 造出来的行会**进入 `mergeGroupInstances` 的输入**
 *
 * 这一点很关键：好友是本地 presence 来的，由 `mergeGroupInstances` 按
 * location 塞进**已经存在**的行。所以这些行必须在它之前就存在，否则好友
 * 永远落不上去。
 *
 * 因此 `friendCount` 显式给 **0**：`mergeGroupInstances` 建行时的兜底是
 * `Number(seed.friendCount || seed.userCount)`，而这里的 `userCount` 是
 * **总人数**（37 / 2 那种）。给了真值就会把「37 人」当成「37 个好友」。
 */
export type VrccClubRoom = {
    map?: string | null;
    users?: number | null;
    cap?: number | null;
    link?: string | null;
};

/** 一个 `vrchat.com/home/launch?…` 链接拆出来的东西。 */
type LaunchTarget = {
    worldId: string;
    instanceId: string;
    location: string;
};

/**
 * 从启动链接里拆出 `worldId` 与 `instanceId`，再拼成 VRCX 的 location 串。
 *
 * VRCX 内部的 location 就是 `wrld_x:12345~region(jp)` 这种形状，
 * `parseLocation` 直接吃它。星遇给的是 VRChat 官方 launch 链接，两者之间
 * 只差一个「把 query 参数拼回去」。
 *
 * **拆不出来就返回 `null`**，不要拿半个 location 去渲染——那会变成一条
 * 点不开的空行。
 */
export function launchLinkToLocation(link: string): LaunchTarget | null {
    const trimmed = link.trim();
    if (!trimmed) {
        return null;
    }

    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        return null;
    }

    // 只认 VRChat 自己的域名：贴着别的域名的「链接」不该被当成可加入的房间。
    const host = parsed.hostname.toLowerCase();
    if (host !== 'vrchat.com' && !host.endsWith('.vrchat.com')) {
        return null;
    }

    const worldId = (parsed.searchParams.get('worldId') || '').trim();
    const instanceId = (parsed.searchParams.get('instanceId') || '').trim();
    if (!worldId.startsWith('wrld_') || !instanceId) {
        return null;
    }

    return {
        worldId,
        instanceId,
        location: `${worldId}:${instanceId}`
    };
}

/**
 * 把星遇的 `rooms[]` 转成 `GroupDialogInstanceRow[]`。
 *
 * 造出来的行只带**能确定的东西**：location、人数、上限、地图名（有就用）。
 * 玩家列表、好友数、房主一概不编——星遇不给这些，编出来就是假数据。
 */
export function clubRoomsToInstanceRows(
    rooms: VrccClubRoom[],
    groupId: string
): GroupDialogInstanceRow[] {
    const rows: GroupDialogInstanceRow[] = [];
    const seen = new Set<string>();

    for (const room of Array.isArray(rooms) ? rooms : []) {
        const link = typeof room?.link === 'string' ? room.link : '';
        const target = launchLinkToLocation(link);
        if (!target) {
            continue;
        }
        // 同一局不该出现两次。星遇偶尔会给两个不同 instanceId 的同图房，
        // 那是真的两个房，所以只按 location 去重。
        if (seen.has(target.location)) {
            continue;
        }
        seen.add(target.location);

        const capacity =
            typeof room.cap === 'number' && room.cap > 0 ? room.cap : undefined;
        const userCount =
            typeof room.users === 'number' && room.users >= 0
                ? room.users
                : undefined;
        const worldName =
            typeof room.map === 'string' && room.map.trim()
                ? room.map.trim()
                : undefined;

        rows.push({
            // `id` / `instanceId` 都放 instanceId：VRCX 的实例行按它去重、
            // 也按它拼 location，两边必须是同一份。
            id: target.instanceId,
            instanceId: target.instanceId,
            worldId: target.worldId,
            location: target.location,
            tag: target.location,
            // `ref` 是给 `LocationWorld` 读的投影对象，塞最小可用形状。
            ref: {
                id: target.instanceId,
                location: target.location,
                worldId: target.worldId
            },
            users: [],
            // **必须是 0**，理由见文件头。
            friendCount: 0,
            worldName,
            capacity,
            userCount,
            // 公开群组实例：星遇只列公开房，所以这两项是确定的。
            groupAccessType: 'public',
            groupId,
            group: { id: groupId },
            // 标记来源，供上层统计「列表里有没有社团房间」。放在行上而不是
            // 另开一个集合：合并去重之后，只有行自己知道它是从哪来的。
            origin: 'vrcc'
        });
    }

    return rows;
}
