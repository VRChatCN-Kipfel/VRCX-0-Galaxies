// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';

import { buildPageItems } from './boardPages';

/** 把序列压成好读的字符串，断言里直接比对。 */
function render(current: number, pageCount: number): string {
    return buildPageItems(current, pageCount)
        .map((item) => (item.kind === 'gap' ? '…' : String(item.page)))
        .join(' ');
}

describe('buildPageItems', () => {
    it('页数装得下时全列，不画省略号', () => {
        expect(render(1, 1)).toBe('1');
        expect(render(3, 5)).toBe('1 2 3 4 5');
        expect(render(5, 5)).toBe('1 2 3 4 5');
    });

    it('第 1 页：窗口贴左，右侧接省略号和末页', () => {
        expect(render(1, 10)).toBe('1 2 3 4 5 … 10');
        expect(render(2, 10)).toBe('1 2 3 4 5 … 10');
        expect(render(3, 10)).toBe('1 2 3 4 5 … 10');
    });

    it('中间页：两边都有省略号，当前页居中', () => {
        expect(render(7, 10)).toBe('1 … 5 6 7 8 9 10');
        expect(render(6, 20)).toBe('1 … 4 5 6 7 8 … 20');
    });

    it('靠右：窗口贴右，左侧接省略号', () => {
        expect(render(10, 10)).toBe('1 … 6 7 8 9 10');
        expect(render(9, 10)).toBe('1 … 6 7 8 9 10');
    });

    it('窗口与首末页相邻时不画多余的省略号', () => {
        // start === 2：首页与 2 之间没有跳过任何页。
        expect(render(3, 6)).toBe('1 2 3 4 5 6');
        // 连续段正好接上末页时不画右侧省略号。
        expect(render(4, 6)).toBe('1 2 3 4 5 6');
    });

    it('当前页越界时夹回合法范围，而不是返回空', () => {
        expect(render(0, 10)).toBe('1 2 3 4 5 … 10');
        expect(render(99, 10)).toBe('1 … 6 7 8 9 10');
        expect(render(-3, 10)).toBe('1 2 3 4 5 … 10');
    });

    it('页数为 0 时没有可点的页码', () => {
        expect(buildPageItems(1, 0)).toEqual([]);
        expect(buildPageItems(1, -5)).toEqual([]);
    });

    it('小数页码向下取整，不会画出 2.7 这种格子', () => {
        expect(render(2.7, 10)).toBe('1 2 3 4 5 … 10');
        expect(render(7.9, 10)).toBe('1 … 5 6 7 8 9 10');
    });
});
