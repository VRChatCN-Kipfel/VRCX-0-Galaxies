import { create } from 'zustand';

/**
 * 导览期间的演示数据。
 *
 * ## 为什么需要
 *
 * 首次引导只对**从没连过**的玩家自动弹（`credential === 'never'`），而这些人
 * 没有任何真实数据：红点区因为 `unread` 为 null 整块不渲染。于是「四处红点」
 * 那一步高亮的是一块空白，文案却在讲「这四个数字」——玩家被要求理解不存在
 * 的东西。
 *
 * 与其把这一步藏掉（那等于承认教学讲不了），不如**在导览期间给它一份看起来
 * 像真的数据**：数字是编的，但界面结构、可点位置、点开会去哪，全是真的。
 *
 * ## 边界
 *
 * - 只在 `active` 为真时生效，导览结束立刻失效，不会污染真实界面；
 * - **不写入任何持久化**：这是展示用的，不是「这个账号有 5 条未读」；
 * - 真实数据存在时优先用真实数据——已经连上的玩家看到的是自己的红点。
 */
type VrccTourDemoState = {
    /** 导览是否在跑。 */
    active: boolean;
    setActive: (active: boolean) => void;
};

export const useVrccTourDemoStore = create<VrccTourDemoState>((set) => ({
    active: false,
    setActive: (active) =>
        set((state) => (state.active === active ? state : { active }))
}));

/**
 * 导览展示用的红点值。
 *
 * 四个都给了非零数，并且**故意不一致**：两个个位数、一个两位数、一个很小，
 * 这样玩家一眼能看出「这里是计数」，而不是以为是个固定标签。
 */
export const VRCC_TOUR_DEMO_UNREAD = {
    inbox: 3,
    cross: 1,
    chats: 7,
    notes: 2
} as const;
