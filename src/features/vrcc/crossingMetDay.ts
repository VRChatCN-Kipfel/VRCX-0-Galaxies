// SPDX-License-Identifier: MPL-2.0

/**
 * 「最近一次星轨相交」是哪一天。
 *
 * 服务端的 `pair.met.at` **只精确到天**：官方 1.15.3 文档写明它是「那一天
 * 北京时间中午 12 点的毫秒时间戳」。所以这一项只能当日历日来讲——用相对
 * 时间会出两种错：当天中午之前看，它会落在未来（显示「2 小时后」）；当天
 * 下午看，又会显示「3 小时前」，看起来精确，其实只是一个取整的锚点。
 *
 * 判断「是哪一天」必须按北京时间（UTC+8）切日界，才能和服务器取整的那一天
 * 对上；玩家本机时区是别的，也不能改变这个判断。
 */

/** 北京时间相对 UTC 的偏移。 */
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

export type CrossingMetDay =
    | { kind: 'today' }
    | { kind: 'yesterday' }
    | { kind: 'date'; date: string };

/** 把毫秒时间戳按北京时间落到「第几天」。 */
function beijingDayIndex(ms: number): number {
    return Math.floor((ms + BEIJING_OFFSET_MS) / DAY_MS);
}

/** 按北京时间给出 `YYYY-MM-DD`。 */
function beijingDateText(ms: number): string {
    const shifted = new Date(ms + BEIJING_OFFSET_MS);
    const year = shifted.getUTCFullYear();
    const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
    const day = String(shifted.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * `met.at` → 今天 / 昨天 / 具体日期。
 *
 * `nowMs` 可注入，测试里钉住时间用。`metAt` 不是有限数字时返回 `null`
 * （调用方据此不渲染这一段，而不是显示一个编出来的日期）。
 */
export function crossingMetDay(
    metAt: number | null | undefined,
    nowMs: number = Date.now()
): CrossingMetDay | null {
    if (typeof metAt !== 'number' || !Number.isFinite(metAt)) {
        return null;
    }
    const diff = beijingDayIndex(nowMs) - beijingDayIndex(metAt);
    if (diff === 0) {
        return { kind: 'today' };
    }
    if (diff === 1) {
        return { kind: 'yesterday' };
    }
    return { kind: 'date', date: beijingDateText(metAt) };
}
