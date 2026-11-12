// SPDX-License-Identifier: MPL-2.0

import { useQuery } from '@tanstack/react-query';

import type { GroupInstanceRecord } from '@/domain/entities/group';
import {
    clubCodeForGroup,
    vrccPublicClubQueryOptions
} from '@/repositories/vrccClubRepository';

import { clubRoomsToInstanceRows, type VrccClubRoom } from './clubRooms';

/**
 * 星遇同频社团的公开房间，投影成**群组实例记录**，好和 VRCX 自己那份一起
 * 交给 `mergeGroupInstances`。
 *
 * ## 为什么非得在这一层（而不是在渲染时拼）
 *
 * 好友是**本地 presence** 来的：`mergeGroupInstances` 先按群组实例建行，再
 * 遍历好友名单、把每个人塞进**已经存在**的那一行。所以如果社团房间是在
 * `mergeGroupInstances` **之后**才追加进列表，那一行永远不会有人——好友头像
 * 和好友数全丢。
 *
 * 所以这个 hook 在 `useGroupDialogActiveInstances` **之前**把房间算出来，
 * 两条路从同一个入口进管道。好友、排序、当前房间置顶因此全部自动一致。
 *
 * ## 返回 `GroupInstanceRecord` 而不是实例行
 *
 * `mergeGroupInstances` 的输入是**原始记录**，归一化、群组过滤、
 * `isOpenGroupInstance` 判断都归它做。这里把行反投影回记录形状，正是为了让
 * 它们走同一条管道而不是绕过去。
 *
 * ## 拿不到时返回空数组
 *
 * 没连接、没有 `clubs` 权限、16–17 岁星池（`404 club_off`）、网络失败、
 * 群组没有短码——全都返回 `[]`。**补位失败不该让群组详情报错**，房间区块
 * 继续显示 VRCX 自己那份结果（也就是「没有房间」）。
 *
 * 公开的 `/clubs/{code}` 不返回 `rooms`（实测确认），但不需要令牌也不占
 * 额度，所以先用它挡一道：大多数群组根本没入驻社团，答 404 就不发带令牌
 * 那一条，省一次个人额度。
 *
 * ## `friendCount` 必须显式给 0
 *
 * `mergeGroupInstances` 建行时的兜底是 `Number(seed.friendCount || seed.userCount)`。
 * 而我们这里的 `userCount` 是**总人数**（实测 37 / 2 那种）。给了真值就会
 * 把「37 人」当成「37 个好友」——好友头像全对不上，数字也是错的。0 是假值，
 * 会继续落到 `|| 0`，正确。
 */
export function useGroupClubInstanceRecords(
    group: {
        id?: string;
        shortCode?: string | null;
        discriminator?: string | null;
    } | null
): GroupInstanceRecord[] {
    const code = clubCodeForGroup(group ?? {});

    const clubQuery = useQuery({
        ...vrccPublicClubQueryOptions(code),
        enabled: Boolean(code)
    });

    const detailQuery = useQuery({
        queryKey: ['group', 'vrcc-club-rooms', code] as const,
        queryFn: async () => {
            const { commands } = await import('@/platform/tauri/bindings');
            return commands.appVrccMyClub(code);
        },
        enabled: Boolean(code) && Boolean(clubQuery.data?.club),
        staleTime: 60_000,
        gcTime: 5 * 60_000,
        retry: 0
    });

    if (!code) {
        return EMPTY;
    }
    const rooms = Array.isArray(detailQuery.data?.club?.rooms)
        ? (detailQuery.data?.club?.rooms as VrccClubRoom[])
        : [];
    if (!rooms.length) {
        return EMPTY;
    }

    return clubRoomsToInstanceRows(rooms, String(group?.id ?? '')).map(
        (row) => ({
            id: row.id,
            instanceId: row.instanceId,
            worldId: row.worldId,
            location: row.location,
            tag: row.tag,
            ref: row.ref,
            users: row.users,
            friendCount: 0,
            userCount: row.userCount,
            capacity: row.capacity,
            worldName: row.worldName,
            groupAccessType: row.groupAccessType,
            groupId: row.groupId,
            group: row.group,
            // 带上来源标记：合并去重之后，只有行自己知道它是从哪来的。
            origin: 'vrcc'
        })
    );
}

/**
 * 同一个空数组常量。
 *
 * 每次返回新数组会让调用方的 `useMemo` / effect 依赖每帧都变，把「没有社团」
 * 变成永不停歇的重算。空状态是常态（绝大多数群组没入驻），所以这一条值得
 * 一个稳定引用。
 */
const EMPTY: GroupInstanceRecord[] = [];
