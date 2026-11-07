// SPDX-License-Identifier: MPL-2.0

import { create } from 'zustand';

import type { VrccGuidanceState } from '@/platform/tauri/bindings';

/**
 * 首连引导的运行时状态。
 *
 * 三件事放在一起，因为它们说的都是「这张卡现在该不该出现」：
 *
 * - `guidance`：玩家表态到哪一步。**存在后端、按 VRChat 账号隔离**，这里只是
 *   一份缓存的副本；`null` 表示还没从后端读到，此时任何自动弹出都必须等。
 * - `credential`：这个账号的凭据状态（`never` 才该自动弹）。
 * - `manualOpen`：「我的」页主动点开。它**不受上面两个条件限制**——玩家想看
 *   就该能看，哪怕早就表过态。
 */
type VrccFirstRunStore = {
    guidance: VrccGuidanceState | null;
    credential: string | null;
    manualOpen: boolean;
    /** 后端读回来的结论；只用于覆盖缓存，不在这里写盘。 */
    setLoaded(credential: string | null, guidance: VrccGuidanceState): void;
    setGuidance(guidance: VrccGuidanceState): void;
    openManually(): void;
    closeManual(): void;
    /** 退登时清空：换账号不能继承上一个人的表态。 */
    reset(): void;
};

export const useVrccFirstRunStore = create<VrccFirstRunStore>((set) => ({
    guidance: null,
    credential: null,
    manualOpen: false,
    setLoaded: (credential, guidance) => set({ credential, guidance }),
    setGuidance: (guidance) => set({ guidance }),
    openManually: () => set({ manualOpen: true }),
    closeManual: () => set({ manualOpen: false }),
    reset: () => set({ guidance: null, credential: null, manualOpen: false })
}));
