/**
 * 在 GitHub 已经生成好的 Release notes 后面追加两类补充信息：
 *
 * 1. 「相关 issue」：notes 里只列 PR，不列 issue 作者。用 GraphQL 的
 *    closingIssuesReferences 把 PR 声明关闭的 issue 补上。
 * 2. 「详细提交」：notes 是 PR 粒度（一个 PR 一行），但一个 PR 里可能有几十个
 *    提交。从 Full Changelog 的 compare 链接里解析出 tag 区间，拉该区间的提交
 *    列表放进一个折叠块，想看细节的人展开即可，不干扰正文摘要。
 *
 * 为什么是后置追加而不是预先生成：draft 阶段 tag 还不存在，此时调
 * releases/generate-notes 拿不到有效的 tag 区间（实测只返回一行 Full Changelog）。
 * 所以流程是：softprops 先建 release（tag 与 notes 一并就位）→ 这里用 action
 * 输出的 release id 读回 body → 追加 → PATCH 回去。
 *
 * 注意不能用 /releases/tags/{tag} 查询：draft 的 tag 在 GitHub 侧还不可见，那个
 * 端点会直接 404。
 *
 * 这里刻意避免 process.exit()：在 Windows 上它和未收尾的 fetch 句柄一起会触发
 * libuv 断言（UV_HANDLE_CLOSING）。改成设置 exitCode 并让事件循环自然结束。
 */

const token = process.env.GH_TOKEN ?? '';
const repo = process.env.GITHUB_REPOSITORY ?? '';
const releaseId = process.argv[2] ?? '';

/**
 * 证书安装引导，永远排在 notes 最前面。
 *
 * Windows 安装包由组织自建 CA 签名，而系统不预置这条链：不装证书双击安装包会显示
 * 「未知发布者」。所以必须在用户看到下载列表之前先说清楚，否则很容易被当成下到
 * 假包了。
 *
 * 文案只在这里维护。不要直接去 GitHub 页面上改——下一次发布会把 body 整个重生成，
 * 手改的内容会消失。
 */
const CERT_SECTION_MARK = '### 🔐 先装证书';

/** 详细提交段落的识别标记，用来保证重复运行不会叠出第二份。 */
const DETAILS_MARK = '<summary>详细提交';

const CERT_SECTION = [
    '### 🔐 先装证书，再装 VRCX-0-Galaxies',
    '',
    '**[⬇️ 下载证书包.zip](https://github.com/VRChatCN-Kipfel/.github/archive/refs/heads/certificates.zip)** → 解压 → **双击 `setup.bat`**',
    '',
    '> CN-Kipfel 发布的 Windows 安装包由组织自建 CA 签名。Windows 不预置这条证书链，',
    '> 没装证书时双击安装包会显示「**未知发布者**」——不是包有问题，是缺证书。',
    '>',
    '> 脚本只写当前用户，**不需要管理员权限**。安装过程中 Windows 会弹一次确认框，',
    '> 那是系统对「写入受信任根」的保护，点「是」。',
    '>',
    '> 装完签名显示为 `Forked about VRCX-0 short Code Signing`，整条链可验证，并带',
    '> DigiCert 时间戳——证书到期后已发布的旧包依然有效。'
].join('\n');

type FetchInit = Parameters<typeof fetch>[1];

type ReleasePayload = { id: number; body?: string | null };

type ClosingIssue = {
    number: number;
    title: string;
    author?: { login?: string } | null;
};

type PullRequestNode = {
    closingIssuesReferences?: { nodes?: ClosingIssue[] } | null;
};

type GraphQLPayload = {
    data?: { repository?: Record<string, PullRequestNode | undefined> };
};

type CompareCommit = {
    sha: string;
    commit: {
        message: string;
        author?: { name?: string | null } | null;
    };
};

type ComparePayload = {
    commits?: CompareCommit[];
    total_commits?: number;
};

async function api<T>(path: string, init: FetchInit = {}): Promise<T> {
    const res = await fetch(`https://api.github.com${path}`, {
        ...init,
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json',
            ...(init?.headers as Record<string, string> | undefined)
        }
    });
    if (!res.ok) {
        throw new Error(`${path} -> ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as T;
}

/** 从 notes 末尾的 Full Changelog 链接里取出 base tag 与 head（tag 名或 ref）。 */
function parseCompareRange(
    body: string
): { base: string; head: string } | null {
    const match = body.match(/compare\/(.+?)\.\.\.([^\s)]+)/);
    if (!match) {
        return null;
    }
    return { base: match[1], head: match[2] };
}

/** 把 compare 接口返回的提交整理成折叠块里的条目。 */
function renderDetailCommits(commits: CompareCommit[], total: number): string {
    const lines: string[] = [];
    for (const entry of commits) {
        const subject = (entry.commit.message.split('\n')[0] ?? '').trim();
        if (!subject) {
            continue;
        }
        const author = entry.commit.author?.name?.trim() || 'unknown';
        lines.push(`- ${subject} — ${author}`);
    }
    let section = `\n<details>\n<summary>详细提交（${total} 个）</summary>\n\n`;
    section += lines.join('\n');
    section += '\n';
    // compare 接口对超大区间最多只回 250 条，缺的那部分如实说明并指回链接。
    if (total > lines.length) {
        section += `\n接口对超大区间最多返回 250 条，这里列出最新的 ${lines.length} 个；完整列表见上方 Full Changelog 链接。\n`;
    }
    section += '\n</details>\n';
    return section;
}

if (!token || !repo || !releaseId) {
    console.error('usage: append-release-extras.ts <release-id>');
    process.exitCode = 1;
} else {
    const [owner, name] = repo.split('/');

    try {
        // 1) 读回刚创建的 release。
        const release = await api<ReleasePayload>(
            `/repos/${repo}/releases/${releaseId}`
        );
        const body = String(release.body ?? '').trimEnd();
        let next = body;

        // 1.5) 证书安装引导：放在 notes 最前面。
        //
        // Windows 安装包由组织自建 CA 签名，而系统不预置这条链，不装证书双击就会
        // 显示「未知发布者」。这一步必须在用户看到下载列表之前讲清楚，否则很容
        // 易被当成「下到假包了」。文案在这里维护，不要在 GitHub 页面上手改——下一
        // 次发布就会被 generate-notes 覆盖。
        if (!next.includes(CERT_SECTION_MARK)) {
            next = `${CERT_SECTION}\n\n${next}`;
            console.log('certificate preamble: inserted');
        } else {
            console.log('certificate preamble: already present, left as is');
        }

        // 2) 相关 issue：notes 里的变更引用了 PR。GitHub 的格式是
        //    "in https://github.com/o/r/pull/123"，老格式可能写成 "in #123"，两种都收。
        const prNumbers = [
            ...new Set([
                ...[...body.matchAll(/\/pull\/(\d+)/g)].map((match) =>
                    Number(match[1])
                ),
                ...[...body.matchAll(/\bin #(\d+)\b/g)].map((match) =>
                    Number(match[1])
                )
            ])
        ];

        if (prNumbers.length === 0) {
            console.log(
                'no PR references found in release notes; skipping related issues'
            );
        } else {
            const aliases = prNumbers
                .map(
                    (number) => `p${number}: pullRequest(number: ${number}) {
                        closingIssuesReferences(first: 10) {
                            nodes { number title author { login } }
                        }
                    }`
                )
                .join('\n');

            const data = await api<GraphQLPayload>('/graphql', {
                method: 'POST',
                body: JSON.stringify({
                    query: `query { repository(owner: "${owner}", name: "${name}") { ${aliases} } }`
                })
            });

            type RelatedIssue = {
                number: number;
                title: string;
                author: string;
            };
            const related: RelatedIssue[] = [];
            const seen = new Set<number>();

            for (const number of prNumbers) {
                const node = data.data?.repository?.[`p${number}`];
                for (const issue of node?.closingIssuesReferences?.nodes ??
                    []) {
                    if (seen.has(issue.number)) {
                        continue;
                    }
                    seen.add(issue.number);
                    related.push({
                        number: issue.number,
                        title: issue.title,
                        author: issue.author?.login ?? 'unknown'
                    });
                }
            }

            if (related.length === 0) {
                console.log(
                    `scanned ${prNumbers.length} PRs; none had a closing issue reference`
                );
            } else {
                next += `\n\n## 相关 issue\n\n`;
                for (const issue of related) {
                    next += `- [#${issue.number}](https://github.com/${repo}/issues/${issue.number}) ${issue.title}（由 @${issue.author} 提出）\n`;
                }
                console.log(
                    `related issues: ${related.length} from ${prNumbers.length} PRs`
                );
            }
        }

        // 3) 详细提交：从 Full Changelog 的 compare 链接解析区间。
        //
        //    注意 head 不能用 tag 名：draft 阶段 release 的 tag 还没落地成 git ref，
        //    compare/v2.32.0...v2.33.0 会 404。这里优先用本次运行的 commit SHA
        //    （GITHUB_SHA），只有它缺席时才退回 notes 里写的 tag。
        //
        //    幂等：body 里已经有「详细提交」折叠块时直接跳过。否则同一个 draft 被
        //    跑两次（比如本地手动补跑），就会叠出第二份 250 条清单。
        const range = parseCompareRange(body);
        if (body.includes(DETAILS_MARK)) {
            console.log('detailed commits: already present, left as is');
        } else if (!range) {
            console.log(
                'no compare link found in release notes; skipping detailed commits'
            );
        } else {
            const headRef = process.env.GITHUB_SHA?.trim() || range.head;
            const compare = await api<ComparePayload>(
                `/repos/${repo}/compare/${encodeURIComponent(range.base)}...${encodeURIComponent(headRef)}`
            );
            const commits = compare.commits ?? [];
            const total = compare.total_commits ?? commits.length;
            if (commits.length === 0) {
                console.log(
                    `compare ${range.base}...${headRef} returned no commits`
                );
            } else {
                // 折叠块本身就是给「想细看」的人，不再二次裁剪：接口给多少列多少，
                // 只是反转为「新的在前」，和 notes 正文的阅读顺序一致。
                const ordered = [...commits].reverse();
                next += renderDetailCommits(ordered, total);
                console.log(
                    `detailed commits: ${ordered.length}/${total} (${range.base}...${headRef})`
                );
            }
        }

        // 4) 只有真的追加了内容才 PATCH。
        if (next === body) {
            console.log('nothing to append');
        } else {
            await api<unknown>(`/repos/${repo}/releases/${releaseId}`, {
                method: 'PATCH',
                body: JSON.stringify({ body: next })
            });
            console.log('release body patched');
        }
    } catch (error) {
        console.error(error);
        process.exitCode = 1;
    }
}

// 让这个文件成为模块：否则顶层 await 不合法（TS1375），而且 tsconfig 会把它当成
// 全局脚本一起检查。
export {};
