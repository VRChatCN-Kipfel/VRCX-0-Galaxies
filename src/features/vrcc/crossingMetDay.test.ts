import { describe, expect, it } from 'vitest';

import { crossingMetDay } from './crossingMetDay';

/** 2026-10-25 12:00 +08:00 —— 服务端 `met.at` 的取整锚点。 */
const MET_AT = 1_792_900_800_000;

/** 北京时间某一天的中午。 */
function beijingNoon(year: number, month: number, day: number): number {
    return Date.UTC(year, month - 1, day, 4, 0, 0);
}

describe('crossingMetDay', () => {
    it('当天就是今天', () => {
        expect(
            crossingMetDay(MET_AT, beijingNoon(2026, 10, 25) + 60_000)
        ).toEqual({ kind: 'today' });
    });

    it('隔一天是昨天', () => {
        expect(crossingMetDay(MET_AT, beijingNoon(2026, 10, 26))).toEqual({
            kind: 'yesterday'
        });
    });

    it('再往前就给日期', () => {
        expect(crossingMetDay(MET_AT, beijingNoon(2026, 10, 28))).toEqual({
            kind: 'date',
            date: '2026-10-25'
        });
    });

    /**
     * 取整锚点是中午 12 点，所以「当天上午」看它仍在未来。
     * 用相对时间会算出「2 小时后」；按天算必须是今天。
     */
    it('当天上午看也不算出未来时间', () => {
        const morning = beijingNoon(2026, 10, 25) - 6 * 60 * 60 * 1000;
        expect(crossingMetDay(MET_AT, morning)).toEqual({ kind: 'today' });
    });

    /** 当天下午看同理：不能说成「3 小时前」的精确时刻。 */
    it('当天下午看仍然是今天', () => {
        const afternoon = beijingNoon(2026, 10, 25) + 3 * 60 * 60 * 1000;
        expect(crossingMetDay(MET_AT, afternoon)).toEqual({ kind: 'today' });
    });

    /** 按北京时间切日界，不受本机时区影响。 */
    it('北京时间刚过零点就算新的一天', () => {
        const justAfterMidnight =
            beijingNoon(2026, 10, 26) - 12 * 60 * 60 * 1000 + 60_000;
        expect(crossingMetDay(MET_AT, justAfterMidnight)).toEqual({
            kind: 'yesterday'
        });
    });

    it('缺字段或不是数字时不编日期', () => {
        expect(crossingMetDay(null)).toBeNull();
        expect(crossingMetDay(undefined)).toBeNull();
        expect(crossingMetDay(Number.NaN)).toBeNull();
    });
});
