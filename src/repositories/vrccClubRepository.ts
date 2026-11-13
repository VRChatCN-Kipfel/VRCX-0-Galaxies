// SPDX-License-Identifier: MPL-2.0

import { queryOptions } from '@tanstack/react-query';

import { entityQueryPolicies, queryKeys } from '@/lib/entityQueryCache';
import { commands } from '@/platform/tauri/bindings';

/**
 * 一个群组对应的星遇同频社团（`GET /clubs/{code}`）。
 *
 * 公开接口：不需要令牌、不占个人额度，所以没连星遇同频也看得到。后端把
 * `404` 转成 `null`——绝大多数群组没入驻社团，那是常态不是故障。
 */
export function vrccPublicClubQueryOptions(code: string) {
    const trimmed = code.trim();
    return queryOptions({
        queryKey: queryKeys.groupVrccClub(trimmed),
        queryFn: async () =>
            isClubCodeShaped(trimmed) ? commands.appVrccClub(trimmed) : null,
        ...entityQueryPolicies.vrccClub
    });
}

/** 短码形状，同官方 openapi 的 `pattern`。大小写不限（两种都实测 200）。 */
export function isClubCodeShaped(code: string): boolean {
    return /^[A-Za-z0-9]{3,6}\.\d{4}$/.test(code.trim());
}

/**
 * 从群组记录里拼出社团短码：`shortCode` + `.` + `discriminator`，也就是群组
 * 详情左栏顶上那行小字。缺任何一个就返回空串——那种群组不该去问。
 */
export function clubCodeForGroup(group: {
    shortCode?: string | null;
    discriminator?: string | null;
}): string {
    const shortCode = String(group.shortCode ?? '').trim();
    const discriminator = String(group.discriminator ?? '').trim();
    if (!shortCode || !discriminator) {
        return '';
    }
    return `${shortCode}.${discriminator}`;
}
