import type { VrccGuidanceState } from '@/platform/tauri/bindings';

/** 首连引导要不要**自动**弹。 */
export function shouldAutoOpenFirstRun(input: {
    credential: string | null;
    guidance: VrccGuidanceState | null;
    forceAnnouncementsLoaded: boolean;
    forceAnnouncementsPending: number;
}): boolean {
    // 还没从后端读到结论：等。宁可晚一帧，也不要对着一个已经在用的账号
    // 把入门讲一遍。
    if (input.credential === null || input.guidance === null) return false;

    // 只有「这个账号从没连过」才自动弹。连过又断开的（`disconnected` /
    // `expired` / `grantMismatch`）知道星遇同频是什么，该说的是「重新连接」，
    // 那句在「我的」页里。
    if (input.credential !== 'never') return false;

    // 表过态就不再主动弹，只留常驻入口。
    if (input.guidance !== 'unseen') return false;

    // `force` 公告排在前面：停站、条款变更这类必须知晓的事比引导重要。
    // 公告还没拉回来时**不能当作没有**——否则引导会先弹，随后公告再弹一遍，
    // 玩家在启动阶段连吃两个弹窗。
    if (!input.forceAnnouncementsLoaded) return false;
    return input.forceAnnouncementsPending === 0;
}
