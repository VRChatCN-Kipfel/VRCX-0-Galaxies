// SPDX-License-Identifier: MPL-2.0

import { queryOptions } from '@tanstack/react-query';

import { entityQueryPolicies, queryKeys } from '@/lib/entityQueryCache';
import { commands } from '@/platform/tauri/bindings';

/**
 * 一个群组对应的星遇同频社团（`GET /clubs/{code}`，1.18.0 起）。
 *
 * ## 短码从哪来
 *
 * 就是 VRChat 群组自己的 `shortCode` + `.` + `discriminator`——群组详情左栏
 * 顶上那行小字（`KIPFEL.2104`）拼的就是它，实测和星遇同频的 `code` 是同一
 * 个字符串。所以**不需要额外接口反查**，也不需要翻群组的 `links` 找
 * `vrcc.cc/c/<短码>`。
 *
 * ## 为什么是公开接口
 *
 * `/clubs/{code}` 不需要令牌，也不占个人额度。所以**没连星遇同频的玩家一样
 * 看得到社团卡片**，和世界详情那张评分卡是同一个思路。
 *
 * ## `null` 是常态，不是故障
 *
 * 没入驻、审核中、下架、只给成员看、不展示的，服务器一律回同样的
 * `404 not_found`——**看不出是哪一种**。后端把它转成 `null`，调用方据此
 * 整块不渲染。绝大多数 VRChat 群组都会走到这一条。
 *
 * 形状不对的短码（缺 `shortCode` 或 `discriminator`）在本地就短路，不发请求。
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

/**
 * 短码形状：`^[A-Za-z0-9]{3,6}\.\d{4}$`。
 *
 * 官方 openapi 的 `pattern` 就这么写。**本地先挡一遍**是为了不在群组缺
 * `discriminator` 时拿 `"KIPFEL."` 这种半截值去问服务器——那必然 404，
 * 白白给每个群组都留一条「查过但查不到」的缓存。
 *
 * 大小写不限：实测 `kipfel.2104` 和 `KIPFEL.2104` 都是 200。
 */
export function isClubCodeShaped(code: string): boolean {
    return /^[A-Za-z0-9]{3,6}\.\d{4}$/.test(code.trim());
}

/**
 * 从群组记录里拼出社团短码。
 *
 * `shortCode` 和 `discriminator` 缺任何一个都返回空串——那种群组根本没资格
 * 有社团，界面不该去问。
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
