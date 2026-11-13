// SPDX-License-Identifier: MPL-2.0

import { useQuery } from '@tanstack/react-query';
import {
    CircleIcon,
    ExternalLinkIcon,
    SparklesIcon,
    ThumbsUpIcon,
    UserCheckIcon
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { queryKeys } from '@/lib/entityQueryCache';
import {
    clubCodeForGroup,
    vrccPublicClubQueryOptions
} from '@/repositories/vrccClubRepository';
import { fetchVrccScopeGrants } from '@/repositories/vrccMapRepository';
import { openExternalLink } from '@/services/shellIntegrationService';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

/**
 * 评级徽章的配色。
 *
 * ## 名字用官方的，颜色用玩家的
 *
 * 名字仍然是官方的 `1` 三等星 → `4` 北极星：那是接口 `gradeName` 给的原文，
 * 玩家在网页、PV、别的客户端里看到的是同一套，不自创一套平行的叫法。
 *
 * 但官方的**名字不表达强弱**——「北极星」听起来只是某颗星，不是最高档；
 * 网页上这个评级也几乎不显示，玩家没有先验认知。所以强弱交给**颜色**，
 * 用抽卡玩家已经形成肌肉记忆的那套秩序：
 *
 * ```text
 * 金(4) → 紫(3) → 蓝(2) → 绿(1) → 白
 * ```
 *
 * 没有评级给白，一个安静的「未分级」。
 *
 * ## 为什么不是从红开始
 *
 * 「红→金→紫→蓝→绿」本来是最想用的那套（红就是「出大红」）。实测在深色
 * 背景上**红色的观感是「危险」不是「稀有」**：一个 `rose` 的圆角小徽章贴在
 * 社团名右边，第一眼读出来是「这个社团出问题了」，而不是「这个社团最高档」。
 * UI 里的红色已经在报警（错误横幅、封禁标记、危险操作）上被用满了，
 * 抢不过那个既有语义。
 *
 * 所以整条秩序**下移一档**，从金色开始：
 *
 * | grade | 名字 | 颜色 |
 * | --- | --- | --- |
 * | 4 | 北极星 | 金 |
 * | 3 | 一等星 | 紫 |
 * | 2 | 二等星 | 蓝 |
 * | 1 | 三等星 | 绿 |
 * | `null` | 未分级 | 白 |
 *
 * 顶端仍然是「最贵的那种颜色」，末尾仍然是「没有颜色」，只是把整条带子挪
 * 开红色的语义区。金往下的顺序完全没变。
 *
 * ## 绿在这里是可以用的
 *
 * 绿色在这个仓库里确实被「在线/活跃」占过（`ModerationStatusBadge` 的
 * `active`、各种在线小圆点）。但那条秩序**下移之后**，绿色落到了 `1` 三等星
 * ——最低的实体档，玩家几乎不会把它读成「在线徽章」，因为它旁边明明白白写
 * 着「三等星」。而如果为了避这个歧义把绿色空掉，四档就会剩三个颜色可用，
 * 秩序反而断了。
 *
 * ## 白不是「最弱的一档」
 *
 * 接口的 `grade` 实测 15 个里有 3 个是 `null`，官方自己就没给它评级。所以
 * 白档用中性描边、不带任何色相，让它落在四档**之外**，读起来像一个空缺。
 *
 * ## 为什么用渐变
 *
 * 深色背景上纯色块要么发脏要么太跳，四档四个纯色更像调色板。每档用**同色系
 * 两段渐变**把饱和度压住：颜色只做底，字的颜色和星图标颜色才是信号。
 *
 * 紫档是这套秩序里唯一的冷暖过渡（金→紫→蓝），所以它在渐变上走
 * `violet → fuchsia`，把「比金更冷、比蓝更暖」做进色相里。
 *
 * ## 顶档多一圈描边
 *
 * 金档额外加 `ring`：`北极星` 实测只有 3/15 个社团有，是真正的稀缺档，值得
 * 一点额外的视觉重量。其余三档不加——**只有顶档特殊，「稀有」才成立**。
 */
const GRADE_STYLES: Record<number, string> = {
    4: 'border-amber-500/50 from-amber-400/30 to-yellow-500/20 text-amber-600 ring-1 ring-amber-500/30 dark:text-amber-300',
    3: 'border-violet-500/45 from-violet-500/25 to-fuchsia-500/20 text-violet-600 dark:text-violet-300',
    2: 'border-sky-500/45 from-sky-500/25 to-blue-500/20 text-sky-600 dark:text-sky-300',
    1: 'border-emerald-500/45 from-emerald-500/25 to-teal-500/20 text-emerald-600 dark:text-emerald-300'
};

/**
 * 没有评级：中性白，安静但不隐藏。
 *
 * 白是这套秩序的最后一位，但**和四档不连续**——它是「不在档内」。所以这里
 * 刻意不带任何色相（`slate` 只提供明度差），让它读起来像一个空缺，而不是
 * 「比绿还弱的一档」。
 */
const UNKNOWN_STYLE =
    'border-border from-slate-400/20 to-slate-500/15 text-muted-foreground';

/**
 * 群组详情左栏的「星遇同频社团」卡片。
 *
 * ## 为什么在左栏、为什么不塞进概览卡
 *
 * 和世界详情左边的 `WorldVrccRating` 一个道理：这一块是**另一家平台的数据**，
 * 塞进概览卡片内部就会和成员数、可见性、链接挤成一片，读不出「这是星遇同频
 * 的社团」。所以它和 `GroupDialogHeaderSection` 平级，自己一个容器。
 *
 * ## 一张窄卡：图标 + 标题 + 评级，然后是社团自己的话
 *
 * **不放横幅、不重复群组名。** 这条卡只有 19rem 宽，横幅按 6:1 铺满也只
 * 换到「社团长什么样」这一点边际信息，而群组自己的头图就在它正上方；群组名
 * 同理，正上方已经写着一遍。省下来的空间留给**社团自己填的内容**：一句话、
 * 标签、人数。
 *
 * ## 评级只给徽章，不解释
 *
 * 徽章旁边就是名字，强弱看颜色就够，**不在下面补一行说明文字**。补一行
 * 「群组成员满 100 人」只会让一张本来就小的卡多出一截文字，反而更不像卡。
 *
 * ## 三种状态
 *
 * - **缺短码 / 404（绝大多数群组）** → 整块不渲染。没入驻、审核中、下架、
 *   只给成员看、不展示，服务器回的都是同一个 404，**看不出是哪一种**，所以
 *   不给结论、不留占位。
 * - **请求失败** → 也不渲染。把网络问题渲染成「这个群组没有社团」是错的。
 * - **200** → 渲染卡片
 *
 * ## 数据是公开的
 *
 * `GET /clubs/{code}` 不需要令牌、不占个人额度，**没连星遇同频也看得到**。
 */
export function GroupVrccClub({
    group
}: {
    group: { shortCode?: string | null; discriminator?: string | null };
}) {
    const { t } = useTranslation();
    const code = clubCodeForGroup(group);
    const query = useQuery({
        ...vrccPublicClubQueryOptions(code),
        enabled: Boolean(code)
    });

    // 令牌里有没有 `clubs`（点赞数、关注状态只有带令牌那条给）。
    // **必须在提前 return 之前调用**：写在后面会让 Hook 顺序随渲染路径变化。
    const scopeQuery = useQuery({
        queryKey: queryKeys.vrccScope('clubs'),
        queryFn: () => fetchVrccScopeGrants('clubs'),
        staleTime: 60 * 1000,
        retry: 0,
        refetchOnWindowFocus: false
    });

    const detailQuery = useQuery({
        queryKey: ['group', 'vrcc-club-detail', code] as const,
        queryFn: async () => {
            const { commands } = await import('@/platform/tauri/bindings');
            return commands.appVrccMyClub(code);
        },
        // 公开页已经答 404（没入驻）时没必要再问带令牌的。
        enabled:
            Boolean(code) &&
            scopeQuery.data === true &&
            Boolean(query.data?.club),
        staleTime: 60_000,
        gcTime: 5 * 60_000,
        retry: 0
    });

    if (!code || !query.data) {
        return null;
    }

    const club = query.data.club;
    if (!club) {
        return null;
    }

    const name = club.name?.trim() || code;
    const grade =
        typeof club.grade === 'number' && club.grade >= 1 && club.grade <= 4
            ? club.grade
            : null;
    // `gradeName` 用服务器原文；拿不到就退回本地文案，两者都是官方叫法。
    const gradeLabel =
        grade === null
            ? t('dialog.group.vrcc.grade_unknown')
            : club.gradeName?.trim() || t(`dialog.group.vrcc.grade_${grade}`);
    const gradeStyle = grade === null ? UNKNOWN_STYLE : GRADE_STYLES[grade];
    // 每档一句自己的说明（官方口径）。兜底和标签同一套键，永远拿得到。
    const gradeHint = t(
        grade === null
            ? 'dialog.group.vrcc.grade_hint_unknown'
            : `dialog.group.vrcc.grade_hint_${grade}`
    );

    const lede = club.lede?.trim() || '';
    const here = typeof club.here === 'number' ? club.here : 0;
    const tags = Array.isArray(club.tags) ? club.tags.filter(Boolean) : [];
    // 点赞数与关注状态只有 `/me/clubs/{code}` 给。
    //
    // **关注是三态，不是布尔**：`true` 已关注、`false` 明确未关注、`null`
    // 根本拿不到（没连接 / 没 `clubs` 权限 / 请求失败）。把 `null` 当成
    // 「未关注」是在编造信息——所以那种情况整格不显示。
    const detail = detailQuery.data?.club;
    const likes = typeof detail?.likes === 'number' ? detail.likes : null;
    const followed =
        typeof detail?.followed === 'boolean' ? detail.followed : null;
    // 没图标时退回首字（只给成员看的社团没有图）。
    const initial = Array.from(name)[0] ?? '?';

    return (
        <div
            data-tour="group-vrcc-club-card"
            className="bg-card mt-3 min-w-0 rounded-lg border p-3"
        >
            {/* 只有图标、标题、评级——**不放横幅，也不重复群组名**。
                横幅在 19rem 的左栏里只有 6:1 的一条，占掉的是整张卡最宝贵的
                顶部空间，换来的边际价值只是「这个社团长什么样」；而群组自己的
                头图就在它正上方，两块图贴在一起会互相削弱。
                群组名同理：这张卡就贴在群组详情左栏里，名字和短码正上方已经写
                着一遍，再写一遍是纯粹的重复。留着的是一句话和标签——那才是
                社团自己填的新信息。 */}

            {/* 标题独占一行。
                「星遇同频社团」是这一块的归属说明，一行就能站住；把它和评级
                挤在一行时，它要左侧截断、评级要右侧完整，两边抢宽度。 */}
            <div className="text-muted-foreground min-w-0 truncate text-[10px] font-medium tracking-wide uppercase">
                {t('dialog.group.vrcc.club')}
            </div>

            {/* 图标 + 评级同行：图标贴左，评级贴右。
                这两个都是「这张卡是谁」的视觉标识，放一起读起来是一组；
                评级单独占一行会显得它比图标更重要，而实际上它只是图标旁边
                的一个属性。
                **没有图标时退回首字**（只给成员看的社团没有图），不留空位。 */}
            <div className="mt-1.5 flex min-w-0 items-center justify-between gap-2">
                {club.icon ? (
                    <img
                        alt=""
                        aria-hidden
                        className="border-border/50 size-8 shrink-0 rounded-md border object-cover"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        src={club.icon}
                    />
                ) : (
                    <div className="border-border/50 bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-md border text-sm font-medium">
                        {initial}
                    </div>
                )}
                {/* 评级徽章：名字是官方的，强弱靠颜色。悬停补一句它到底按什么
                    评的——「北极星」四个字本身不解释任何东西。徽章不是按钮，
                    所以 trigger 用 `render` 挂一个普通 `span`。 */}
                <Tooltip>
                    <TooltipTrigger
                        render={
                            <span
                                className={`inline-flex shrink-0 cursor-help items-center gap-1 rounded-full border bg-gradient-to-r px-2 py-0.5 text-[11px] font-medium ${gradeStyle}`}
                            >
                                <SparklesIcon className="size-3.5" />
                                {gradeLabel}
                            </span>
                        }
                    />
                    <TooltipContent side="left">{gradeHint}</TooltipContent>
                </Tooltip>
            </div>

            {/* 一句话在**图标下边**，铺满整个宽度。
                和图标并排时正文只剩 15 个字符的宽度，两行根本放不下内容，
                只会变成一列竖着的碎字。 */}
            {lede ? (
                <div className="text-muted-foreground mt-2 line-clamp-2 min-w-0 text-[11px] leading-snug break-words">
                    {lede}
                </div>
            ) : null}
            {/* 标签放大一档：它们原本和一句话同色同字号，读起来像正文的一部分，
                但它们是**分类**，扫读时才需要。`text-[11px]` + 更实的底色。 */}
            {tags.length ? (
                <div className="mt-2 flex flex-wrap gap-1">
                    {tags.slice(0, 4).map((tag) => (
                        <span
                            key={tag}
                            className="bg-muted text-foreground/80 max-w-full truncate rounded px-2 py-0.5 text-[11px]"
                        >
                            {tag}
                        </span>
                    ))}
                </div>
            ) : null}
            {/* 关注贴左、点赞贴右，同一行；挂星数在下一行右对齐，
                和上面的评级徽章、点赞数连成右边缘一条线。
                三项都是**只读**——接口侧没有任何社团写入口，点了也发不出去。 */}
            {followed !== null || likes !== null ? (
                <div className="mt-2 flex min-w-0 items-center justify-between gap-2 text-[11px] tabular-nums">
                    {followed === true ? (
                        <span className="text-muted-foreground inline-flex items-center gap-1">
                            <UserCheckIcon className="size-3" />
                            {t('dialog.group.vrcc.followed')}
                        </span>
                    ) : followed === false ? (
                        <span className="text-muted-foreground/70 inline-flex items-center gap-1">
                            <CircleIcon className="size-3" />
                            {t('dialog.group.vrcc.not_followed')}
                        </span>
                    ) : (
                        <span />
                    )}
                    {likes !== null ? (
                        <span className="inline-flex items-center gap-1">
                            {t('dialog.group.vrcc.likes', { count: likes })}
                            <ThumbsUpIcon className="text-muted-foreground size-3" />
                        </span>
                    ) : null}
                </div>
            ) : null}
            {here > 0 ? (
                <div className="text-foreground mt-1 flex items-center justify-end gap-1 text-[11px] tabular-nums">
                    {t('dialog.group.vrcc.here', { count: here })}
                    <SparklesIcon className="text-muted-foreground size-3" />
                </div>
            ) : null}
            <div className="border-border/60 mt-2 flex min-w-0 items-center justify-between gap-2 border-t pt-1.5">
                <span className="text-muted-foreground/70 min-w-0 flex-1 truncate text-[10px] leading-tight">
                    {t('dialog.group.vrcc.source')}
                </span>
                {club.page ? (
                    <button
                        type="button"
                        className="text-primary hover:text-primary/80 inline-flex shrink-0 items-center gap-0.5 text-[10px] font-medium"
                        onClick={() => {
                            if (club.page) {
                                void openExternalLink(club.page);
                            }
                        }}
                    >
                        {t('dialog.group.vrcc.open_page')}
                        <ExternalLinkIcon className="size-2.5" />
                    </button>
                ) : null}
            </div>
        </div>
    );
}
