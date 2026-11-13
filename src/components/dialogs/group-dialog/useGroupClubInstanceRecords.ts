// SPDX-License-Identifier: MPL-2.0

import { useQuery } from '@tanstack/react-query';

import type { GroupInstanceRecord } from '@/domain/entities/group';
import {
    clubCodeForGroup,
    vrccPublicClubQueryOptions
} from '@/repositories/vrccClubRepository';

import { clubRoomsToInstanceRows, type VrccClubRoom } from './clubRooms';

/**
 * 星遇同频社团的公开房间，投影成群组实例记录，和 VRCX 自己那份一起交给
 * `mergeGroupInstances`。
 *
 * **必须在 `useGroupDialogActiveInstances` 之前调用**：好友是本地 presence
 * 来的，由 `mergeGroupInstances` 塞进**已经存在**的行；晚到的房间永远分不到
 * 好友。
 *
 * 拿不到（没连接 / 没 `clubs` 权限 / `404 club_off` / 失败 / 缺短码）就返回
 * 空数组，补位失败不该让群组详情报错。公开的 `/clubs/{code}` 不返回 `rooms`，
 * 但不需要令牌也不占额度，先用它挡一道——大多数群组没入驻社团。
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
            // 必须是 0：mergeGroupInstances 的兜底是 seed.friendCount || seed.userCount，
            // 而 userCount 是总人数，给真值会把「37 人」当成「37 个好友」。
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
