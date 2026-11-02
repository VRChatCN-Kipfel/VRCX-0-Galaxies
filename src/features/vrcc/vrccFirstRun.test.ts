import { describe, expect, it } from 'vitest';

import { shouldAutoOpenFirstRun } from './vrccFirstRun';

const base = {
    credential: 'never' as string | null,
    guidance: 'unseen' as 'unseen' | 'seen' | 'postponed' | null,
    forceAnnouncementsLoaded: true,
    forceAnnouncementsPending: 0
};

describe('shouldAutoOpenFirstRun', () => {
    it('从没连过、没表过态、没有待处理公告时才自动弹', () => {
        expect(shouldAutoOpenFirstRun(base)).toBe(true);
    });

    it('状态还没读回来时不弹', () => {
        // 宁可晚一帧，也不要对着一个已经在用的账号把入门讲一遍。
        expect(shouldAutoOpenFirstRun({ ...base, credential: null })).toBe(
            false
        );
        expect(shouldAutoOpenFirstRun({ ...base, guidance: null })).toBe(false);
    });

    it('连过的人不弹，不管他是主动断开、失效还是换过客户端', () => {
        for (const credential of [
            'active',
            'disconnected',
            'expired',
            'grantMismatch',
            'scopeMismatch'
        ]) {
            expect(shouldAutoOpenFirstRun({ ...base, credential })).toBe(false);
        }
    });

    it('表过态就不再主动弹', () => {
        expect(shouldAutoOpenFirstRun({ ...base, guidance: 'seen' })).toBe(
            false
        );
        expect(shouldAutoOpenFirstRun({ ...base, guidance: 'postponed' })).toBe(
            false
        );
    });

    it('公告还没拉回来时让路', () => {
        // 拉回来之前 `pending` 恒为 0，只看它会让引导抢在一条还不知道存不存在的
        // 公告前面弹出来。
        expect(
            shouldAutoOpenFirstRun({
                ...base,
                forceAnnouncementsLoaded: false
            })
        ).toBe(false);
    });

    it('有待处理的强制公告时让路', () => {
        expect(
            shouldAutoOpenFirstRun({ ...base, forceAnnouncementsPending: 1 })
        ).toBe(false);
    });
});
