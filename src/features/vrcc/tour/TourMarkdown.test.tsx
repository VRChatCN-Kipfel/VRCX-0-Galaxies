// SPDX-License-Identifier: MPL-2.0

// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { renderTourMarkdown } from './TourMarkdown';

/**
 * 气泡文案的 Markdown 渲染。
 *
 * 这里钉的是一个**实际出过的故障**：气泡里直接显示出 `**星遇同频**`，
 * 星号肉眼可见。原因是渲染走了异步 `createRoot().render()`，而 driver 写完
 * `innerHTML` 后立刻定位气泡——异步那一步赶不上，占位文本就留在那儿了。
 *
 * 现在用的是 `renderToStaticMarkup`（同步），所以断言可以用「一次调用就拿到
 * 最终 HTML」这种方式写：只要它变成异步，这些测试就会立刻失败。
 */
describe('renderTourMarkdown', () => {
    it('同步产出最终 HTML：加粗立刻变成 strong', () => {
        const html = renderTourMarkdown('这里是 **星遇同频** 平台');
        expect(html).toContain('<strong');
        expect(html).toContain('星遇同频');
        // 这条是关键：标记不能以原文形式留下。
        expect(html).not.toContain('**');
    });

    it('行内代码转成 code', () => {
        const html = renderTourMarkdown('按 `Esc` 退出');
        expect(html).toContain('<code');
        expect(html).not.toContain('`');
    });

    it('空行分段', () => {
        const html = renderTourMarkdown('第一段\n\n第二段');
        expect((html.match(/<p/g) || []).length).toBeGreaterThanOrEqual(2);
    });

    it('GFM 列表可用', () => {
        const html = renderTourMarkdown('- 甲\n- 乙');
        expect(html).toContain('<ul');
        expect(html).toContain('<li');
    });

    it('不把源文本当 HTML 执行', () => {
        // react-markdown 默认不开 `rehype-raw`，内联 HTML 会被转义。
        // 文案虽然来自我们自己的语言文件，但这条不该依赖「输入可信」。
        const html = renderTourMarkdown('<script>alert(1)</script>');
        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;');
    });

    it('空串不炸', () => {
        expect(renderTourMarkdown('')).toBe('');
    });
});
