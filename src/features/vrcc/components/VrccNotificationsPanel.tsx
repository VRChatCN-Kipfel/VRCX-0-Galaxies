import { BellOff, BellRing, Inbox } from 'lucide-react';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';

import { formatRelativeTime } from '@/lib/dateTime';
import {
    useVrccTourDemoStore,
    VRCC_TOUR_DEMO_UNREAD
} from '@/state/vrccTourDemoStore';
import { Button } from '@/ui/shadcn/button';
import {
    ToggleGroup,
    ToggleGroupItem,
    ToggleGroupSeparator
} from '@/ui/shadcn/toggle-group';

import { useOpenExternalLink } from '../useOpenExternalLink';
import type { VrccNotificationsView } from '../useVrccController';
import type {
    VrccNotes,
    VrccRecentNotifications,
    VrccUnread
} from '../vrccApi';

const SITE = 'https://vrcc.cc';

/**
 * 站点**应用界面**的入口。
 *
 * 和 `SITE` 不是一回事：`SITE` 是拼路径用的域名基址（例如
 * `${SITE}/maps/${world}`），而这里要的是「把人送到星遇同频」的地址。
 * `vrcc.cc` 根路径不是应用本身，`/match` 才是——官方文档里所有指向玩家
 * 界面的地址（连接页、星卡、地图榜）都挂在 `/match/?...` 下面。
 */
const SITE_APP = `${SITE}/match`;

/**
 * 把官方给的**相对路径**拼成完整地址。
 *
 * 官方 `/me/notifications/recent` 的 `url` 形如 `/match/?tab=inbox`，
 * 接在 `https://vrcc.cc` 后面才是可点的链接。已经是绝对地址的原样返回。
 *
 * 没有 url 时回退到应用界面而不是站点根：那才是玩家能继续操作的地方。
 */
function toAbsolute(url: string): string {
    const trimmed = url.trim();
    if (!trimmed) return SITE_APP;
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://'))
        return trimmed;
    return `${SITE}${trimmed.startsWith('/') ? '' : '/'}${trimmed}`;
}

/**
 * 「提醒」页签：最近的提醒、几处未读数、通知中心。
 *
 * 未连接时给一条明确的去路（去「我的」连接），而不是空白表格。
 * 提醒条目如果带 `url`，整行可点，指向 vrcc.cc 对应的页面。
 *
 * 未读数（`me/unread`）和通知中心（`me/notes`）是 1.13.0 加的：服务器还没有
 * 时它们是 null，这两块就不显示，页面和以前一样。
 */
export function VrccNotificationsPanel({
    connected,
    recent,
    unread,
    view,
    notes,
    notesSupported,
    crossingsHidden,
    onViewChange,
    onConnect,
    onOpenWorld
}: {
    connected: boolean;
    recent: VrccRecentNotifications | null;
    unread: VrccUnread | null;
    view: VrccNotificationsView;
    notes: VrccNotes | null;
    /** 服务器有没有通知中心；还不知道时为 null。 */
    notesSupported: boolean | null;
    /** 服务端要求整个星轨相交模块不显示（hide）。 */
    crossingsHidden?: boolean;
    onViewChange: (view: VrccNotificationsView) => void;
    onConnect: () => void;
    /** 通知里带地图的，点开 VRCX-0 自己的世界详情窗。 */
    onOpenWorld: (worldId: string) => void;
}) {
    const { t } = useTranslation();

    /**
     * 导览期间给一份演示用红点。
     *
     * 首次引导只对**从没连过**的玩家自动弹，他们没有真实数据：红点区因为
     * `unread` 为 null 整块不渲染，于是「四处红点」那一步高亮的是空白。
     * 与其把这一步藏掉，不如让它看起来像真的——数字是编的，但结构、位置、
     * 点开会去哪全是真的。
     *
     * 真实数据存在时优先真实数据：已经连上的玩家看到的是自己的红点。
     */
    const tourDemoActive = useVrccTourDemoStore((state) => state.active);
    const unreadForDisplay =
        unread ?? (tourDemoActive ? VRCC_TOUR_DEMO_UNREAD : null);

    if (!connected) {
        return (
            <div className="text-muted-foreground flex h-40 flex-col items-center justify-center gap-3 text-sm">
                <BellOff className="size-6" />
                <div className="text-center">
                    {t('vrcc.notifications.need_connect')}
                </div>
                <Button variant="outline" size="sm" onClick={onConnect}>
                    {t('vrcc.go_connect')}
                </Button>
            </div>
        );
    }

    const showSwitch = notesSupported !== false;
    const current = showSwitch ? view : 'recent';

    return (
        <div className="flex h-full min-h-0 flex-col gap-2">
            {(showSwitch || unread) && (
                <div
                    data-tour="vrcc-notif-header"
                    className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-1"
                >
                    {showSwitch && (
                        <ToggleGroup
                            variant="outline"
                            size="sm"
                            value={[current]}
                            onValueChange={(next) => {
                                const value = next[0];
                                if (value === 'recent' || value === 'notes') {
                                    onViewChange(value);
                                }
                            }}
                        >
                            {(['recent', 'notes'] as const).map(
                                (value, index) => (
                                    <Fragment key={value}>
                                        {index > 0 ? (
                                            <ToggleGroupSeparator />
                                        ) : null}
                                        <ToggleGroupItem
                                            value={value}
                                            className="text-xs"
                                        >
                                            {t(
                                                `vrcc.notifications.view.${value}`
                                            )}
                                        </ToggleGroupItem>
                                    </Fragment>
                                )
                            )}
                        </ToggleGroup>
                    )}
                    {unreadForDisplay && (
                        <UnreadCounts
                            unread={unreadForDisplay}
                            crossingsHidden={crossingsHidden}
                            onOpenNotes={
                                showSwitch
                                    ? () => onViewChange('notes')
                                    : undefined
                            }
                        />
                    )}
                </div>
            )}

            {current === 'notes' ? (
                <NotesList notes={notes} onOpenWorld={onOpenWorld} />
            ) : (
                <RecentList recent={recent} />
            )}
        </div>
    );
}

/**
 * 网页上几处红点的数字。连向我、星轨相交、私聊在网页「连向我」那一页；
 * 通知就在本页签的「通知」里。
 *
 * 服务器没给的那一项不显示：令牌没有 `crossings` 权限时没有 `cross` 这个键，
 * 显示成 0 会让人以为是「没有新的」。
 *
 * `crossingsHidden` 时**连 `cross` 这一项也不显示**。`hide` 的语义是「客户端
 * 不应显示此模块」，页签藏起来了、这一行却还写着「星轨相交 0」，等于换个
 * 地方把模块存在这件事说出来。注意它和「没有这个键」是两件事：服务端在这种
 * 情况下通常仍然返回 `cross: 0`（权限在，只是星池不允许），所以要显式挡。
 */
function UnreadCounts({
    unread,
    crossingsHidden,
    onOpenNotes
}: {
    unread: VrccUnread;
    /** 服务端要求整个星轨相交模块不显示。 */
    crossingsHidden?: boolean;
    onOpenNotes?: () => void;
}) {
    const { t } = useTranslation();
    // 「点一下会去浏览器」这类动作以前没有即时反馈：成功时什么都不做，
    // 玩家只能等浏览器自己跳出来。期间再点一次就会多开一个窗口——
    // 这就是反馈里「触摸板抖一下弹了几个窗口」的来源。
    const { open: openLink, pending: openLinkPending } = useOpenExternalLink();
    // 直接按条件构造，不用 `.filter`：过滤过的数组会丢掉 `key` 的字面量
    // 联合类型，调用方就得写类型断言。
    const items: Array<{
        key: 'inbox' | 'cross' | 'chats' | 'notes';
        href?: string;
    }> = [
        { key: 'inbox', href: `${SITE}/match/?tab=inbox` },
        ...(crossingsHidden
            ? []
            : [
                  {
                      key: 'cross' as const,
                      href: `${SITE}/match/?tab=inbox&cross`
                  }
              ]),
        { key: 'chats', href: `${SITE}/match/?tab=inbox` },
        { key: 'notes' }
    ];

    // 一个计数都没有时整块不渲染。
    //
    // 否则会剩下一个空 div：导览高亮的是一块**什么都没有的地方**，而文案
    // 在讲「这四个数字」——玩家看到的是空白，被要求理解不存在的东西。
    // 直接不渲染，导览那一步就会因为找不到锚点而跳过。
    if (items.every(({ key }) => unread[key] == null)) return null;

    // 一个计数都没有时整块不渲染。
    //
    // 否则会剩下一个空 div：导览高亮的是一块**什么都没有的地方**，而文案
    // 在讲「这四个数字」——玩家看到的是空白，被要求理解不存在的东西。
    // 直接不渲染，导览那一步就会因为找不到锚点而跳过。
    if (items.every(({ key }) => unread[key] == null)) return null;

    return (
        <div
            data-tour="vrcc-unread-counts"
            className="ml-auto flex items-center gap-3 text-xs"
        >
            {items.map(({ key, href }) => {
                const count = unread[key];
                if (count == null) return null;
                const content = (
                    <>
                        {t(`vrcc.unread.${key}`)}{' '}
                        <span className="tabular-nums">{count}</span>
                    </>
                );
                const className =
                    count > 0
                        ? 'text-foreground font-medium hover:underline'
                        : 'text-muted-foreground hover:underline';
                if (href) {
                    return (
                        <button
                            key={key}
                            type="button"
                            disabled={openLinkPending}
                            className={className}
                            onClick={() => openLink(href)}
                        >
                            {content}
                        </button>
                    );
                }
                return onOpenNotes ? (
                    <button
                        key={key}
                        type="button"
                        className={className}
                        onClick={onOpenNotes}
                    >
                        {content}
                    </button>
                ) : (
                    <span key={key} className={className}>
                        {content}
                    </span>
                );
            })}
        </div>
    );
}

function RecentList({ recent }: { recent: VrccRecentNotifications | null }) {
    const { t } = useTranslation();
    // 同 `UnreadCounts`：点开原文要有即时反馈，否则玩家会重复点。
    const { open: openLink, pending: openLinkPending } = useOpenExternalLink();
    const items = recent?.items ?? [];

    if (items.length === 0) {
        return (
            <div className="text-muted-foreground flex h-40 flex-col items-center justify-center gap-2 text-sm">
                <BellRing className="size-6" />
                {t('vrcc.notifications.empty')}
            </div>
        );
    }

    return (
        <div
            data-tour="vrcc-notif-list"
            className="min-h-0 flex-1 overflow-y-auto rounded-xl border"
        >
            <ul className="divide-y">
                {items.map((item) => {
                    // 官方 recent 的 url 是**相对路径**（以 /match/ 开头）。
                    // 契约层的 absolute_url() 会拼上站点根；命令层把拼好的
                    // 结果放在同一个字段里，所以我们这里拿到的可以直接用。
                    const href = item.url ? toAbsolute(item.url) : SITE_APP;
                    return (
                        <li key={item.id}>
                            <button
                                type="button"
                                disabled={openLinkPending}
                                onClick={() => openLink(href)}
                                className="hover:bg-muted/40 block w-full px-3 py-2 text-left"
                            >
                                <div className="flex items-baseline gap-2">
                                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                                        {item.title ??
                                            t('vrcc.notifications.untitled')}
                                    </span>
                                    <span className="text-muted-foreground shrink-0 text-[10px] tabular-nums">
                                        {item.at
                                            ? formatRelativeTime(item.at)
                                            : ''}
                                    </span>
                                </div>
                                {item.body && (
                                    <div className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">
                                        {item.body}
                                    </div>
                                )}
                            </button>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}

/**
 * 通知中心：网页「通知」那张表，新的在前。读了不标已读，没看过的前面带个点。
 *
 * `kind` 以后可能加新的，这里不按 `kind` 分支，一律显示官方给的那句 `text`。
 */
function NotesList({
    notes,
    onOpenWorld
}: {
    notes: VrccNotes | null;
    onOpenWorld: (worldId: string) => void;
}) {
    const { t } = useTranslation();
    const items = notes?.notes ?? [];

    if (items.length === 0) {
        return (
            <div className="text-muted-foreground flex h-40 flex-col items-center justify-center gap-2 text-sm">
                <Inbox className="size-6" />
                {t('vrcc.notifications.notes_empty')}
            </div>
        );
    }

    return (
        <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border">
            <ul className="divide-y">
                {items.map((note) => {
                    const world = note.world ?? '';
                    const body = (
                        <div className="flex items-baseline gap-2">
                            <span
                                className={
                                    note.seen === false
                                        ? 'bg-primary mt-1.5 size-1.5 shrink-0 self-start rounded-full'
                                        : 'mt-1.5 size-1.5 shrink-0 self-start'
                                }
                            />
                            <span
                                className={
                                    note.seen === false
                                        ? 'min-w-0 flex-1 text-sm'
                                        : 'text-muted-foreground min-w-0 flex-1 text-sm'
                                }
                            >
                                {note.text}
                            </span>
                            <span className="text-muted-foreground shrink-0 text-[10px] tabular-nums">
                                {note.at ? formatRelativeTime(note.at) : ''}
                            </span>
                        </div>
                    );
                    return (
                        <li key={note.id}>
                            {world.startsWith('wrld_') ? (
                                <button
                                    type="button"
                                    className="hover:bg-muted/40 block w-full px-3 py-2 text-left"
                                    onClick={() => onOpenWorld(world)}
                                >
                                    {body}
                                </button>
                            ) : (
                                <div className="px-3 py-2">{body}</div>
                            )}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
