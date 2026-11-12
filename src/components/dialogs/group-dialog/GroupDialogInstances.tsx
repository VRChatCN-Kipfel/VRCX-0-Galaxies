// SPDX-License-Identifier: MPL-2.0

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
 * ## 来源说明在**每一条**房间里
 *
 * 那句话跟着行自己的 `origin` 走，由 `GroupInstanceRows` 渲染，不在这
 * 里做列表级总结——一个列表里可能混着 VRChat 的实时房间和星遇的社团房间，
 * 底部一句话说不清哪几条不是实时的。
 */
export function GroupDialogInstances({
    activeInstances,
    currentUserId
}: {
    activeInstances: GroupDialogInstanceRow[];
    currentUserId: string | null;
}) {
    return (
        <GroupInstanceRows
            instances={activeInstances}
            currentUserId={currentUserId}
        />
    );
}
