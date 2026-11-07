// SPDX-License-Identifier: MPL-2.0

import type { ComponentPropsWithoutRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

/**
 * 导览气泡文案的 Markdown 渲染。
 *
 * ## 为什么是「同步渲染成 HTML 字符串」
 *
 * driver 用 `title.innerHTML = ...` / `description.innerHTML = ...` 写入气泡，
 * 然后**立即**调用 `onPopoverRender`。这条链路是同步的。
 *
 * 我先试过在 `onPopoverRender` 里 `createRoot().render()` ——**不行**：那是
 * 异步提交，driver 早已写完占位文本、气泡也已经定位；实测结果是气泡里直接
 * 显示出 `**星遇同频**` 这样的原始标记（`**` 肉眼可见），等于没有渲染。
 *
 * `renderToStaticMarkup` 是**同步**的，拿到字符串后由 driver 的 `innerHTML`
 * 一次性写入。没有 root 生命周期要管，没有首帧闪烁，也不必关心气泡重建。
 *
 * ## 用项目已有的那套插件
 *
 * `react-markdown` + `remark-gfm` + `remark-breaks`，与 `ChangelogDialog` /
 * `AssistantMarkdown` 一致。早先我手写过只认加粗/代码/列表的小转换器，
 * 那种方言**不会报错**，只会把不认识的标记原样打印——最难发现的一类缺陷。
 *
 * ## 安全
 *
 * `react-markdown` 默认不开 `rehype-raw`，因此**不解析内联 HTML**：
 * 源文本里的 `<script>` 会被转义成文字，不会成为标签。这也正是我们想要的
 * ——文案来自我们自己的语言文件，不需要允许它注入 HTML。
 */
const components = {
    h1: ({ children }: ComponentPropsWithoutRef<'h1'>) => (
        <p className="text-foreground mt-2 mb-1 text-[0.8rem] font-semibold first:mt-0">
            {children}
        </p>
    ),
    h2: ({ children }: ComponentPropsWithoutRef<'h2'>) => (
        <p className="text-foreground mt-2 mb-1 text-[0.8rem] font-semibold first:mt-0">
            {children}
        </p>
    ),
    h3: ({ children }: ComponentPropsWithoutRef<'h3'>) => (
        <p className="text-foreground mt-2 mb-1 text-xs font-semibold first:mt-0">
            {children}
        </p>
    ),
    p: ({ children }: ComponentPropsWithoutRef<'p'>) => (
        <p className="m-0 [&:not(:first-child)]:mt-1.5">{children}</p>
    ),
    ul: ({ children }: ComponentPropsWithoutRef<'ul'>) => (
        <ul className="my-1 list-disc space-y-0.5 pl-4 first:mt-0 last:mb-0">
            {children}
        </ul>
    ),
    ol: ({ children }: ComponentPropsWithoutRef<'ol'>) => (
        <ol className="my-1 list-decimal space-y-0.5 pl-4 first:mt-0 last:mb-0">
            {children}
        </ol>
    ),
    li: ({ children }: ComponentPropsWithoutRef<'li'>) => (
        <li className="leading-relaxed">{children}</li>
    ),
    strong: ({ children }: ComponentPropsWithoutRef<'strong'>) => (
        <strong className="text-foreground font-semibold">{children}</strong>
    ),
    code: ({ children }: ComponentPropsWithoutRef<'code'>) => (
        <code className="bg-muted rounded px-1 py-0.5 font-mono text-[0.95em]">
            {children}
        </code>
    ),
    blockquote: ({ children }: ComponentPropsWithoutRef<'blockquote'>) => (
        <blockquote className="border-border my-1.5 border-l-2 pl-2.5">
            {children}
        </blockquote>
    ),
    a: ({ children, href }: ComponentPropsWithoutRef<'a'>) => (
        // 气泡里不放可跳转链接：导览期间把玩家从正在讲的位置带走是反效果。
        // 链接渲染成带下划线的文字，并明确标出地址，需要时自己复制。
        <span className="text-primary underline underline-offset-2">
            {children}
            {href ? <span className="sr-only">({href})</span> : null}
        </span>
    ),
    // 表格在 22rem 的气泡里必然横向溢出，只保证不撑破容器。
    table: ({ children }: ComponentPropsWithoutRef<'table'>) => (
        <div className="my-1 overflow-x-auto">
            <table className="text-[0.7rem]">{children}</table>
        </div>
    )
};

/** 把一段 Markdown 源文同步转成 HTML 字符串，供 `innerHTML` 使用。 */
export function renderTourMarkdown(source: string): string {
    return renderToStaticMarkup(
        <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkBreaks]}
            components={components}
        >
            {source}
        </ReactMarkdown>
    );
}
