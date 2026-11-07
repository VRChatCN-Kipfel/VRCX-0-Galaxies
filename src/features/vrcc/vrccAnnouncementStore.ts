// SPDX-License-Identifier: MPL-2.0

import type { VrccAnnouncement } from './vrccApi';

/**
 * 公告的已读记录。
 *
 * 三种 `level` 的「读过了」语义不一样，存的东西也就不能是同一个游标：
 *
 * - `bar`：页顶一条提示，玩家关掉后**这条和更早的**都不再出现（水位线足够）。
 * - `pop`：信息性公告（新功能、活动），**每条各自弹一次**。用一个水位线会
 *   把编号比它小的公告永久吞掉——站方补发一条旧编号的更正就永远看不到。
 * - `force`：必须知晓的（停站、条款变更），**每条各自确认一次**。
 *
 * 前两种按 id 记集合，`bar` 仍用水位线：`bar` 每来一条就把之前那条挤掉，
 * 用集合存会无限增长。
 */

const BAR_CURSOR_KEY = 'vrcc.announcement.barCursor';
const SEEN_IDS_KEY = 'vrcc.announcement.seenIds';

/** 记多少条 id 就够了：公告不会很多，留一个上限防止 localStorage 无限长。 */
const MAX_SEEN_IDS = 100;

function readNumber(key: string): number | null {
    try {
        const raw = Number(localStorage.getItem(key));
        return Number.isFinite(raw) && raw > 0 ? raw : null;
    } catch {
        return null;
    }
}

function writeNumber(key: string, value: number): void {
    try {
        localStorage.setItem(key, String(value));
    } catch {
        // 存不进去不是致命问题：顶多下次再弹一遍。
    }
}

/** `bar` 的水位线：比它新（编号更大）的才显示。 */
export function readBarCursor(): number | null {
    return readNumber(BAR_CURSOR_KEY);
}

export function writeBarCursor(id: number): void {
    const current = readBarCursor();
    // 只增不减：关掉旧的又回头打开新的，不该把水位线拉回去。
    if (current !== null && current >= id) return;
    writeNumber(BAR_CURSOR_KEY, id);
}

/** `pop` / `force` 的已读 id 集合。 */
export function readSeenIds(): Set<number> {
    try {
        const raw = localStorage.getItem(SEEN_IDS_KEY);
        if (!raw) return new Set();
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return new Set();
        return new Set(
            parsed.filter(
                (value): value is number =>
                    typeof value === 'number' && Number.isFinite(value)
            )
        );
    } catch {
        return new Set();
    }
}

export function markSeenId(id: number): void {
    markSeenIds([id]);
}

/**
 * 一次标记多条已读。
 *
 * 「跳过全部」用它：玩家明确表达了「剩下的不想看了」，看过的照记，没看的
 * 一并标掉，免得下次启动又从头弹一遍。
 */
export function markSeenIds(ids: readonly number[]): void {
    const valid = ids.filter((id) => Number.isFinite(id) && id > 0);
    if (valid.length === 0) return;
    const seen = readSeenIds();
    let changed = false;
    for (const id of valid) {
        if (seen.has(id)) continue;
        seen.add(id);
        changed = true;
    }
    if (!changed) return;
    // 只留最近的若干条：Set 的插入顺序即写入顺序，超了就从头丢。
    const trimmed = [...seen].slice(-MAX_SEEN_IDS);
    try {
        localStorage.setItem(SEEN_IDS_KEY, JSON.stringify(trimmed));
    } catch {
        // 同上：存不进去只是下次再弹一次。
    }
}

export type AnnouncementLevel = 'bar' | 'pop' | 'force';

/**
 * 把服务端的 `level` 归一到我们认识的三种。
 *
 * 不认识的取值一律当 `bar`：那是最不打扰的一种。反过来把未知值当 `force`
 * 会让一条谁都没预料到的公告挡住玩家。
 */
export function normalizeLevel(
    level: string | null | undefined
): AnnouncementLevel {
    if (level === 'force') return 'force';
    if (level === 'pop') return 'pop';
    return 'bar';
}

/**
 * 当前作用域下还没读过的公告，按 id **升序**（旧的在前，最新的最后读）。
 *
 * 顺序是这样定的：id 是服务端的递增编号，也就是发布先后。玩家补看积压的公告
 * 时该按时间线往下读——先看早先发的，最后才轮到最新的那条。倒过来（新的在前）
 * 会让「1/3」那一条永远是最新的，先发的反而要翻到最后。
 *
 * 返回**整个序列**而不是一条：弹窗要能 `‹ 1/3 ›` 前后翻，还要能回看已经翻过
 * 的、以及「跳过全部」一次清掉剩下的。
 *
 * 两个作用域互相独立：
 * - `global` 只收 `force`（须知：停站、条款变更）
 * - `page` 收 `pop` 和 `bar`（需知：新功能、活动），`force` 跳过，免得
 *   同一份内容在页面里又弹一次
 *
 * `bar` 另外受水位线约束：编号不大于游标的都当作看过了。
 */
export function selectPendingAnnouncements(
    posts: readonly VrccAnnouncement[] | null | undefined,
    options: {
        barCursor: number | null;
        seenIds: ReadonlySet<number>;
        scope: 'page' | 'global';
    }
): VrccAnnouncement[] {
    if (!posts || posts.length === 0) return [];

    // 服务端说「新的在前」，但这里不依赖它：自己按 id 升序排（旧的在前）。
    const sorted = [...posts]
        .filter((post) => (post.id ?? 0) > 0)
        .sort((a, b) => (a.id ?? 0) - (b.id ?? 0));

    const result: VrccAnnouncement[] = [];
    for (const post of sorted) {
        const id = post.id ?? 0;
        const level = normalizeLevel(post.level);

        if (options.scope === 'global') {
            if (level !== 'force') continue;
            if (options.seenIds.has(id)) continue;
            result.push(post);
            continue;
        }

        if (level === 'force') continue;
        if (options.seenIds.has(id)) continue;
        if (level === 'bar') {
            const cursor = options.barCursor;
            if (cursor !== null && id <= cursor) continue;
        }
        result.push(post);
    }

    return result;
}

/**
 * 只需要一条时用它（页顶 `bar` 提示这类场景）。
 *
 * 取序列**末尾**那条，也就是最新的一条：页顶提示该说「最新发生了什么」，
 * 而不是「最久之前发生了什么」。
 */
export function selectPendingAnnouncement(
    posts: readonly VrccAnnouncement[] | null | undefined,
    options: {
        barCursor: number | null;
        seenIds: ReadonlySet<number>;
        scope: 'page' | 'global';
    }
): VrccAnnouncement | null {
    const sequence = selectPendingAnnouncements(posts, options);
    return sequence[sequence.length - 1] ?? null;
}
