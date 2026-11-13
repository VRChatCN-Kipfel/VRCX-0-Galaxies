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
import { useModelCoverReady } from '../useModelCoverCache';
import { useOpenExternalLink } from '../useOpenExternalLink';
import { useVrccRowVisibility } from '../useVrccRowVisibility';
import type { VrccBoardSort, VrccModelBoard } from '../vrccApi';
import { VrccCover } from './VrccCover';
import { VrccModelDialog } from './VrccModelDialog';

const SORTS: readonly VrccBoardSort[] = ['top', 'week', 'new'];

/** 一页多少行。和地图榜一致：一次取 100 条，本地按 20 条切页。 */
const PAGE_SIZE = 20;

function isBoardSort(value: unknown): value is VrccBoardSort {
    return SORTS.includes(value as VrccBoardSort);
}

/**
 * 模型榜（1.17.0 起）。开放数据，不需要连接。
 *
 * ## 和地图榜同一套版式
 *
 * 一行一个模型：名次 + 封面 + 名字/热评 + 右侧喜欢数，单行、`divide-y`、
 * 悬停才出现外链。两个榜单在同一个页面上下并排，版式必须一致——否则玩家
 * 每切一次页签都要重新适应「哪里是名次、哪里是数字」。
 *
 * 差别只在量纲：地图是「均分 + 星级 + 评分人数」，模型只有「喜欢数」这一种
 * 量，所以右侧不画星级（喜欢没有五档换算，画星等于编造），改成一个大数字
 * 加单位，本周榜再补一行本周新增。
 *
 * ## 为什么不再是卡片
 *
 * 上一版是两列封面卡片，配 `StarBorder` 星尘描边 + `ShinyText` 流光。
 * 视觉上更花，代价却很实在：
 *
 * - `StarBorder` 是 canvas，前三名每张每帧要跑一遍一百多行的描边绘制，而且
 *   它的循环条件含 `state.lap >= 0`，**永远不满足停止条件**，一页就是三块
 *   常驻 60fps 的画布，滚动时和列表重排抢主线程，明显发涩；
 * - 卡片把一页从 20 条压到 12 条，同样一屏能比较的模型更少了。
 *
 * 换回单行后，一页 20 条全是普通 DOM，滚动没有常驻 rAF，也就不再需要那些
 * 动效。这是「卡顿」的直接原因。
 *
 * ## 点一行看评论
 *
 * 点整行打开 [`VrccModelDialog`]，显示该模型在星遇同频上的热评。`404`
 * 表示这个模型已不在榜上，对话框里说明这一点，而不是当成错误。
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
    const { open, pending: openLinkPending } = useOpenExternalLink();
    const rows = models?.models ?? [];

    const [page, setPage] = useState(0);
    const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    // 数据变短（换排序、刷新回来条数少了）时把页码收回范围内，
    // 否则会停在空白页上。
    const safePage = Math.min(page, pageCount - 1);

    // 换排序时回到第 1 页。和地图榜同一处理：跟着 `sort` 走。
    useEffect(() => {
        setPage(0);
    }, [sort]);

    const pageRows = useMemo(
        () =>
            (models?.models ?? []).slice(
                safePage * PAGE_SIZE,
                (safePage + 1) * PAGE_SIZE
            ),
        // 依赖 `models` 而不是 `rows`（那个 `?? []` 出来的新数组），
        // 否则 useMemo 每帧都失效。
        [models, safePage]
    );

    // 正在看评论的那个模型。存整行而不是只存 id：对话框要显示名字和封面，
    // 手上已经有这一行了，不必为了标题再请求一次。
    const [opened, setOpened] = useState<
        NonNullable<VrccModelBoard['models']>[number] | null
    >(null);

    // 行是否露在视口里。和地图榜一样，用来决定这一行要不要挂封面图：
    // 20 行里通常只有一屏可见，剩下的先不请求。
    const { visible, observe } = useVrccRowVisibility();

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
                {available && !showEmpty && (
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
                <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border">
                    <ul className="divide-y">
                        {pageRows.map((model, index) => {
                            // 本周榜只按本周的喜欢排，`rank` 仍是总榜名次；
                            // 本周的名次是 `place`，没有就按列表位置。
                            const place =
                                sort === 'week'
                                    ? (model.place ??
                                      safePage * PAGE_SIZE + index + 1)
                                    : (model.rank ?? null);
                            const key = String(model.id);
                            const name = model.short?.trim() || model.name;
                            return (
                                <li
                                    key={model.id}
                                    ref={(element) => observe(element, key)}
                                    className="hover:bg-muted/40 group flex items-center gap-3 px-3 py-2"
                                >
                                    {/* 点整行打开评论对话框：和地图榜「点整行
                                        打开世界详情」是同一个手势。 */}
                                    <button
                                        type="button"
                                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                                        onClick={() => setOpened(model)}
                                        aria-label={`${t(
                                            'vrcc.models.comments'
                                        )}: ${name}`}
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
                                        {/* 封面。缓存的立刻上屏；没缓存的
                                            等这一行可见才挂，不可视连请求都不发。 */}
                                        <ModelRowCover
                                            src={model.img ?? null}
                                            visible={visible.has(key)}
                                        />
                                        <div className="min-w-0 flex-1">
                                            <div className="truncate text-sm font-medium">
                                                {name}
                                            </div>
                                            {/* 有热评就显示热评，没有才显示店铺。
                                            和地图榜「短评优先于作者」同一取向。 */}
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
                                        {/* 右侧数值列：喜欢数在上，价格/本周在
                                            下。喜欢数是这个榜唯一的量纲，值得
                                            占一列，而不是缩进文字里。 */}
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
                                                {sort === 'week' &&
                                                model.week != null
                                                    ? t(
                                                          'vrcc.models.week_count',
                                                          { count: model.week }
                                                      )
                                                    : (model.price ?? '')}
                                            </div>
                                        </div>
                                    </button>
                                    {/* 外链单独留一个：想去 BOOTH 看商品、或去
                                        星遇看完整页面时用。和「在这里看评论」
                                        是两件事。 */}
                                    <button
                                        type="button"
                                        disabled={openLinkPending}
                                        onClick={() =>
                                            open(
                                                model.page ??
                                                    `https://vrcc.cc/models/${model.id}`
                                            )
                                        }
                                        className="text-muted-foreground hover:text-primary shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                                        aria-label={t('vrcc.models.open')}
                                    >
                                        <ExternalLink className="size-3.5" />
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}

            {pageCount > 1 && (
                <nav className="mt-2 flex shrink-0 items-center justify-end gap-0.5">
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

            {opened && (
                <VrccModelDialog
                    model={opened}
                    onClose={() => setOpened(null)}
                />
            )}
        </div>
    );
}

/**
 * 一行里那个 32px 的封面。
 *
 * 单独提出来是为了用 [`useModelCoverReady`]：一个 hook 不能写在 `map()` 的
 * 回调里。它决定这一行现在能不能出图：
 *
 * - **缓存过的**：立刻给地址。翻页回来、切排序回来都不用再等一次加载；
 * - **没缓存的**：等这一行滚进视口再挂，不可视时完全不发请求。
 *
 * 判据不是「可见」而是「可见 **或** 已知可用」：滚出视口又滚回来的行，图
 * 早就在浏览器缓存里，再等一次可见性判断只会让它闪一下空白。
 */
function ModelRowCover({
    src,
    visible
}: {
    src: string | null;
    visible: boolean;
}) {
    const ready = useModelCoverReady(src);
    const show = src && (visible || ready);
    return (
        <VrccCover
            src={show ? src : null}
            className="size-8 shrink-0 rounded object-cover"
        />
    );
}
