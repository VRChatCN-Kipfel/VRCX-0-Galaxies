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
import { useTiltGrid } from './useTiltGrid';
import { VrccCover } from './VrccCover';

const SORTS: readonly VrccBoardSort[] = ['top', 'week', 'new'];

/**
 * 一页多少张卡。榜单一次取 100 条（接口上限），本地按这个数切页。
 * 取 24：列数在 2–12 之间随窗口变，24 能被最常见的几种整除，末行不空半排。
 */
const PAGE_SIZE = 24;

function isBoardSort(value: unknown): value is VrccBoardSort {
    return SORTS.includes(value as VrccBoardSort);
}

/**
 * 模型榜（1.17.0 起）。开放数据，不需要连接。
 *
 * 用卡片而不是一行一条：接口给的封面是 300×300 的方图，玩家判断一个模型靠
 * 的就是「它长什么样」，塞进 40px 缩略图等于把唯一的信息源压成了色块。
 *
 * `price` 是 BOOTH 原文（`¥1,500` / `無料`），**不解析成数字**：各店写法不
 * 统一，自己解析只会显示错价。
 *
 * 同一时刻只允许一张翻着——网格是拿来扫的，全翻过去就谁也认不出谁了。
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
    // 整个网格共用一个指针监听；具体见 useTiltGrid。
    const gridRef = useTiltGrid<HTMLUListElement>();
    const rows = models?.models ?? [];

    const [page, setPage] = useState(0);
    /** 当前翻到背面的那张。`null` 表示全都正面朝上。 */
    const [flippedId, setFlippedId] = useState<number | null>(null);

    const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    // 数据变短时把页码收回范围内，否则会停在空白页上。
    const safePage = Math.min(page, pageCount - 1);

    // 跟着 `sort` 走，而不是在每个排序回调里各写一遍。
    useEffect(() => {
        setPage(0);
    }, [sort]);

    // 换页 / 换排序后，之前翻着的那张可能已经不在这一页了。
    useEffect(() => {
        setFlippedId(null);
    }, [sort, safePage]);

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

    // 「正在加载」和「这台服务器还没有」要分开：都转圈的话，玩家会一直等一个
    // 永远不会来的东西。
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
                <div className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-2">
                    {/* `overflow-x-hidden` 不是装饰：跟随指针的标签是绝对定位
                        的，会飘到卡片外面去；而 CSS 规定一个轴设成 `auto` 之后
                        另一轴就不能是 `visible`，于是它会撑出一条横向滚动条。
                        裁掉横轴只是不让标签把滚动条顶出来——它浮在**网格内部**
                        本来就够用了。 */}
                    <ul
                        ref={gridRef}
                        className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3"
                    >
                        {pageRows.map((model, index) => {
                            // 本周榜只按本周的喜欢排，`rank` 仍是总榜名次；
                            // 本周的名次是 `place`，没有就按列表位置。
                            const place =
                                sort === 'week'
                                    ? (model.place ??
                                      safePage * PAGE_SIZE + index + 1)
                                    : model.rank;
                            const name = model.short?.trim() || model.name;
                            const flipped = flippedId === model.id;
                            return (
                                <li
                                    key={model.id}
                                    data-tilt=""
                                    data-flipped={flipped ? '' : undefined}
                                    className="vrcc-model-card group relative"
                                >
                                    <div className="vrcc-model-card__rotor">
                                        <div className="vrcc-model-card__flip">
                                            <div className="vrcc-model-card__face vrcc-model-card__face--front">
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        setFlippedId(model.id)
                                                    }
                                                    className="vrcc-model-card__cover bg-muted relative block aspect-square w-full overflow-hidden"
                                                    aria-label={t(
                                                        'vrcc.models.flip'
                                                    )}
                                                >
                                                    {/* 跟随指针的反光。 */}
                                                    <span
                                                        className="vrcc-model-card__glare"
                                                        aria-hidden="true"
                                                    />
                                                    {/* 封面直接来自星遇（官方
                                                        `img`），不走 VRChat
                                                        的世界图转发，所以这里
                                                        不做可视区延迟加载：
                                                        域名不同、也没有本地
                                                        缓存可退。 */}
                                                    <VrccCover
                                                        src={model.img ?? null}
                                                        className="size-full object-cover"
                                                    />
                                                    {place != null && (
                                                        <span
                                                            data-model-rank=""
                                                            className={
                                                                place <= 3
                                                                    ? 'bg-primary text-primary-foreground absolute top-1.5 left-1.5 min-w-4 rounded px-1 text-center text-[11px] font-bold tabular-nums'
                                                                    : 'absolute top-1.5 left-1.5 min-w-4 rounded bg-black/55 px-1 text-center text-[11px] font-semibold text-white tabular-nums'
                                                            }
                                                        >
                                                            {place}
                                                        </span>
                                                    )}
                                                    <span className="absolute top-1.5 right-1.5 flex items-baseline gap-0.5 rounded bg-black/55 px-1 py-0.5 text-[11px] font-semibold text-white tabular-nums">
                                                        {model.likes}
                                                        <span className="text-[9px] font-normal opacity-80">
                                                            {t(
                                                                'vrcc.models.likes'
                                                            )}
                                                        </span>
                                                    </span>
                                                </button>

                                                <div className="flex min-w-0 flex-1 flex-col gap-0.5 p-2">
                                                    <div className="truncate text-xs font-medium">
                                                        {name}
                                                    </div>
                                                    {/* 热评优先：官方说模型
                                                        榜只给热评一条，那是
                                                        对「这模型好在哪」最
                                                        有用的一句；没有才
                                                        退回店铺名。 */}
                                                    <div className="text-muted-foreground line-clamp-2 min-h-7 text-[11px] leading-snug">
                                                        {model.hot?.text
                                                            ? `「${model.hot.text}」${
                                                                  model.hot.by
                                                                      ? ` · ${model.hot.by}`
                                                                      : ''
                                                              }`
                                                            : (model.shop ??
                                                              '—')}
                                                    </div>
                                                    <div className="text-muted-foreground mt-auto flex items-center gap-1 text-[11px] tabular-nums">
                                                        {/* 本周榜显示本周几
                                                            个喜欢，和网页
                                                            「本周 N」一样。 */}
                                                        <span className="min-w-0 truncate">
                                                            {sort === 'week' &&
                                                            model.week != null
                                                                ? t(
                                                                      'vrcc.models.week_count',
                                                                      {
                                                                          count: model.week
                                                                      }
                                                                  )
                                                                : (model.price ??
                                                                  '')}
                                                        </span>
                                                        {/* 外链落到星遇的公
                                                            开页：这一屏的
                                                            上下文就是榜单。 */}
                                                        {model.page && (
                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    open(
                                                                        model.page!
                                                                    )
                                                                }
                                                                className="text-muted-foreground hover:text-primary ml-auto shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                                                                aria-label={t(
                                                                    'vrcc.models.open'
                                                                )}
                                                            >
                                                                <ExternalLink className="size-3" />
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* 背面：内容待定，先留白。
                                                点一下翻回正面。 */}
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    setFlippedId(null)
                                                }
                                                className="vrcc-model-card__face vrcc-model-card__face--back"
                                                aria-label={t(
                                                    'vrcc.models.flip_back'
                                                )}
                                                tabIndex={-1}
                                            />
                                        </div>
                                    </div>

                                    {/* 跟随指针的标签，内容和位置都由
                                        useTiltGrid 那边驱动。名字优先用
                                        完整 BOOTH 原文——卡片正面放的是
                                        简称，这里是它被截掉的那部分。 */}
                                    <span
                                        data-tilt-tip=""
                                        className="vrcc-model-card__tip"
                                        aria-hidden="true"
                                    >
                                        {model.name}
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}

            {/* 始终显示，哪怕只有一页（`1`）。单页时每个按钮都自然落在
                `disabled` 上：`safePage === 0` 让「上一页/第一页」灰掉，
                `safePage >= pageCount - 1` 让「下一页/最后一页」灰掉。

                不藏起来是因为**藏了会让版面跳动**：翻到第 5 页、数据变短
                回到 1 页时，底下那条一消失，整块内容往下窜一截。留着它、
                让它全程占位，翻页时视线不用重新定位。 */}
            <nav className="flex shrink-0 items-center justify-end gap-0.5 pt-2">
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
                                item.page === safePage + 1 ? 'page' : undefined
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
        </div>
    );
}
