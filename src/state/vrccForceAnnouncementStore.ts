// SPDX-License-Identifier: MPL-2.0

import { create } from 'zustand';

/**
 * 「还有几条 `force` 公告没处理完」。
 *
 * 提成共享状态是为了**定优先级**，不是为了省一次渲染：`force` 讲的是停站、
 * 条款变更这类必须知晓的事，首连引导再重要也得排在它后面。两套弹窗各自
 * 挂在全局宿主上，彼此看不见对方的队列，没有这一项就只能靠巧合不撞车。
 *
 * `loaded` 和 `pending` 必须分开：公告要联网才拿到，拉回来之前 `pending`
 * 就是 0，只看它会让引导抢在一条还不知道存不存在的公告前面弹出来。
 */
type VrccForceAnnouncementStore = {
    /** 这个账号的公告已经拉过一次了（哪怕拉失败）。 */
    loaded: boolean;
    /** 队列里还有几条没处理。 */
    pending: number;
    setQueue(loaded: boolean, pending: number): void;
    reset(): void;
};

export const useVrccForceAnnouncementStore = create<VrccForceAnnouncementStore>(
    (set) => ({
        loaded: false,
        pending: 0,
        setQueue: (loaded, pending) => set({ loaded, pending }),
        reset: () => set({ loaded: false, pending: 0 })
    })
);
