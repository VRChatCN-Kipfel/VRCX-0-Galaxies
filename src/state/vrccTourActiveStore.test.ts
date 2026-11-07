// SPDX-License-Identifier: MPL-2.0

import { beforeEach, describe, expect, it } from 'vitest';

import { useVrccTourActiveStore } from './vrccTourActiveStore';

/**
 * 导览运行状态的桥接 store。
 *
 * 它存在的唯一理由是**优先级链**：
 * ```
 * force 公告  →  挂起导览
 * 导览        →  挂起 pop 公告
 * ```
 * 同一时刻只让一样东西对玩家说话，是排队而不是压栈。
 *
 * 这里只钉 store 自己的契约（能被订阅、能被置回），
 * 与页面的接线由 `VrccPage` 承担。
 */
describe('useVrccTourActiveStore', () => {
    beforeEach(() => {
        useVrccTourActiveStore.getState().setActive(false);
    });

    it('默认不在导览中', () => {
        expect(useVrccTourActiveStore.getState().active).toBe(false);
    });

    it('能被置为进行中，也能置回', () => {
        useVrccTourActiveStore.getState().setActive(true);
        expect(useVrccTourActiveStore.getState().active).toBe(true);

        useVrccTourActiveStore.getState().setActive(false);
        expect(useVrccTourActiveStore.getState().active).toBe(false);
    });

    it('同一个值不产生新状态（订阅者不会被无谓唤醒）', () => {
        useVrccTourActiveStore.getState().setActive(true);
        const before = useVrccTourActiveStore.getState();

        useVrccTourActiveStore.getState().setActive(true);

        // `set` 里做了相等判断，所以引用不变——否则每一帧都会通知一次订阅者，
        // 页面跟着重渲染。
        expect(useVrccTourActiveStore.getState()).toBe(before);
    });
});
