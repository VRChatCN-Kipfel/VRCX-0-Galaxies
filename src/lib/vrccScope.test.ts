import { describe, expect, it } from 'vitest';

import { scopeGrants } from './vrccScope';

describe('scopeGrants', () => {
    it('空格分隔的串里认出一项', () => {
        expect(
            scopeGrants(
                'profile notifications maps mutuals crossings',
                'crossings'
            )
        ).toBe(true);
    });

    it('逗号和 + 也认', () => {
        expect(scopeGrants('profile,notifications,maps', 'maps')).toBe(true);
        expect(scopeGrants('profile+notifications+maps', 'notifications')).toBe(
            true
        );
    });

    it('混合分隔符也认', () => {
        expect(
            scopeGrants('profile, notifications+crossings', 'crossings')
        ).toBe(true);
    });

    it('不包含就是 false', () => {
        expect(scopeGrants('profile notifications maps', 'crossings')).toBe(
            false
        );
    });

    it('前缀相同的别的权限不算命中', () => {
        // `maps` 不该匹配 `maps.rate`，反过来也不行——逐项精确比较。
        expect(scopeGrants('profile maps.rate', 'maps')).toBe(false);
        expect(scopeGrants('profile maps', 'maps.rate')).toBe(false);
    });

    /**
     * `null` / 空串按**没有**处理。
     *
     * 这是故意和契约层的 `scope_grants` 相反的：那边是「该不该替服务器
     * 拦下请求」，不知道就放行；这边是「该不该给玩家看这个入口」，不知道
     * 就不给——多给一个入口会让玩家点下去必然失败。
     */
    it('null 与空串都当作没有这项权限', () => {
        expect(scopeGrants(null, 'crossings')).toBe(false);
        expect(scopeGrants(undefined, 'crossings')).toBe(false);
        expect(scopeGrants('', 'crossings')).toBe(false);
    });

    it('空项不会误命中空权限名', () => {
        expect(scopeGrants('profile  notifications', '')).toBe(false);
    });
});
