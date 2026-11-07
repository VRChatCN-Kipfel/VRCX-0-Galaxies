// SPDX-License-Identifier: MPL-2.0

import type { ReactNode } from 'react';

/**
 * 公告正文的排版。
 *
 * 服务端把正文当纯文本发（`/announcements` 的说明里明确写着「标题和正文是
 * 纯文字，显示时不要当 HTML」），但它自己有一套约定：用 `【】` 起栏目名、
 * `· ` 开头的行是条目、空行分段。这里就按这三条切，别的不动。
 *
 * **故意不引 markdown 解析器**：实测线上两条公告里 `**` `#` `[]()` `<>` 反引号
 * 一个都没有，语法根本不存在；而任何 markdown 渲染器都要走 `innerHTML`，既
 * 违背上面那条「不要当 HTML」，又凭空多一个 XSS 面。
 *
 * 所以这里全程用 React 元素拼，正文始终是文本节点。
 */

type Block =
    | { kind: 'heading'; text: string }
    | { kind: 'list'; items: string[] }
    | { kind: 'blank' }
    | { kind: 'line'; text: string };

/** 把正文切成块。空行只用来断段，不产生视觉元素。 */
function toBlocks(body: string): Block[] {
    const blocks: Block[] = [];
    let bullets: string[] = [];

    const flushBullets = () => {
        if (bullets.length > 0) {
            blocks.push({ kind: 'list', items: bullets });
            bullets = [];
        }
    };

    for (const rawLine of body.split('\n')) {
        const line = rawLine.trimEnd();

        if (line.trim() === '') {
            flushBullets();
            blocks.push({ kind: 'blank' });
            continue;
        }

        if (/^【.+】$/.test(line.trim())) {
            flushBullets();
            blocks.push({ kind: 'heading', text: line.trim() });
            continue;
        }

        if (line.startsWith('· ')) {
            bullets.push(line.slice(2).trim());
            continue;
        }

        flushBullets();
        blocks.push({ kind: 'line', text: line });
    }

    flushBullets();
    return blocks;
}

export function VrccAnnouncementBody({
    body,
    className
}: {
    body: string;
    className?: string;
}) {
    const blocks = toBlocks(body);
    const nodes: ReactNode[] = [];

    blocks.forEach((block, index) => {
        switch (block.kind) {
            case 'heading':
                // 栏目名：加粗、和上面的内容拉开距离（第一块不加）。
                nodes.push(
                    <div
                        key={index}
                        className={
                            index === 0 ? 'font-medium' : 'mt-3 font-medium'
                        }
                    >
                        {block.text}
                    </div>
                );
                break;
            case 'list':
                nodes.push(
                    <ul key={index} className="mt-1 space-y-0.5">
                        {block.items.map((item, itemIndex) => (
                            <li key={itemIndex} className="flex gap-1.5">
                                <span className="shrink-0 select-none">·</span>
                                <span className="min-w-0">{item}</span>
                            </li>
                        ))}
                    </ul>
                );
                break;
            case 'line':
                nodes.push(
                    <div key={index} className="whitespace-pre-line">
                        {block.text}
                    </div>
                );
                break;
            default:
                // blank：视觉间隔交给上面各块自己的 margin，这里不产出元素。
                break;
        }
    });

    return <div className={className}>{nodes}</div>;
}

/** 只取正文的前若干字，用作页顶 tips 的一行摘要。 */
export function announcementSummary(
    body: string | null,
    maxLength = 90
): string {
    if (!body) return '';
    const flat = body
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '' && !/^【.+】$/.test(line))
        .map((line) => (line.startsWith('· ') ? line.slice(2) : line))
        .join(' ');
    if (flat.length <= maxLength) return flat;
    return `${flat.slice(0, maxLength)}…`;
}
