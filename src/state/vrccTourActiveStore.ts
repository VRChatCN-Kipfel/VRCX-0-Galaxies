import { create } from 'zustand';

/**
 * 导览是否正在跑。
 *
 * ## 为什么需要一个 store，而不直接用 `isTourActive()`
 *
 * 导览是**命令式**启动的（`startTour()` 直接操作 driver 实例），而 `VrccPage`
 * 是声明式渲染。页面要「导览一开始就把 `pop` 公告挂起」，就必须能**订阅**这个
 * 状态；普通函数调用不会触发重渲染。
 *
 * ## 它解决什么
 *
 * 玩家第一次进星遇同频页时，页面一挂载就会去拉公告，`pop` 那条可能在导览走到
 * 某一步时突然盖上来（实测：第 4/18 步「四个页签」被「加群领见面礼」压住）。
 * 这是**两个东西同时在对玩家说话**。
 *
 * 优先级链是一条队列，不是叠在一起：
 *
 * ```
 * force 公告  →  挂起导览（已有：shouldAutoOpenFirstRun 会等它）
 * 导览        →  挂起 pop 公告（本 store 的用途）
 * ```
 *
 * 后者挂起而不是丢弃：导览结束后 `pop` 照常弹出，玩家不会因此漏看一条公告。
 * 已读状态完全不动——挂起期间不记已读，等它真的展示过才算。
 */
type VrccTourActiveState = {
    active: boolean;
    setActive: (active: boolean) => void;
};

export const useVrccTourActiveStore = create<VrccTourActiveState>((set) => ({
    active: false,
    setActive: (active) =>
        set((state) => (state.active === active ? state : { active }))
}));
