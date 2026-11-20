import { commands } from '@/platform/tauri/bindings';
import { isPreviewBuildLabel } from '@/shared/buildLabel';
import { GITHUB_RELEASES_URL } from '@/shared/constants/settings';
import type { ReleaseChannel } from '@/shared/utils/releaseVersion';

import { normalizeReleaseList } from './release';
import type { NormalizedRelease } from './types';

type PreviewStableReleaseUpdateMode = {
    enabled: boolean;
};

export function getPreviewStableReleaseUpdateMode(): PreviewStableReleaseUpdateMode {
    return {
        enabled: isPreviewBuildLabel()
    };
}

const GITHUB_RELEASES_PER_PAGE = 30;

type BranchReleasePage = {
    releases: NormalizedRelease[];
    hasMore: boolean;
};

/**
 * 拒绝或失败时 GitHub 会把原因写在体的 `message` 里（限流的原文里带着出口 IP，
 * 代理自己拦下的请求则常常一点体都没有）。原文比「request failed (403)」有用得多，
 * 所以先取 `message`，取不到才退回状态码。
 */
function failureMessage(status: number, data: unknown): string {
    const body = typeof data === 'string' ? data.trim() : '';
    if (!body) {
        return `GitHub release request failed (${status}).`;
    }
    try {
        const message = (JSON.parse(body) as { message?: unknown } | null)
            ?.message;
        if (typeof message === 'string' && message.trim()) {
            return message.trim();
        }
    } catch {
        // 不是 JSON：原样给出去，比编一句话强。
    }
    return body;
}

/**
 * `normalizePlatformError` 会把命令名垫在错误前面（`Tauri command failed: <命令>: `），
 * 那是给日志看的；展示层要的是底下那句话。剥掉这一层，传输失败的原文才留得住。
 * 剥完什么都不剩（错误本来就没带消息）时，把原串还回去，让上层按通用文案处理。
 */
function unwrapCommandError(error: unknown): string {
    const text = error instanceof Error ? error.message : String(error ?? '');
    const unwrapped = text.replace(/^Tauri command failed: \S+: /, '').trim();
    return unwrapped || text.trim();
}

async function requestReleasePage(url: string) {
    try {
        return await commands.appExternalApiGithubReleasesGet({
            url,
            headers: {
                Accept: 'application/vnd.github+json'
            }
        });
    } catch (error) {
        throw new Error(unwrapCommandError(error));
    }
}

export async function fetchBranchReleasePage(
    channel: ReleaseChannel,
    page: number
): Promise<BranchReleasePage> {
    const response = await requestReleasePage(
        `${GITHUB_RELEASES_URL}?per_page=${GITHUB_RELEASES_PER_PAGE}&page=${page}`
    );
    if (response.status && response.status !== 200) {
        throw new Error(failureMessage(response.status, response.data));
    }

    const data =
        typeof response.data === 'string'
            ? JSON.parse(response.data)
            : response.data;
    if (data?.message) {
        throw new Error(data.message);
    }

    return {
        releases: normalizeReleaseList(channel, data),
        hasMore: Array.isArray(data) && data.length >= GITHUB_RELEASES_PER_PAGE
    };
}
