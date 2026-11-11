// SPDX-License-Identifier: MPL-2.0

/**
 * 页码序列：给分页器算出「显示哪些页码、哪几处该画省略号」。
 *
 * 抽成纯函数是为了可测——省略号的边界条件有四种（贴左、居中、贴右、
 * 总页数本身就很少），塞进组件里只能靠渲染结果反推。
 *
 * 窗口规则：**永远显示 `WINDOW` 个连续页码**，靠近两端时整段平移，
 * 不缩短。所以第 1 页看到的是 `1 2 3 4 5 … n`，第 7 页看到的是
 * `1 … 5 6 7 8 9 … n`，和网页端一致。
 */

/** 连续页码的个数。改成其它值时下面所有边界判断都要跟着改。 */
const WINDOW = 5;

export type PageItem =
    | { kind: 'page'; page: number }
    | { kind: 'gap'; key: 'left' | 'right' };

/**
 * 算出要显示的页码序列。
 *
 * `current` 越界时会被夹到 `1..pageCount`，而不是返回空数组——分页器
 * 在「数据变少导致当前页失效」时仍然要画出东西，让玩家能点回第 1 页。
 */
export function buildPageItems(current: number, pageCount: number): PageItem[] {
    if (pageCount <= 0) {
        return [];
    }
    const count = Math.floor(pageCount);
    const active = Math.min(Math.max(Math.floor(current), 1), count);

    // 页数装得下就全列，不画省略号。
    if (count <= WINDOW) {
        return Array.from({ length: count }, (_, index) => ({
            kind: 'page' as const,
            page: index + 1
        }));
    }

    // 连续段贴哪一边：靠左固定 1，靠右固定 count - WINDOW + 1，中间居中。
    const start = Math.min(
        Math.max(active - Math.floor(WINDOW / 2), 1),
        count - WINDOW + 1
    );
    const end = start + WINDOW - 1;

    const items: PageItem[] = [];
    if (start > 1) {
        items.push({ kind: 'page', page: 1 });
        // 只在首页与连续段之间确实有空位时才画省略号；start === 2 时
        // 中间没有任何被跳过的页码，画上去反而多占一格。
        if (start > 2) {
            items.push({ kind: 'gap', key: 'left' });
        }
    }
    for (let page = start; page <= end; page += 1) {
        items.push({ kind: 'page', page });
    }
    if (end < count) {
        if (end < count - 1) {
            items.push({ kind: 'gap', key: 'right' });
        }
        items.push({ kind: 'page', page: count });
    }
    return items;
}
