import { ExternalLink, Radar, Sparkles, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { formatRelativeTime } from '@/lib/dateTime';
import { Button } from '@/ui/shadcn/button';
import { Spinner } from '@/ui/shadcn/spinner';

import { crossingMetDay } from '../crossingMetDay';
import type { VrccCrossingCards, VrccCrossings } from '../vrccApi';

const SITE = 'https://vrcc.cc';

/**
 * `why` 的白名单。
 *
 * 不做 `t(`vrcc.crossings.why.${why}`)` 拼键名：`why` 是服务器给的字符串，
 * 拼出来可以是 `constructor`、`__proto__` 这种本来就存在的对象属性，
 * 拿到的不是文案而是对象/`undefined`，界面直接崩。白名单里没有的一律
 * 走 `unknown`。
 */
const WHY_KEYS = [
    'verify',
    'wait',
    'queued',
    'sent',
    'gone',
    'friend'
] as const;

type WhyKey = (typeof WHY_KEYS)[number];

function whyKey(why: string): WhyKey | null {
    return (WHY_KEYS as readonly string[]).includes(why)
        ? (why as WhyKey)
        : null;
}

/**
 * 星轨相交：在同一个 VRChat 房间偶遇过的星遇同频玩家。
 *
 * 与「互相连上」的区别（两者是同一层的两个页签）：
 * - 互相连上：**双向已连线**的星友，是结果；
 * - 星轨相交：只是**同房间擦肩**，大多数还没连线，是线索。
 *
 * 所以每条显示 `mutual` / `linked` / 都没有 三种状态，而不是只给名单。
 *
 * **`hidden` 一定要先处理**：官方文档规定 `hide` 时「客户端不应显示此
 * 模块」——16–17 岁星池没有星轨相交，玩家在隐私设置里也能关掉。把 `hide`
 * 当成普通空列表，等于向不该看到的人确认「这里有星轨相交」这个事实本身。
 * 其余几种原因（未验证、机器人好友排队等）**要显示**并说明下一步，因为
 * 那是「功能在但暂时用不了」。
 *
 * **合规边界**：列表 `/me/crossings` 的 `stars[]` **没有** `vrcUser`；但
 * `/me/crossings/cards` 的卡上**有**（本批 6/6 张都带，官方文档没写这个差别）。
 * 即便拿得到，这一页仍然只把玩家送到网页看完整星卡：官方要求提供「加好友」
 * 入口时只能打开玩家页让人手动点，**不得由程序代发好友请求**，这里也就没有
 * 任何自动加好友的通道。
 */
export function VrccCrossingsPanel({
    connected,
    crossings,
    cards,
    loading,
    crossingsError,
    crossingsNeedsScope,
    onOpenLink,
    onRefresh
}: {
    connected: boolean;
    crossings: VrccCrossings | null;
    /** 完整星卡，只用来显示「今天还能连几颗」。旧服务器上为 null。 */
    cards: VrccCrossingCards | null;
    /** 正在请求。用来区分「加载中」和「确实为空」。 */
    loading: boolean;
    /**
     * 上一次请求失败的原因（人话）；`null` 表示这次成功了。
     *
     * 失败时 `crossings` **不会被清空**，所以这里可能是「有数据 + 有一条
     * 错误提示」，而不是非此即彼。
     */
    crossingsError?: string | null;
    /** 失败是因为令牌缺 `crossings` 权限（要重连才好）。 */
    crossingsNeedsScope?: boolean;
    onOpenLink: (url: string) => void;
    onRefresh: () => void;
}) {
    const { t } = useTranslation();

    if (!connected) {
        return (
            <div className="text-muted-foreground flex h-40 flex-col items-center justify-center gap-2 text-sm">
                <Radar className="size-6" />
                {t('vrcc.crossings.need_connect')}
            </div>
        );
    }

    // `hide`：官方要求整个模块不显示。返回 null，连「不可用」都不说。
    //
    // 判据是后端算好的 `hidden` 字段，不是这里的 `why === 'hide'` 字符串
    // 比较——那样每个消费方都要各判一次，漏一处就是一次信息泄漏。
    if (crossings?.hidden) {
        return null;
    }

    const stars = crossings?.stars ?? [];
    const why = crossings?.why ?? null;
    const left = cards?.left;
    const max = cards?.max;

    // 卡片按星编号索引：列表给的是「谁跟我擦过肩」，卡上才带「在哪遇见 / 怎么
    // 认识的」。旧服务器、或令牌没有 crossings 的完整权限时 `cards` 是 null，
    // 这些行整块不渲染，列表照常显示。
    const cardByN = new Map(
        (cards?.cards ?? []).map((card) => [card.n, card] as const)
    );

    // `why` 非 null 就是「功能在，但暂时用不了」，官方要求把原因告诉玩家。
    //
    // 这是**独立于列表**的状态，不能绑在「列表为空」上：`queued` / `sent` /
    // `gone` / `friend` 这几种前置没满足时，历史记录照样留在 `stars` 里，
    // 服务端只是不再产生新的。只在空列表时提示，玩家会看着一屏旧记录以为
    // 一切照常，其实早就没有新擦肩了。
    const reasonKey = why ? whyKey(why) : null;
    const whyText = why
        ? reasonKey
            ? t(`vrcc.crossings.why.${reasonKey}`)
            : t('vrcc.crossings.why.unknown')
        : null;

    // 没有记录可显示时，原因就是这一页唯一的正文。
    if (whyText && stars.length === 0) {
        return (
            <div className="text-muted-foreground flex h-40 flex-col items-center justify-center gap-2 px-6 text-center text-sm">
                <Radar className="size-6" />
                <div className="leading-relaxed">{whyText}</div>
            </div>
        );
    }

    // 手上一条数据都没有时的三种情况，**必须分开**：
    //
    // 1. 正在请求 —— 说「加载中」。不能走空态，否则每次开页都先闪一下
    //    「还没有擦肩记录」。
    // 2. 请求失败且从没成功过 —— 说「这次没拿到」。把「没拿到」说成
    //    「一条都没有」是在编造事实。
    // 3. 成功过、`stars` 为空 —— 才是真的空。
    if (stars.length === 0 && loading) {
        return (
            <div className="text-muted-foreground flex h-40 items-center justify-center gap-2 text-sm">
                <Spinner className="size-4" />
                {t('vrcc.crossings.loading')}
            </div>
        );
    }

    if (stars.length === 0 && crossingsError) {
        return (
            <div className="text-muted-foreground flex h-40 flex-col items-center justify-center gap-2 px-6 text-center text-sm">
                <Radar className="size-6" />
                <div className="leading-relaxed">
                    {crossingsNeedsScope
                        ? t('vrcc.crossings.unavailable')
                        : t('vrcc.crossings.load_failed')}
                </div>
                {/* 缺权限要引导重新授权；网络失败要引导再试一次。两句话
                    不能混用——让网络问题的人去重连，他只会照做然后更困惑。 */}
                <div className="text-[11px] leading-relaxed">
                    {crossingsNeedsScope
                        ? t('vrcc.crossings.needs_scope')
                        : crossingsError}
                </div>
                {!crossingsNeedsScope && (
                    <Button variant="outline" size="sm" onClick={onRefresh}>
                        {t('vrcc.crossings.retry')}
                    </Button>
                )}
            </div>
        );
    }

    if (stars.length === 0) {
        return (
            <div className="text-muted-foreground flex h-40 flex-col items-center justify-center gap-2 px-6 text-center text-sm">
                <Radar className="size-6" />
                <div className="leading-relaxed">
                    {t('vrcc.crossings.empty')}
                </div>
            </div>
        );
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
            {/* 顶部：今天还能连几颗 + 手动刷新。
                额度只有星卡接口（1.13.0 起）才给，旧服务器上退回条数。 */}
            <div className="flex shrink-0 items-center justify-between px-1">
                <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
                    <Sparkles className="size-3.5" />
                    {left != null && max != null
                        ? t('vrcc.crossings.quota', { left, max })
                        : t('vrcc.crossings.count', { count: stars.length })}
                </div>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={onRefresh}
                    title={t('vrcc.crossings.refresh')}
                >
                    {t('vrcc.crossings.refresh')}
                </Button>
            </div>

            {/* 有记录也有原因：原因照样要说，而且排在「这次刷新失败」前面——
                「为什么不再有新擦肩」比「这次没刷新成功」更要紧，顺序反了会
                让人以为是网络问题。 */}
            {whyText && (
                <div className="flex items-start gap-1.5 rounded-lg border px-2.5 py-2 text-xs leading-relaxed">
                    <TriangleAlert className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
                    <span>{whyText}</span>
                </div>
            )}

            {/* 有旧数据、这次刷新失败：**留着列表**，只在上面加一条提示。
                把已经看到过的记录清掉，比显示一条过时数据更糟。 */}
            {crossingsError && (
                <div className="text-muted-foreground px-1 text-xs">
                    {crossingsNeedsScope
                        ? t('vrcc.crossings.needs_scope')
                        : t('vrcc.crossings.stale_hint')}
                </div>
            )}

            <div
                data-tour="vrcc-crossings-list"
                className="min-h-0 flex-1 overflow-y-auto rounded-xl border"
            >
                <ul className="divide-y">
                    {stars.map((star, index) => {
                        // `n` 是可选字段：服务端省略时是 `undefined`。拿它当
                        // React key 会让所有缺字段的行撞成同一个 key；
                        // `?cross=0` 也会指向一个不存在的编号。索引兜底，
                        // 编号只在真有的时候才用。
                        const no = star.n ?? 0;
                        const key = no > 0 ? `n-${no}` : `i-${index}`;
                        // 列表的 `at` 现在官方已经不提供了（1.15.3 起 removed），
                        // 留着这一支只为兼容旧服务器；线上的擦肩时间在卡的
                        // `pair.met.at` 上，而那个**只精确到天**。
                        const crossedAt = star.at
                            ? formatRelativeTime(star.at, { style: 'short' })
                            : '';
                        const pair = cardByN.get(no)?.pair ?? null;
                        const metWorld = pair?.met?.world ?? null;
                        const metDay = crossingMetDay(pair?.met?.at);
                        // 只按天讲：中间那天中午是服务器的取整锚点，不是
                        // 真实的相遇时刻。见 `crossingMetDay` 的说明。
                        const metWhen = metDay
                            ? metDay.kind === 'date'
                                ? metDay.date
                                : t(`vrcc.crossings.met_${metDay.kind}`)
                            : '';
                        // 卡片还在路上：列表可能已经渲染出来了，而「在哪遇见」
                        // 要等卡片回来才知道。这段时间先占住这一行的高度，
                        // 否则卡片一到，整列会被往下顶一截。
                        //
                        // 只在 `loading` 为真时占位。请求结束仍没有卡片
                        // （旧服务器、权限不足、这次失败）就不再占——
                        // 那会变成一条永远转圈的空行。
                        const metPending = loading && !metWorld;
                        return (
                            <li
                                key={key}
                                className="hover:bg-accent/40 flex items-start gap-3 px-3 py-2"
                            >
                                <span className="text-muted-foreground w-8 shrink-0 pt-0.5 text-right text-xs tabular-nums">
                                    {no > 0 ? `#${no}` : '—'}
                                </span>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5">
                                        <span className="truncate text-sm font-medium">
                                            {star.name ??
                                                t('vrcc.crossings.unnamed')}
                                        </span>
                                        {star.fresh && (
                                            <span className="bg-primary/15 text-primary shrink-0 rounded-full px-1.5 text-[10px] leading-4">
                                                {t('vrcc.crossings.fresh')}
                                            </span>
                                        )}
                                    </div>
                                    {/* 一句话描述；没有就退回匿名星卡介绍。 */}
                                    {(star.line || star.intro) && (
                                        <div className="text-muted-foreground mt-0.5 line-clamp-2 text-xs leading-relaxed">
                                            {star.line ?? star.intro}
                                        </div>
                                    )}
                                    {/* `vrc` 只在双向连上后才有。没连上时显示
                                        的是「未连线」，不是空白——空白会被读成
                                        「对方没有名字」。 */}
                                    <div className="text-muted-foreground mt-0.5 flex items-center gap-2 text-[11px]">
                                        {star.mutual ? (
                                            <span className="flex items-center gap-0.5">
                                                <ExternalLink className="size-3" />
                                                {star.vrc ??
                                                    t('vrcc.crossings.mutual')}
                                            </span>
                                        ) : star.linked ? (
                                            <span>
                                                {t('vrcc.crossings.linked')}
                                            </span>
                                        ) : (
                                            <span>
                                                {t('vrcc.crossings.not_linked')}
                                            </span>
                                        )}
                                        {/* 擦肩发生在什么时候。这一列本来就是
                                            按时间线索排的，「什么时候」是主线索
                                            之一；缺字段时整块不渲染，不留「—」。 */}
                                        {crossedAt && (
                                            <span className="shrink-0">
                                                {crossedAt}
                                            </span>
                                        )}
                                    </div>
                                    {/* 在哪遇见。世界名是**原文**：有些世界名
                                        自带「｜社群名」，有些没有，绝不按分隔符拆。
                                        时间只有日期粒度（同一天的多张卡是同一个
                                        值），所以这里只当「大约什么时候」。
                                        还没拿到卡片时**占住这一行**的高度：先出来
                                        的列表如果少一行，等卡片回来时整列会被往下
                                        顶一截，看着像在跳。 */}
                                    {metWorld ? (
                                        <div
                                            className="text-muted-foreground mt-0.5 truncate text-[11px]"
                                            title={metWorld}
                                        >
                                            {t('vrcc.crossings.met_world', {
                                                world: metWorld
                                            })}
                                            {metWhen && ` · ${metWhen}`}
                                        </div>
                                    ) : (
                                        metPending && (
                                            <div
                                                className="mt-0.5 flex h-4 items-center"
                                                role="status"
                                                aria-label={t(
                                                    'vrcc.crossings.loading'
                                                )}
                                            >
                                                <Spinner className="text-muted-foreground size-3" />
                                            </div>
                                        )
                                    )}
                                </div>
                                {/* 网页上「星轨相交」那一页：可以看完整星卡，
                                    也可以从那里连线。客户端不代做连线。
                                    没有编号时不给按钮——`?cross=0` 指不到东西。 */}
                                {no > 0 && (
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="shrink-0"
                                        onClick={() =>
                                            onOpenLink(
                                                `${SITE}/match/?tab=inbox&cross=${no}`
                                            )
                                        }
                                        aria-label={t(
                                            'vrcc.crossings.open_page'
                                        )}
                                        title={t('vrcc.crossings.open_page')}
                                    >
                                        <Radar className="size-3.5" />
                                    </Button>
                                )}
                            </li>
                        );
                    })}
                </ul>
            </div>
        </div>
    );
}
