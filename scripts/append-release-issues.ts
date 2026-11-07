/**
 * 在 GitHub 已经生成好的 Release notes 后面，追加「相关 issue」段落。
 *
 * 为什么是后置追加而不是预先生成：draft 阶段 tag 还不存在，此时调
 * releases/generate-notes 拿不到有效的 tag 区间（实测只返回一行 Full Changelog）。
 * 所以流程改成：softprops 先建 release（tag 与 notes 一并就位）→ 这里读回 body
 * → 查 PR 关闭的 issue → PATCH 回去。
 */

const token = process.env.GH_TOKEN ?? '';
const repo = process.env.GITHUB_REPOSITORY ?? '';
const tag = process.argv[2] ?? '';

if (!token || !repo || !tag) {
    console.error('usage: append-release-issues.ts <tag>');
    process.exit(1);
}

const [owner, name] = repo.split('/');

type FetchInit = Parameters<typeof fetch>[1];

async function api(path: string, init: FetchInit = {}): Promise<any> {
    const res = await fetch(`https://api.github.com${path}`, {
        ...init,
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json',
            ...((init?.headers as Record<string, string>) ?? {})
        }
    });
    if (!res.ok) {
        throw new Error(`${path} -> ${res.status} ${await res.text()}`);
    }
    return res.json();
}

// 1) 读回刚创建的 release（draft 也能按 tag 查到）。
const release = await api(`/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`);
const body = String(release.body ?? '').trimEnd();
const releaseId = release.id as number;

// 2) notes 里每条变更写成 "by @user in #123"，据此收集 PR 号。
const prNumbers = [
    ...new Set(
        [...body.matchAll(/\bin #(\d+)\b/g)].map((match) => Number(match[1]))
    )
];

if (prNumbers.length === 0) {
    console.log('no PR references found in release notes; nothing to append');
    process.exit(0);
}

// 3) 用 GraphQL 批量查每个 PR 关闭的 issue。
type RelatedIssue = { number: number; title: string; author: string };
const related: RelatedIssue[] = [];
const aliases = prNumbers
    .map(
        (number) => `p${number}: pullRequest(number: ${number}) {
            closingIssuesReferences(first: 10) {
                nodes { number title author { login } }
            }
        }`
    )
    .join('\n');

const data = await api('/graphql', {
    method: 'POST',
    body: JSON.stringify({
        query: `query { repository(owner: "${owner}", name: "${name}") { ${aliases} } }`
    })
});

const seen = new Set<number>();
for (const number of prNumbers) {
    const node = data?.data?.repository?.[`p${number}`];
    for (const issue of node?.closingIssuesReferences?.nodes ?? []) {
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
    process.exit(0);
}

// 4) 追加并 PATCH 回去。
let next = `${body}\n\n## 相关 issue\n\n`;
for (const issue of related) {
    next += `- [#${issue.number}](https://github.com/${repo}/issues/${issue.number}) ${issue.title}（由 @${issue.author} 提出）\n`;
}

await api(`/repos/${repo}/releases/${releaseId}`, {
    method: 'PATCH',
    body: JSON.stringify({ body: next })
});

console.log(
    `appended ${related.length} related issues from ${prNumbers.length} PRs`
);
