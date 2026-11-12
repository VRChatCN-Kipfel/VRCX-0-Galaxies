// SPDX-License-Identifier: MPL-2.0

import {
    ChevronLeft,
    ChevronRight,
    ChevronsLeft,
    ChevronsRight,
    ExternalLink,
    RefreshCw
} from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/ui/shadcn/button';
import { Spinner } from '@/ui/shadcn/spinner';
import {
    ToggleGroup,
    ToggleGroupItem,
    ToggleGroupSeparator
} from '@/ui/shadcn/toggle-group';

import { buildPageItems } from '../boardPages';
import { useOpenExternalLink } from '../useOpenExternalLink';
import type { VrccBoardSort, VrccModelBoard } from '../vrccApi';
import { VrccCover } from './VrccCover';

const SORTS: readonly VrccBoardSort[] = ['top', 'week', 'new'];

/** 一页多少行。榜单一次取 100 条（接口上限），本地按这个数切页。 */
const PAGE_SIZE = 20;

function isBoardSort(value: unknown): value is VrccBoardSort {
    return SORTS.includes(value as VrccBoardSort);
}

/**
 * 模型榜（1.17.0 起）。开放数据，不需要连接。
 *
 * 与地图榜的差别只在**一行里放什么**：地图用「均分 + 星级 + 评分人数」，
 * 模型只有「喜欢数」这一种量，所以右侧改成一个大数字 + 本周增量，不再有
 * 星级——给喜欢数画五档星属于编造，官方的喜欢没有上限也没有换算关系。
 *
 * 名字优先 `short`（网页显示的那个），没有才退回 BOOTH 原文：键帽、服装这类
 * 商品名常常带一长串日文和括号，整行会被撑爆。
 *
 * `price` 是 BOOTH 上写的**原文**（带货币符号），不解析成数字：不同店铺的
 * 写法不统一（`¥1,500`、`￥1,500〜`、`無料`），自己解析只会显示错价。
 */
export function VrccModelsPanel({
    models,
    sort,
    sortSupported,
    available,
    onSortChange,
    onRefresh
}: {
    models: VrccModelBoard | null;
    sort: VrccBoardSort;
    sortSupported: boolean;
    /** 服务器上到底有没有这个接口；false 表示旧服务器，显示「暂时没有」。 */
    available: boolean;
    onSortChange: (sort: VrccBoardSort) => void;
    onRefresh: () => void;
}) {
    const { t } = useTranslation();
    const { open } = useOpenExternalLink();
    const rows = models?.models ?? [];

    const [page, setPage] = useState(0);
    const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    // 数据变短（换排序、刷新回来条数少了）时把页码收回范围内，
    // 否则会停在空白页上。
    const safePage = Math.min(page, pageCount - 1);

    // 换排序时回到第 1 页。和地图榜同一处理：跟着 `sort` 走，而不是在每个
    // 排序回调里各写一遍。
    useEffect(() => {
        setPage(0);
    }, [sort]);

    const pageRows = useMemo(
        () =>
            (models?.models ?? []).slice(
                safePage * PAGE_SIZE,
                (safePage + 1) * PAGE_SIZE
            ),
        // 依赖 `models` 而不是上面那个 `?? []` 出来的 `rows`：后者为空时每次
        // 渲染都是新数组，会让这个 useMemo 形同虚设。
        [models, safePage]
    );

    // 旧服务器上没有这个接口：不转圈。「正在加载」和「这台服务器还没有」
    // 显示同一句转圈，会让玩家一直等一个永远不会来的东西。
    const showEmpty = rows.length === 0;

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="text-muted-foreground flex shrink-0 items-center gap-2 px-1 pb-2 text-xs">
                {sortSupported && available && (
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
                                    {t(`vrcc.models.sort.${value}`)}
                                </ToggleGroupItem>
                            </Fragment>
                        ))}
                    </ToggleGroup>
                )}
                {/* 模型榜是「每天投一票」，和地图的「打分」不是一回事，
                    提示文案要分开写，否则玩家会以为这里也能打 1–10 分。 */}
                {available && (
                    <span className="min-w-0 truncate">
                        {t('vrcc.models.hint')}
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

            {showEmpty ? (
                <div className="text-muted-foreground flex h-32 items-center justify-center gap-2 text-sm">
                    {available ? <Spinner className="size-3" /> : null}
                    {available
                        ? t('vrcc.models.empty')
                        : t('vrcc.models.unavailable')}
                </div>
            ) : (
                <div className="relative min-h-0 flex-1 overflow-y-auto rounded-xl border">
                    <ul className="divide-y">
                        {pageRows.map((model, index) => {
                            // 本周榜只按本周的喜欢排，`rank` 仍是总榜名次；
                            // 本周的名次是 `place`，没有就按列表位置。
                            const place =
                                sort === 'week'
                                    ? (model.place ??
                                      safePage * PAGE_SIZE + index + 1)
                                    : model.rank;
                            return (
                                <li
                                    key={model.id}
                                    className="hover:bg-muted/40 group flex items-center gap-3 px-3 py-2"
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
                                    {/* 封面直接来自 BOOTH（官方 `img`），不走
                                        星遇的转发地址，所以这里不做可视区延迟
                                        加载：域名不同、也没有本地缓存可退。 */}
                                    <VrccCover
                                        src={model.img ?? null}
                                        className="size-10 shrink-0 rounded object-cover"
                                    />
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate text-sm font-medium">
                                            {model.short?.trim() || model.name}
                                        </div>
                                        {/* 热评优先：官方说模型榜只给热评一条，
                                            那是对「这模型好在哪」最有用的一句。 */}
                                        <div className="text-muted-foreground truncate text-xs">
                                            {model.hot?.text
                                                ? `「${model.hot.text}」${
                                                      model.hot.by
                                                          ? ` · ${model.hot.by}`
                                                          : ''
                                                  }`
                                                : (model.shop ?? '—')}
                                        </div>
                                    </div>
                                    <div className="flex shrink-0 flex-col items-end gap-0.5">
                                        <div className="flex items-baseline gap-1">
                                            <span className="text-sm font-semibold tabular-nums">
                                                {model.likes}
                                            </span>
                                            <span className="text-muted-foreground text-[10px]">
                                                {t('vrcc.models.likes')}
                                            </span>
                                        </div>
                                        <div className="text-muted-foreground flex items-center gap-1 text-[10px] tabular-nums">
                                            {/* 本周榜显示本周几个喜欢，和网页
                                                「本周 N」一样。 */}
                                            {sort === 'week' &&
                                            model.week != null
                                                ? t('vrcc.models.week_count', {
                                                      count: model.week
                                                  })
                                                : (model.price ?? '')}
                                        </div>
                                    </div>
                                    {/* 外链落到星遇的公开页：这一屏的上下文
                                        就是榜单，玩家想看的也是「榜上怎么评」。 */}
                                    {model.page && (
                                        <button
                                            type="button"
                                            onClick={() => open(model.page!)}
                                            className="text-muted-foreground hover:text-primary shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                                            aria-label={t('vrcc.models.open')}
                                        >
                                            <ExternalLink className="size-3.5" />
                                        </button>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}

            {pageCount > 1 && (
                <nav className="flex shrink-0 items-center justify-end gap-0.5 pt-2">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="size-6 p-0"
                        disabled={safePage === 0}
                        aria-label={t('table.pagination.first')}
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
