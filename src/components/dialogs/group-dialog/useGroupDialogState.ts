import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { GroupInstanceRecord } from '@/domain/entities/group';
import type { EntityRecord } from '@/domain/entities/shared';
import type { LoadStatus } from '@/domain/shared/types';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { commands } from '@/platform/tauri/bindings';
import type {
    GroupMemberPatch,
    GroupProfileUpdate
} from '@/platform/tauri/bindings';
import gameLogRepository from '@/repositories/gameLogRepository';
import groupProfileRepository from '@/repositories/groupProfileRepository';
import { unwrapVrchatResponse } from '@/repositories/vrchatRequest';
import { enrichEntityDialogHistory } from '@/services/dialogService';
import { recordLocationHintsFromInstances } from '@/services/domainIngestionService';
import { toast } from '@/services/toastService';
import { normalizeString } from '@/shared/utils/string';
import { useDialogStore } from '@/state/dialogStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useModalStore } from '@/state/modalStore';
import { useMyGroupsRevisionStore } from '@/state/myGroupsRevisionStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import type { GroupActionStatus } from './groupDialogTypes';
import { buildGroupDialogViewState } from './groupDialogViewState';
import { useGroupClubInstanceRecords } from './useGroupClubInstanceRecords';
import { useGroupDialogActiveInstances } from './useGroupDialogActiveInstances';
import { useGroupOwnerProfile } from './useGroupOwnerProfile';

interface GroupDialogStateInput {
    groupId?: string;
    seedData?: EntityRecord | null;
}

interface ActiveGroupTarget {
    groupId: string;
    endpoint: string;
}

const groupDialogStatus: {
    readonly loading: 'loading';
    readonly empty: 'empty';
    readonly ready: 'ready';
} = {
    loading: 'loading',
    empty: 'empty',
    ready: 'ready'
};

const EMPTY_GROUP_INSTANCES: GroupInstanceRecord[] = [];

export type GroupPreviousInstanceRow =
    Awaited<
        ReturnType<typeof gameLogRepository.getPreviousInstancesByGroupId>
    > extends Map<unknown, infer V>
        ? V & { createdAt?: string }
        : EntityRecord;

function isEntityRecord(value: unknown): value is EntityRecord {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function useGroupDialogState({
    groupId,
    seedData = null
}: GroupDialogStateInput) {
    const { t } = useTranslation();

    const normalizedGroupId = groupId?.trim() ?? '';
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const currentLocation = useRuntimeStore(
        (state) => state.gameState.currentLocation
    );
    const groupInstancesState = useRuntimeStore(
        (state) => state.groupInstances
    );
    const groupInstances =
        groupInstancesState.userId === currentUserId &&
        groupInstancesState.endpoint === currentEndpoint
            ? groupInstancesState.instances
            : EMPTY_GROUP_INSTANCES;
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const confirm = useModalStore((state) => state.confirm);
    const updateEntityDialogMetadata = useDialogStore(
        (state) => state.updateEntityDialogMetadata
    );
    const closeDialog = useDialogStore((state) => state.closeDialog);
    const bumpMyGroupsRevision = useMyGroupsRevisionStore(
        (state) => state.bumpRevision
    );
    const [group, setGroup] = useState(() =>
        seedData ? groupProfileRepository.normalize(seedData) : null
    );
    const [loadStatus, setLoadStatus] = useState<LoadStatus>(
        normalizedGroupId ? 'running' : 'idle'
    );
    const [actionStatus, setActionStatus] = useState<GroupActionStatus>('idle');
    const [detail, setDetail] = useState('');
    const [previousInstances, setPreviousInstances] = useState<
        GroupPreviousInstanceRow[]
    >([]);
    const actionStatusRef = useRef<GroupActionStatus>('idle');
    const activeGroupTargetRef = useRef<ActiveGroupTarget>({
        groupId: normalizedGroupId,
        endpoint: currentEndpoint
    });
    // 星遇同频社团的公开房间，投影成群组实例记录。
    //
    // **必须在 `useGroupDialogActiveInstances` 之前算出来**，因为好友是按
    // location 塞进**已经存在**的行的（见下面合成处的注释）。
    const clubInstanceRecords = useGroupClubInstanceRecords(group);
    const { activeInstances, rawActiveInstances } =
        useGroupDialogActiveInstances({
            groupId: normalizedGroupId,
            // 星遇同频社团的公开房间**并入**群组实例一起过管道，不能事后追加。
            //
            // VRCX 自己拉群组实例走 `users/{me}/instances/groups/{group}`，
            // 只返回「我作为成员能看到的」——自己没加入的公开群组一个房都拿
            // 不到。星遇补的是那一块。但好友是本地 presence 来的，由
            // `mergeGroupInstances` 按 location 塞进**已经存在**的行；如果社团
            // 房间在它之后才追加，那一行永远不会有人，好友头像和好友数全丢。
            //
            // **顺序：星遇在前，VRChat 在后。**
            // `mergeGroupInstances` 用 `Object.assign(existing, …, seed)` 合并
            // 同 location 的行，后写的 `seed` 覆盖先写的值。VRChat 给的是
            // 权威数据（实时、带好友、带玩家列表），星遇只是它拿不到时的补位，
            // 所以 VRChat 那一份必须排在后面，冲突时才压得住星遇的快照。
            groupInstances: [...clubInstanceRecords, ...groupInstances],
            friendsById,
            currentUserSnapshot,
            currentLocation
        });
    const ownerProfile = useGroupOwnerProfile({
        currentEndpoint,
        friendsById,
        group
    });

    useEffect(() => {
        setGroup(seedData ? groupProfileRepository.normalize(seedData) : null);
    }, [seedData]);

    useEffect(() => {
        activeGroupTargetRef.current = {
            groupId: normalizedGroupId,
            endpoint: currentEndpoint
        };
    }, [currentEndpoint, normalizedGroupId]);

    useEffect(() => {
        if (!group?.id || !group?.name) {
            return;
        }
        updateEntityDialogMetadata({
            kind: 'group',
            entityId: group.id,
            title: group.name
        });
        enrichEntityDialogHistory({
            kind: 'group',
            entityId: group.id,
            title: group.name,
            imageUrl: group.iconUrl || group.bannerUrl
        });
    }, [
        group?.bannerUrl,
        group?.iconUrl,
        group?.id,
        group?.name,
        updateEntityDialogMetadata
    ]);

    useEffect(() => {
        let active = true;

        if (!normalizedGroupId) {
            setGroup(null);
            setLoadStatus('error');
            setDetail(
                t('dialog.group.empty.no_group_id_was_provided_for_this_dialog')
            );
            return () => {
                active = false;
            };
        }

        setGroup(seedData ? groupProfileRepository.normalize(seedData) : null);
        setPreviousInstances([]);
        setLoadStatus('running');
        setDetail('');

        groupProfileRepository
            .getGroupProfile({
                groupId: normalizedGroupId,
                dialog: true
            })
            .then((nextGroup) => {
                if (!active) {
                    return;
                }

                setGroup(nextGroup);
                setLoadStatus('ready');
            })
            .catch((error: unknown) => {
                if (!active) {
                    return;
                }

                if (seedData) {
                    setGroup(groupProfileRepository.normalize(seedData));
                    setLoadStatus('ready');
                    setDetail(
                        error instanceof Error
                            ? error.message
                            : t(
                                  'dialog.group.error.failed_to_refresh_the_remote_group_snapshot'
                              )
                    );
                    return;
                }

                setGroup(null);
                setLoadStatus('error');
                setDetail(
                    error instanceof Error
                        ? error.message
                        : t(
                              'dialog.group.error.failed_to_load_the_group_profile'
                          )
                );
            });

        return () => {
            active = false;
        };
    }, [currentEndpoint, normalizedGroupId, seedData, t]);

    useEffect(() => {
        let active = true;

        if (!normalizedGroupId) {
            setPreviousInstances([]);
            return () => {
                active = false;
            };
        }

        gameLogRepository
            .getPreviousInstancesByGroupId(normalizedGroupId)
            .then((rows) => {
                if (!active) {
                    return;
                }
                const values =
                    rows instanceof Map ? Array.from(rows.values()) : [];
                setPreviousInstances(values);
            })
            .catch(() => {
                if (active) {
                    setPreviousInstances([]);
                }
            });

        return () => {
            active = false;
        };
    }, [normalizedGroupId]);

    useEffect(() => {
        if (!rawActiveInstances.length || !currentEndpoint) {
            return;
        }

        recordLocationHintsFromInstances({
            endpoint: currentEndpoint,
            instances: rawActiveInstances.map((row) => ({
                ...row,
                groupId: normalizedGroupId,
                groupName: group?.name || group?.displayName || ''
            }))
        });
    }, [
        currentEndpoint,
        group?.displayName,
        group?.name,
        normalizedGroupId,
        rawActiveInstances
    ]);

    if (loadStatus === 'running' && !group) {
        return {
            status: groupDialogStatus.loading,
            emptyState: {
                loading: true,
                title: t('dialog.group.loading.loading_group_profile'),
                description: t(
                    'dialog.group.loading.fetching_the_current_vrchat_group_snapshot_for_this_dialog'
                )
            }
        };
    }

    if (!group) {
        return {
            status: groupDialogStatus.empty,
            emptyState: {
                title: t('dialog.group.error.group_profile_unavailable'),
                description:
                    detail ||
                    t(
                        'dialog.group.description.group_snapshot_unavailable_description'
                    )
            }
        };
    }

    const viewState = buildGroupDialogViewState({
        currentUserId,
        friendsById,
        group,
        ownerProfile
    });

    async function refreshGroupProfile() {
        const nextGroup = await groupProfileRepository.getGroupProfile({
            groupId: normalizedGroupId,
            force: true
        });
        if (
            activeGroupTargetRef.current.groupId === normalizedGroupId &&
            activeGroupTargetRef.current.endpoint === currentEndpoint
        ) {
            setGroup(nextGroup);
        }
        return nextGroup;
    }

    function commitGroupSnapshot(nextGroup: unknown) {
        if (!isEntityRecord(nextGroup)) {
            return;
        }
        if (
            activeGroupTargetRef.current.groupId === normalizedGroupId &&
            activeGroupTargetRef.current.endpoint === currentEndpoint
        ) {
            setGroup(groupProfileRepository.normalize(nextGroup));
        }
    }

    async function joinGroup() {
        if (!viewState.canJoin || actionStatusRef.current !== 'idle') {
            return;
        }

        actionStatusRef.current = 'join';
        setActionStatus('join');
        try {
            const response = await groupProfileRepository.joinGroup({
                groupId: normalizedGroupId
            });
            const nextStatus = normalizeString(
                response.json?.membershipStatus
            ).toLowerCase();
            await refreshGroupProfile().catch(() => {
                if (response.json && typeof response.json === 'object') {
                    commitGroupSnapshot(response.json);
                }
            });
            bumpMyGroupsRevision();
            toast.add({
                type: 'success',
                title:
                    nextStatus === 'requested'
                        ? t('message.group.join_request_sent')
                        : t('message.group.joined')
            });
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('dialog.group.toast.failed_to_join_group')
            });
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function leaveGroup() {
        if (!viewState.canLeave || actionStatusRef.current !== 'idle') {
            return;
        }

        actionStatusRef.current = 'leave';
        setActionStatus('leave');
        const result = await confirm({
            title: t('dialog.group.modal.leave_group'),
            description: t('dialog.group.dynamic.leave_value', {
                value: group?.name || group?.id
            }),
            destructive: true,
            confirmText: t('dialog.group.modal.leave'),
            cancelText: t('common.actions.cancel')
        });

        if (!result.ok) {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
            return;
        }

        try {
            const response = await groupProfileRepository.leaveGroup({
                groupId: normalizedGroupId
            });
            await refreshGroupProfile().catch(() => {
                if (response.json && typeof response.json === 'object') {
                    commitGroupSnapshot(response.json);
                }
            });
            bumpMyGroupsRevision();
            toast.add({
                type: 'success',
                title: t('dialog.group.label.group_left')
            });
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('dialog.group.toast.failed_to_leave_group')
            });
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function deleteGroup() {
        if (!viewState.canDelete || actionStatusRef.current !== 'idle') {
            return;
        }

        actionStatusRef.current = 'delete';
        setActionStatus('delete');
        const result = await confirm({
            title: t('dialog.group.modal.delete_group'),
            description: t('dialog.group.dynamic.delete_value', {
                value: group?.name || group?.id
            }),
            destructive: true,
            confirmText: t('dialog.group.modal.delete'),
            cancelText: t('common.actions.cancel')
        });

        if (!result.ok) {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
            return;
        }

        try {
            unwrapVrchatResponse(
                await commands.appVrchatGroupDelete({
                    groupId: normalizedGroupId
                }),
                `groups/${encodeURIComponent(normalizedGroupId)}`
            );
            bumpMyGroupsRevision();
            toast.add({
                type: 'success',
                title: t('dialog.group.toast.group_deleted')
            });
            closeDialog();
        } catch (error) {
            toast.add({
                type: 'error',
                title: userFacingErrorMessage(
                    error,
                    t('dialog.group.toast.failed_to_delete_group')
                )
            });
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function cancelJoinRequest() {
        if (
            viewState.memberStatus !== 'requested' ||
            actionStatusRef.current !== 'idle'
        ) {
            return;
        }

        actionStatusRef.current = 'cancel-request';
        setActionStatus('cancel-request');
        try {
            await groupProfileRepository.cancelGroupRequest({
                groupId: normalizedGroupId
            });
            await refreshGroupProfile();
            toast.add({
                type: 'success',
                title: t('dialog.group.success.group_join_request_cancelled')
            });
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t(
                              'dialog.group.toast.failed_to_cancel_group_join_request'
                          )
            });
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function refreshGroup() {
        if (actionStatusRef.current !== 'idle') {
            return;
        }

        actionStatusRef.current = 'refresh';
        setActionStatus('refresh');
        try {
            await refreshGroupProfile();
            toast.add({
                type: 'success',
                title: t('dialog.group.success.group_refreshed')
            });
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('dialog.group.toast.failed_to_refresh_group')
            });
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function updateGroupRepresentation(enabled: boolean) {
        if (!viewState.isMember || actionStatusRef.current !== 'idle') {
            return;
        }

        actionStatusRef.current = 'represent';
        setActionStatus('represent');
        try {
            await groupProfileRepository.setGroupRepresentation({
                groupId: normalizedGroupId,
                isRepresenting: enabled
            });
            await refreshGroupProfile();
            bumpMyGroupsRevision();
            toast.add({
                type: 'success',
                title: enabled
                    ? t('dialog.group.toast.group_represented')
                    : t('dialog.group.toast.group_unrepresented')
            });
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t(
                              'dialog.group.toast.failed_to_update_group_representation'
                          )
            });
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function updateGroupMemberProps(
        params: GroupMemberPatch,
        label: string
    ) {
        if (
            !viewState.isMember ||
            !currentUserId ||
            actionStatusRef.current !== 'idle'
        ) {
            return;
        }

        actionStatusRef.current = 'member-props';
        setActionStatus('member-props');
        try {
            await groupProfileRepository.setGroupMemberProps({
                groupId: normalizedGroupId,
                userId: currentUserId,
                params
            });
            await refreshGroupProfile();
            bumpMyGroupsRevision();
            toast.add({ type: 'success', title: label });
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t(
                              'dialog.group.toast.failed_to_update_group_member_settings'
                          )
            });
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function updateGroupBlock(enabled: boolean) {
        if (
            viewState.isMember ||
            !currentUserId ||
            actionStatusRef.current !== 'idle'
        ) {
            return;
        }

        const result = await confirm({
            title: enabled
                ? t('dialog.group.modal.block_group')
                : t('dialog.group.modal.unblock_group'),
            description: group?.name || group?.id,
            confirmText: enabled
                ? t('dialog.group.actions.block')
                : t('dialog.group.actions.unblock'),
            cancelText: t('common.actions.cancel'),
            destructive: enabled
        });
        if (!result.ok) {
            return;
        }

        actionStatusRef.current = 'block';
        setActionStatus('block');
        try {
            if (enabled) {
                await groupProfileRepository.blockGroup({
                    groupId: normalizedGroupId
                });
            } else {
                await groupProfileRepository.unblockGroup({
                    groupId: normalizedGroupId,
                    userId: currentUserId
                });
            }
            await refreshGroupProfile();
            toast.add({
                type: 'success',
                title: enabled
                    ? t('dialog.group.toast.group_blocked')
                    : t('dialog.group.toast.group_unblocked')
            });
        } catch (error) {
            toast.add({
                type: 'error',
                title: userFacingErrorMessage(
                    error,
                    t('dialog.group.toast.failed_to_update_group_block_state')
                )
            });
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function updateGroupProfile(params: GroupProfileUpdate) {
        if (actionStatusRef.current !== 'idle') {
            return false;
        }

        actionStatusRef.current = 'profile';
        setActionStatus('profile');
        try {
            const response = unwrapVrchatResponse(
                await commands.appVrchatGroupUpdate({
                    groupId: normalizedGroupId,
                    params
                }),
                `groups/${encodeURIComponent(normalizedGroupId)}`
            );
            await refreshGroupProfile().catch(() => {
                commitGroupSnapshot(response.json);
            });
            bumpMyGroupsRevision();
            toast.add({
                type: 'success',
                title: t('dialog.group.toast.group_profile_updated')
            });
            return true;
        } catch (error) {
            toast.add({
                type: 'error',
                title: userFacingErrorMessage(
                    error,
                    t('dialog.group.toast.failed_to_update_group_profile')
                )
            });
            return false;
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    return {
        status: groupDialogStatus.ready,
        group,
        detail,
        actionStatus,
        activeInstances,
        // 房间里有没有来自星遇社团的。合并去重之后只有行自己知道来源，
        // 所以在这里算好传给渲染层，避免那里再猜一遍。
        hasClubInstances: activeInstances.some(
            (instance) => instance.fromVrccClub === true
        ),
        previousInstances,
        setPreviousInstances,
        viewState,
        actions: {
            cancelJoinRequest,
            deleteGroup,
            joinGroup,
            leaveGroup,
            refreshGroup,
            updateGroupBlock,
            updateGroupMemberProps,
            updateGroupProfile,
            updateGroupRepresentation
        },
        labels: {
            subscribedToAnnouncements: t(
                'dialog.group.label.subscribed_to_announcements'
            ),
            unsubscribedAnnouncements: t(
                'dialog.group.members.unsubscribed_announcements'
            ),
            visibilityUpdated: t('message.group.visibility_updated')
        }
    };
}
