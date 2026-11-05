// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import zh from '@/localization/zh-CN.json';

import { renderTourMarkdown } from './TourMarkdown';

/**
 * 逐条渲染**真实文案**，检查 `**` 有没有漏出来。
 *
 * 比正则审计可靠得多：CommonMark 的 flanking 规则涉及标点、括号、空白一整套
 * 判定，手写正则只会误报。这里直接看渲染结果——如果 HTML 里还留着 `**`，
 * 玩家就会在气泡里看到星号，那就是缺陷。
 */
describe('真实导览文案的渲染结果', () => {
    const tour = (zh as { vrcc: { tour: Record<string, unknown> } }).vrcc.tour;

    const entries: Array<[string, string, string]> = [];
    for (const [key, value] of Object.entries(tour)) {
        if (!value || typeof value !== 'object') continue;
        for (const field of ['title', 'description']) {
            const text = (value as Record<string, unknown>)[field];
            if (typeof text === 'string') entries.push([key, field, text]);
        }
    }

    it('每条文案都不把 `**` 漏到正文里', () => {
        const broken: string[] = [];
        for (const [key, field, text] of entries) {
            if (!text.includes('**')) continue;
            const html = renderTourMarkdown(text);
            if (html.includes('**')) broken.push(`${key}.${field}`);
        }
        expect(broken).toEqual([]);
    });

    it('首步讲平台名的那句确实加粗了', () => {
        const html = renderTourMarkdown(
            (tour.intro as { description: string }).description
        );
        expect(html).toContain('<strong');
        expect(html).not.toContain('**');
    });
});
