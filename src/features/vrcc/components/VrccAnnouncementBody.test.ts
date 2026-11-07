// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';

import { announcementSummary } from './VrccAnnouncementBody';

/**
 * 正文分段（`toBlocks`）是内部函数，这里通过摘要函数间接验证一部分，
 * 结构渲染本身由 `VrccAnnouncementBody` 的 DOM 断言覆盖。
 */
describe('announcementSummary', () => {
    it('把多行压成一行，并去掉栏目名', () => {
        const body = [
            '导语一',
            '导语二',
            '',
            '【地图榜】',
            '· 打分',
            '· 写短评'
        ].join('\n');
        const summary = announcementSummary(body);
        expect(summary).toContain('导语一');
        expect(summary).toContain('导语二');
        // 【】栏目名不进摘要——那是结构标记，不是内容。
        expect(summary).not.toContain('【');
        expect(summary).not.toContain('】');
        // 列表符号也去掉，只留内容。
        expect(summary).toContain('打分');
        expect(summary).not.toContain('·');
    });

    it('超长时截断并加省略号', () => {
        const summary = announcementSummary('あ'.repeat(200), 20);
        expect(summary.length).toBe(21);
        expect(summary.endsWith('…')).toBe(true);
    });

    it('null 与空串得到空串', () => {
        expect(announcementSummary(null)).toBe('');
        expect(announcementSummary('')).toBe('');
        expect(announcementSummary('   \n\n  ')).toBe('');
    });
});
