// SPDX-License-Identifier: MPL-2.0

import {
    ChevronLeft,
    ChevronRight,
    ChevronsLeft,
    ChevronsRight,
    ExternalLink,
    RefreshCw
} from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { VrccStars } from '@/components/vrcc/VrccStars';
import { Button } from '@/ui/shadcn/button';
import { Spinner } from '@/ui/shadcn/spinner';
import {
    ToggleGroup,
    ToggleGroupItem,
    ToggleGroupSeparator
} from '@/ui/shadcn/toggle-group';

import { buildPageItems } from '../boardPages';
import { useOpenExternalLink } from '../useOpenExternalLink';
import { useVrccRowVisibility } from '../useVrccRowVisibility';
import { useVrccWorldCovers } from '../useVrccWorldCovers';
import type { VrccBoard, VrccBoardSort } from '../vrccApi';
import { vrccCoverUrl } from '../vrccCover';
import { VrccCover } from './VrccCover';

const SORTS: readonly VrccBoardSort[] = ['top', 'week', 'new'];

/** 一页多少行。榜单一次取 100 条（接口上限），本地按这个数切页。 */
const PAGE_SIZE = 20;

function isBoardSort(value: unknown): value is VrccBoardSort {
    return SORTS.includes(value as VrccBoardSort);
}

const SITE = 'https://vrcc.cc';

/**
 * 地图榜。开放数据，不需要连接。
 *
 * 密度取向：一行一张图，名次 + 名字 + 作者 + 均分 + 评分人数，全部单行，
 * 靠右对齐数字；悬停才出现外链，静止时不留视觉噪声。
 *
 * 排序（1.13.0 起）：总榜、本周、新上榜，和网页地图榜一样。服务器还不认
 * `sort` 时（`sortSupported` 为 false）不显示切换。
 */
export function VrccMapsPanel({
    boards,
    sort,
    sortSupported,
    onSortChange,
    onRefresh,
    onOpenWorld
}: {
    boards: VrccBoard | null;
    sort: VrccBoardSort;
    sortSupported: boolean;
    onSortChange: (sort: VrccBoardSort) => void;
    onRefresh: () => void;
    /** 点一行时打开 VRCX-0 自己的世界详情窗，不跳网页。 */
    onOpenWorld: (worldId: string) => void;
}) {
    const { t } = useTranslation();
    // 榜单每行右侧那个「去网页看」：点下去要有即时反馈，否则玩家会重复点。
    const { open: openLink, pending: openLinkPending } = useOpenExternalLink();
    const maps = boards?.maps ?? [];

    /**
     * 一次取满 100 条、本地分页。
     *
     * `/boards/maps` 的 `limit` 上限就是 100，翻页不再发请求；将来切到
     * `/me/board`（没有 limit，一次给全量）时这套切片原样可用。
     */
    const [page, setPage] = useState(0);
    const pageCount = Math.max(1, Math.ceil(maps.length / PAGE_SIZE));
    // 换排序后整个列表换掉了，页码可能越界；夹一次比在每个排序回调里
    // 各自重置更省心，也覆盖「服务器这次回的条数比上次少」这种情况。
    const safePage = Math.min(page, pageCount - 1);
    const pageRows = maps.slice(
        safePage * PAGE_SIZE,
        (safePage + 1) * PAGE_SIZE
    );
    const min = boards?.min;

    // 封面：VRChat 的记录（清楚）优先，没有就退到星遇的小图；
    // 不可视的行连星遇的图也不挂，省下那次请求。
    // 依赖 `boards` 而不是上面那个 `?? []` 出来的 `maps`：后者为空时每次
    // 渲染都是新数组，会让 useMemo 形同虚设。
    const worldIds = useMemo(
        () => (boards?.maps ?? []).map((map) => map.world),
        [boards]
    );
    const { visible, observe } = useVrccRowVisibility();
    const covers = useVrccWorldCovers(worldIds, visible);

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div
                data-tour="vrcc-maps-sorts"
                className="text-muted-foreground flex shrink-0 items-center gap-2 px-1 pb-2 text-xs"
            >
                {sortSupported && (
                    <ToggleGroup
                        variant="outline"
                        size="sm"
                        value={[sort]}
                        onValueChange={(next) => {
                            const value = next[0];
                            if (isBoardSort(value)) onSortChange(value);
                        }}
                    >
                        {SORTS.map((value, index) => (
                            <Fragment key={value}>
                                {index > 0 ? <ToggleGroupSeparator /> : null}
                                <ToggleGroupItem
                                    value={value}
                                    className="text-xs"
                                >
                                    {t(`vrcc.maps.sort.${value}`)}
                                </ToggleGroupItem>
                            </Fragment>
                        ))}
                    </ToggleGroup>
                )}
                {/* `min` 只在榜单拉到之后才有值。加载中、拉失败、或旧服务器
                    没给这个字段时都不该渲染——否则会显示成「满  人评分才进总榜」。 */}
                {min != null && (
                    <span className="min-w-0 truncate">
                        {t('vrcc.maps.hint', { min })}
                    </span>
                )}
                <Button
                    variant="ghost"
                    size="icon"
                    className="ml-auto size-6"
                    onClick={onRefresh}
                    aria-label={t('common.actions.refresh')}
                >
                    <RefreshCw className="size-3" />
                </Button>
            </div>

            {maps.length === 0 ? (
                <div className="text-muted-foreground flex h-32 items-center justify-center gap-2 text-sm">
                    <Spinner className="size-3" />
                    {t('vrcc.maps.empty')}
                </div>
            ) : (
                <div
                    data-tour="vrcc-maps-list"
                    className="relative min-h-0 flex-1 overflow-y-auto rounded-xl border"
                >
                    {/*
                     * 「换个排法」那一步只点亮榜单**前几行**，而不是整个列表。
                     *
                     * 整块都亮的话，气泡只能落在列表下缘、压住最后几行；而这一步
                     * 只想让玩家看到「切换排序后名次跟着重排」，看前几名就够。
                     * 前几行的并集正好在可视区顶部，气泡落在它下方不挡关键内容。
                     *
                     * 用一个绝对定位的覆盖层来标这个范围，而不是逐行加属性：
                     * 覆盖层不参与布局（`pointer-events: none`），布局完全不变，
                     * 而多元素高亮要的是**一个可测量的矩形**。
                     *
                     * 高度按行高估算即可——它只是给导览画框用的，不必精确到像素。
                     * 悬停列表时淡出，避免那块半透明区域看起来像加载遮罩。
                     */}
                    <div
                        data-tour="vrcc-maps-head"
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[268px]"
                    />
                    <ul className="divide-y">
                        {pageRows.map((map, index) => {
                            // 本周榜只按本周的打分排，`rank` 却还是总榜名次：
                            // 本周的名次就是在列表里的位置，和网页「本周」一样。
                            const place =
                                sort === 'week'
                                    ? safePage * PAGE_SIZE + index + 1
                                    : map.rank;
                            return (
                                <li
                                    key={map.world}
                                    // 导览靠它拿到「玩家此刻看得见的第一行」是哪个
                                    // 世界，再打开那张图的详情。从 DOM 取而不是再
                                    // 请求一次榜单：数据已经在界面上了。
                                    data-world={map.world}
                                    // 导览第 6 步要单独高亮「第一行」，让玩家看清
                                    // 「接下来要打开的是这一行」，而不是让详情凭空
                                    // 弹出来。只标第一行：多行都标就没有「具体某一
                                    // 行」这个语义了。
                                    {...(index === 0
                                        ? { 'data-tour': 'vrcc-maps-first-row' }
                                        : {})}
                                    // 用整个 `<li>` 观察，而不是那个 32px 的图：
                                    // 判断的是「这一行有没有露在视口里」。
                                    ref={(element) =>
                                        observe(element, map.world)
                                    }
                                    className="hover:bg-muted/40 group flex items-center gap-3 px-3 py-2"
                                >
                                    {/* 点整行打开 VRCX-0 自己的世界详情窗：这是
                                    官方插件的做法，玩家熟悉，也不需要联网。 */}
                                    <button
                                        type="button"
                                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                                        onClick={() => onOpenWorld(map.world)}
                                    >
                                        <span
                                            className={
                                                (place ?? 99) <= 3
                                                    ? 'text-primary w-6 shrink-0 text-right text-sm font-bold tabular-nums'
                                                    : 'text-muted-foreground w-6 shrink-0 text-right text-sm tabular-nums'
                                            }
                                        >
                                            {place ?? '—'}
                                        </span>
                                        {/* 封面。两级来源：
                                        1. VRChat 的世界图（清楚，来自本地缓存）；
                                        2. 缓存没命中且**这一行可见**时，用星遇
                                           的小图顶上，保证不空窗。
                                        不可视的行两者都不挂——星遇那次请求省下来，
                                        VRChat 的记录交给后台预载，滚下去时就有了。
                                        加载失败时组件整体返回 null，行退回纯文字。 */}
                                        <VrccCover
                                            src={
                                                covers[map.world] ??
                                                (visible.has(map.world)
                                                    ? vrccCoverUrl(
                                                          map.imgUrl,
                                                          map.img
                                                      )
                                                    : null)
                                            }
                                            className="size-8 shrink-0 rounded object-cover"
                                        />
                                        <div className="min-w-0 flex-1">
                                            <div className="truncate text-sm font-medium">
                                                {map.name ?? map.world}
                                            </div>
                                            {/* 有口碑短评就显示短评，没有才显示作者。
                                            短评是官方数据里唯一一句「这图好在哪」，
                                            对玩家比作者名有用，但只有一行位置。 */}
                                            <div className="text-muted-foreground truncate text-xs">
                                                {map.hot?.text
                                                    ? `「${map.hot.text}」${
                                                          map.hot.by
                                                              ? ` · ${map.hot.by}`
                                                              : ''
                                                      }`
                                                    : (map.author ?? '—')}
                                            </div>
                                        </div>
                                        {/* 星级在上、分数在下，右侧一列。
                                        星负责扫视排序，数字负责精确比较——
                                        五档星分不出 8.4 和 8.2，两者缺一不可。
                                        星单独占一行会把行高抬高约 14px，这是
                                        有意的：当前布局下 20 行里约 18 行都在
                                        视口内，行高不敏感，可读性更重要。 */}
                                        <div className="flex shrink-0 flex-col items-end gap-0.5">
                                            <VrccStars
                                                score={map.avg}
                                                size="sm"
                                            />
                                            <div className="flex items-baseline gap-1">
                                                <span className="text-sm font-semibold tabular-nums">
                                                    {map.avg != null
                                                        ? map.avg.toFixed(1)
                                                        : '—'}
                                                </span>
                                                <span className="text-muted-foreground text-[10px] tabular-nums">
                                                    {/* 本周榜显示本周几人打分，和网页上的「本周 N」一样。 */}
                                                    {sort === 'week' &&
                                                    map.week != null
                                                        ? t(
                                                              'vrcc.maps.week_count',
                                                              {
                                                                  count: map.week
                                                              }
                                                          )
                                                        : (map.raters ?? 0)}
                                                </span>
                                            </div>
                                        </div>
                                    </button>
                                    {/* 外链单独留一个：想去网页看详情时用，
                                    和「在 VRCX 里看」是两件事。 */}
                                    <button
                                        type="button"
                                        disabled={openLinkPending}
                                        onClick={() =>
                                            openLink(
                                                map.page ??
                                                    `${SITE}/maps/${map.world}`
                                            )
                                        }
                                        className="text-muted-foreground hover:text-primary shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                                        aria-label={t('vrcc.maps.open')}
                                    >
                                        <ExternalLink className="size-3.5" />
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}
            {/* 本地翻页：一次已取满，点这些按钮不再发请求。 */}
            {pageCount > 1 && (
                <nav className="mt-2 flex shrink-0 items-center justify-center gap-0.5">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="size-6 p-0"
                        disabled={safePage === 0}
                        aria-label={t('table.pagination.page_number', {
                            page: 1
                        })}
                        onClick={() => setPage(0)}
                    >
                        <ChevronsLeft className="size-3.5" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="size-6 p-0"
                        disabled={safePage === 0}
                        aria-label={t('table.pagination.previous')}
                        onClick={() => setPage(safePage - 1)}
                    >
                        <ChevronLeft className="size-3.5" />
                    </Button>
                    {buildPageItems(safePage + 1, pageCount).map((item) =>
                        item.kind === 'gap' ? (
                            <span
                                key={item.key}
                                aria-hidden="true"
                                className="text-muted-foreground w-4 text-center text-xs"
                            >
                                …
                            </span>
                        ) : (
                            <Button
                                key={item.page}
                                variant={
                                    item.page === safePage + 1
                                        ? 'secondary'
                                        : 'ghost'
                                }
                                size="sm"
                                className="h-6 min-w-6 px-1 text-xs tabular-nums"
                                aria-current={
                                    item.page === safePage + 1
                                        ? 'page'
                                        : undefined
                                }
                                aria-label={t('table.pagination.page_number', {
                                    page: item.page
                                })}
                                onClick={() => setPage(item.page - 1)}
                            >
                                {item.page}
                            </Button>
                        )
                    )}
                    <Button
                        variant="ghost"
                        size="sm"
                        className="size-6 p-0"
                        disabled={safePage >= pageCount - 1}
                        aria-label={t('table.pagination.next')}
                        onClick={() => setPage(safePage + 1)}
                    >
                        <ChevronRight className="size-3.5" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="size-6 p-0"
                        disabled={safePage >= pageCount - 1}
                        aria-label={t('table.pagination.page_number', {
                            page: pageCount
                        })}
                        onClick={() => setPage(pageCount - 1)}
                    >
                        <ChevronsRight className="size-3.5" />
                    </Button>
                </nav>
            )}
        </div>
    );
}
