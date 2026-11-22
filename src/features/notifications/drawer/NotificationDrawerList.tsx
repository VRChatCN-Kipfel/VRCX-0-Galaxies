import { ChevronRightIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { NotificationRow } from '@/repositories/notificationPersistenceRepository';
import { isUnseenNotification } from '@/shared/utils/notificationSeen';
import { isVrccNotification } from '@/shared/utils/vrccNotification';
import {
    useVrcNotificationStore,
    type NotificationBucket,
    type NotificationCategories
} from '@/state/vrcNotificationStore';
import { Spinner } from '@/ui/shadcn/spinner';

import { NotificationGroupBranch } from '../components/NotificationGroupBranch';
import { NotificationGroupSummary } from '../components/NotificationGroupSummary';
import {
    foldNotifications,
    useExpandedNotificationGroups
} from '../notificationGroups';
import type { NotificationRowActionHandlers } from '../notificationRowActions';
import {
    groupDrawerEntries,
    NOTIFICATION_LIFECYCLE_ORDER,
    type NotificationDrawerEntry,
    type NotificationLifecycleBucket
} from './notificationDrawerBuckets';
import { NotificationDrawerRow } from './NotificationDrawerRow';
import {
    NotificationSourceCapsule,
    type NotificationSourceKey
} from './NotificationSourceCapsule';

export type NotificationDrawerHandlers = NotificationRowActionHandlers & {
    onDeleteNotification(notification: NotificationRow): void | Promise<void>;
    onJoinQueueReady(notification: NotificationRow): void | Promise<void>;
};

type NotificationDrawerListProps = {
    canInviteFromCurrentLocation: boolean;
    categories: NotificationCategories;
    currentUserId?: string;
    handlers: NotificationDrawerHandlers;
    onNavigateToTable(): void;
};

const GROUP_LABEL_KEYS: Record<NotificationLifecycleBucket, string> = {
    action: 'side_panel.notification_center.group_action',
    activity: 'side_panel.notification_center.group_activity',
    system: 'side_panel.notification_center.group_system'
};

/**
 * 离底部还有多远就开始读下一页。
 *
 * 160px 大约是一屏的提示距离：滚到底之前就已经在读了，玩家看不到等待。
 */
const HISTORY_ROOT_MARGIN = '160px';

function notificationBuckets(
    value: NotificationCategories
): NotificationBucket[] {
    return Object.values(value);
}

export function NotificationDrawerList({
    categories,
    currentUserId,
    canInviteFromCurrentLocation,
    handlers,
    onNavigateToTable
}: NotificationDrawerListProps) {
    const { t } = useTranslation();
    const groups = useMemo(() => {
        const entries: NotificationDrawerEntry[] = [];
        for (const bucket of notificationBuckets(categories)) {
            for (const notification of bucket.unseen) {
                entries.push({ notification, isUnseen: true });
            }
            for (const notification of bucket.recent) {
                entries.push({ notification, isUnseen: false });
            }
        }
        return groupDrawerEntries(entries);
    }, [categories]);
    const { expanded, toggle } = useExpandedNotificationGroups();
    const hasAny = NOTIFICATION_LIFECYCLE_ORDER.some(
        (bucket: NotificationLifecycleBucket) => groups[bucket].length > 0
    );
    const historyStatus = useVrcNotificationStore(
        (state) => state.historyStatus
    );
    const loadOlderForCurrentUser = useVrcNotificationStore(
        (state) => state.loadOlderForCurrentUser
    );
    const scrollRef = useRef<HTMLDivElement>(null);
    const sentinelRef = useRef<HTMLDivElement>(null);
    // 「我正在看哪一栏」不是配置，只在本次会话里保留。
    const [source, setSource] = useState<NotificationSourceKey>('vrchat');
    const unseenCount = useVrcNotificationStore((state) => state.unseenCount);
    const rows = useVrcNotificationStore((state) => state.rows);
    const vrccUnseenCount = useVrcNotificationStore(
        (state) => state.vrccUnseenCount
    );
    /**
     * VRCC 栏的内容：本地表里属于站外的那些行。
     *
     * 现在先把**已经在 `rows` 里**的取出来渲染——首屏本来就含全部未读 + 最近
     * 24 小时，所以刚连上时看到的就是这些。更早的星遇历史要等 P2 换成
     * `/me/notes` 的独立查询再翻页：`loadOlderForCurrentUser` 翻的是通知总表，
     * 游标不按来源切分。
     */
    const vrccRows = useMemo(
        () => rows.filter((row) => isVrccNotification(row)),
        [rows]
    );
    // 两个数字各算各的：总数里含站外提醒，VRChat 那一段要把它减掉。
    const sourceOptions = useMemo(
        () => [
            {
                key: 'vrchat' as const,
                label: 'VRChat',
                count: Math.max(0, unseenCount - vrccUnseenCount)
            },
            {
                key: 'vrcc' as const,
                label: t('vrcc.title'),
                count: vrccUnseenCount
            }
        ],
        [t, unseenCount, vrccUnseenCount]
    );

    /**
     * 触底续页：哨兵进入「滚动容器 + 160px」时读下一页。
     *
     * 根节点是**这个**滚动容器而不是视口——抽屉本身不滚动，用视口当根时
     * 哨兵永远「可见」，一打开抽屉就会把历史全读进来。
     *
     * jsdom 没有 `IntersectionObserver`，测试与降级环境直接跳过：翻页是增强，
     * 不是能挡住通知中心的东西。
     */
    useEffect(() => {
        const sentinel = sentinelRef.current;
        const root = scrollRef.current;
        if (
            source !== 'vrchat' ||
            !hasAny ||
            !sentinel ||
            !root ||
            typeof IntersectionObserver === 'undefined'
        ) {
            return undefined;
        }
        const observer = new IntersectionObserver(
            (entries) => {
                if (!entries.some((entry) => entry.isIntersecting)) {
                    return;
                }
                if (historyStatus !== 'idle') {
                    return;
                }
                // 失败不写状态：留在 `idle`，下次滚到这里再试一次。
                void loadOlderForCurrentUser().catch(() => undefined);
            },
            { root, rootMargin: HISTORY_ROOT_MARGIN }
        );
        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [hasAny, historyStatus, loadOlderForCurrentUser, source]);

    function renderRow(
        bucket: NotificationLifecycleBucket,
        entry: NotificationDrawerEntry,
        nested = false
    ) {
        return (
            <NotificationDrawerRow
                key={`${bucket}:${entry.notification.id}`}
                notification={entry.notification}
                isUnseen={entry.isUnseen}
                nested={nested}
                currentUserId={currentUserId}
                canInviteFromCurrentLocation={canInviteFromCurrentLocation}
                handlers={handlers}
            />
        );
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="px-4 pt-2">
                <NotificationSourceCapsule
                    value={source}
                    options={sourceOptions}
                    onChange={setSource}
                    label={t('side_panel.notification_center.source_filter')}
                    className="w-full"
                />
            </div>
            <div
                ref={scrollRef}
                className="min-h-0 flex-1 overflow-y-auto py-2"
            >
                {source === 'vrcc' ? (
                    vrccRows.length ? (
                        <div>
                            {vrccRows.map((row) => (
                                <NotificationDrawerRow
                                    key={`vrcc:${row.id}`}
                                    notification={row}
                                    isUnseen={isUnseenNotification(row)}
                                    currentUserId={currentUserId}
                                    canInviteFromCurrentLocation={
                                        canInviteFromCurrentLocation
                                    }
                                    handlers={handlers}
                                />
                            ))}
                        </div>
                    ) : (
                        <div className="text-muted-foreground flex items-center justify-center p-8 text-center text-sm">
                            {t('vrcc.notifications.empty')}
                        </div>
                    )
                ) : (
                    <>
                        {hasAny ? (
                            NOTIFICATION_LIFECYCLE_ORDER.map(
                                (bucket: NotificationLifecycleBucket) => {
                                    const items = groups[bucket];
                                    if (!items.length) {
                                        return null;
                                    }
                                    return (
                                        <div key={bucket} className="mb-2">
                                            <div className="text-muted-foreground flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium">
                                                <span>
                                                    {t(
                                                        GROUP_LABEL_KEYS[bucket]
                                                    )}
                                                </span>
                                                <span>({items.length})</span>
                                            </div>
                                            {foldNotifications(
                                                items,
                                                (entry) => entry.notification,
                                                (entry) => entry.isUnseen
                                            ).map((fold) => {
                                                if (fold.kind === 'single') {
                                                    return renderRow(
                                                        bucket,
                                                        fold.item
                                                    );
                                                }
                                                const isExpanded = expanded.has(
                                                    fold.runKey
                                                );
                                                return (
                                                    <div
                                                        key={`${bucket}:group:${fold.runKey}`}
                                                        className={
                                                            isExpanded
                                                                ? 'border-border/50 border-b'
                                                                : undefined
                                                        }
                                                    >
                                                        <NotificationGroupSummary
                                                            variant="drawer"
                                                            rows={fold.items.map(
                                                                (entry) =>
                                                                    entry.notification
                                                            )}
                                                            unseen={fold.items.some(
                                                                (entry) =>
                                                                    entry.isUnseen
                                                            )}
                                                            expanded={
                                                                isExpanded
                                                            }
                                                            onToggle={() =>
                                                                toggle(
                                                                    fold.runKey
                                                                )
                                                            }
                                                        />
                                                        {isExpanded ? (
                                                            <NotificationGroupBranch
                                                                variant="drawer"
                                                                items={
                                                                    fold.items
                                                                }
                                                                getKey={(
                                                                    entry
                                                                ) =>
                                                                    String(
                                                                        entry
                                                                            .notification
                                                                            .id
                                                                    )
                                                                }
                                                                renderItem={(
                                                                    entry
                                                                ) =>
                                                                    renderRow(
                                                                        bucket,
                                                                        entry,
                                                                        true
                                                                    )
                                                                }
                                                            />
                                                        ) : null}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    );
                                }
                            )
                        ) : (
                            <div className="text-muted-foreground flex items-center justify-center p-8 text-sm">
                                {t(
                                    'side_panel.notification_center.no_new_notifications'
                                )}
                            </div>
                        )}
                        <div ref={sentinelRef} aria-hidden="true" />
                        {historyStatus === 'loading' ? (
                            <div className="text-muted-foreground flex items-center justify-center gap-2 px-4 py-3 text-xs">
                                <Spinner data-icon="inline-start" />
                                {t(
                                    'side_panel.notification_center.loading_older'
                                )}
                            </div>
                        ) : null}
                        {historyStatus === 'done' && hasAny ? (
                            <div className="text-muted-foreground px-4 pt-3 text-center text-xs">
                                {t(
                                    'side_panel.notification_center.no_more_history'
                                )}
                            </div>
                        ) : null}
                        <button
                            type="button"
                            className="text-muted-foreground hover:text-foreground flex w-full items-center justify-center gap-1 px-4 py-3 text-xs font-medium transition-colors hover:bg-(--state-hover-surface)"
                            onClick={onNavigateToTable}
                        >
                            {t('side_panel.notification_center.view_more')}
                            <ChevronRightIcon className="size-3.5" />
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}
