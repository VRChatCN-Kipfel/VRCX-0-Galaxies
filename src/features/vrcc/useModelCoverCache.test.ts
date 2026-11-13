// SPDX-License-Identifier: MPL-2.0
// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { hasModelCover, rememberModelCover } from './useModelCoverCache';

/**
 * 封面缓存的小测试。
 *
 * 只测这两个纯函数：`useModelCoverReady` 依赖 `new Image()` 和 `onload`，
 * 在 jsdom 里不会真的触发（没有网络），测它等于测 mock。真正要钉住的是
 * 「同一个 URL 记住之后就不再当成未缓存」——那是这一层的全部作用。
 *
 * 注意不要用 `vi.resetModules()`：那会让每个用例拿到**新的模块实例**，
 * 而模块级的 `Set` 是这一层唯一的状态，重置之后断言就不针对同一份数据了。
 */
describe('useModelCoverCache', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('记住之前是未知，记住之后是已知', () => {
        const url = 'https://booth.pximg.net/test-unknown.jpg';
        expect(hasModelCover(url)).toBe(false);

        rememberModelCover(url);
        expect(hasModelCover(url)).toBe(true);
    });

    it('只对记住的 URL 返回已知，不串号', () => {
        const a = 'https://booth.pximg.net/a.jpg';
        const b = 'https://booth.pximg.net/b.jpg';

        rememberModelCover(a);

        expect(hasModelCover(a)).toBe(true);
        expect(hasModelCover(b)).toBe(false);
    });

    it('塞满之后会清空，不会无限增长', () => {
        // 这是「有上限」这个承诺本身，不是精确的边界算术：
        // 前面的用例也在同一个模块级 Set 里留了条目，所以这里不假设
        // 初始为空，只验证「一直塞下去不会无限增长，且新条目一定进得去」。
        const probe = 'https://booth.pximg.net/overflow-probe.jpg';

        for (let i = 0; i < 2000; i += 1) {
            rememberModelCover(`https://booth.pximg.net/fill-${i}.jpg`);
        }
        rememberModelCover(probe);

        // 新条目一定在；最早的条目一定已经被清掉过。
        expect(hasModelCover(probe)).toBe(true);
        expect(hasModelCover('https://booth.pximg.net/fill-0.jpg')).toBe(false);
    });
});
