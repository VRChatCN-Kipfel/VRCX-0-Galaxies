// SPDX-License-Identifier: MPL-2.0

// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { renderTourMarkdown } from './TourMarkdown';

/**
 * 中文字符紧贴 `**` 时，CommonMark 的强调定界符判定会失败。
 *
 * 这条是实测出来的，不是理论：文案里写
 *     社区的**「星遇同频」**平台
 * 渲染出来 `**` 原样可见。原因是 CommonMark 要求强调定界符的左/右侧
 * 修饰条件——`**` 左边紧邻中文字符、右边紧邻「”，两侧都不被判定为
 * 「可以开启/关闭强调」，于是退化成字面量。
 *
 * 解法很简单：**在 `**` 内外各留一个空格**。下面把这几种情况都钉住，
 * 免得以后又有人把空格删掉。
 */
describe('中文与加粗标记的边界', () => {
    it('`**` 紧贴中文字符时不会加粗（这是要避免的写法）', () => {
        const html = renderTourMarkdown('社区的**「星遇同频」**平台');
        // 钉住失败行为本身：如果哪天解析器变了，这条会提醒我们重新确认。
        expect(html).not.toContain('<strong');
    });

    it('`**` 内外留空格才真正加粗（正确写法）', () => {
        const html = renderTourMarkdown('社区的 **「星遇同频」** 平台');
        expect(html).toContain('<strong');
        expect(html).not.toContain('**');
    });

    it('行首/行尾的加粗也能生效', () => {
        const html = renderTourMarkdown('**星遇同频**是社区平台');
        // 行首：左边是行首，属于合法的「可开启」位置。
        expect(html).toContain('<strong');
    });
});
