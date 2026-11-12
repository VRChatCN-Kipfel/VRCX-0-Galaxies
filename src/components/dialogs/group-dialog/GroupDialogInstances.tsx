// SPDX-License-Identifier: MPL-2.0

import { useTranslation } from 'react-i18next';

import type { GroupDialogInstanceRow } from '@/domain/entities/group';

import { GroupInstanceRows } from './GroupInstanceRows';

/**
 * 群组详情的「房间」区块。
 *
 * ## 这里**不再拉数据、也不再合并两份**
 *
 * 星遇同频社团的公开房间已经由 `useGroupClubInstanceRecords` 并入
 * `groupInstances`，在进 `mergeGroupInstances` **之前**就合好了——那样好友
 * 才能按 location 塞进这些行（好友是本地 presence 来的，只往**已经存在**的
 * 行里放人）。
 *
 * 曾经这里自己在渲染时把两份拼起来，结果是社团房间在好友分配**之后**才出现，
 * 那几行永远是空的，好友头像和好友数全丢。合并挪到上游之后，这个组件只负责
 * 渲染。
 *
 * ## 来源说明
 *
 * `hasClubRooms` 由上游算好传进来——判断「这里面有没有来自社团的房间」
 * 需要知道社团那份担当了什么，本组件看不到。有就多一行说明：房间来自另一个
 * 平台，人数不是实时的，得让玩家知道。
 */
export function GroupDialogInstances({
    activeInstances,
    currentUserId,
    hasClubRooms = false
}: {
    activeInstances: GroupDialogInstanceRow[];
    currentUserId: string | null;
    hasClubRooms?: boolean;
}) {
    const { t } = useTranslation();

    return (
        <>
            <GroupInstanceRows
                instances={activeInstances}
                currentUserId={currentUserId}
            />
            {hasClubRooms ? (
                <div className="text-muted-foreground/70 mt-1.5 text-[10px] leading-tight">
                    {t('dialog.group.vrcc.rooms_source')}
                </div>
            ) : null}
        </>
    );
}
