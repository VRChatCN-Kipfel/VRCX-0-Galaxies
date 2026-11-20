import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    fetchGithubReleases: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appExternalApiGithubReleasesGet: mocks.fetchGithubReleases
    }
}));

import { fetchBranchReleasePage } from './updateService';

function release({ publishedAt }: { publishedAt: string }) {
    return {
        tag_name: 'v2.7.0',
        assets: Array<unknown>(),
        html_url: 'https://github.com/Map1en/VRCX-0/releases/tag/v2.7.0',
        name: 'VRCX-0 2.7.0',
        prerelease: false,
        published_at: publishedAt,
        body: ''
    };
}

describe('updateService branch release fetching', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('fetches and normalizes releases for the stable branch', async () => {
        mocks.fetchGithubReleases.mockResolvedValue({
            status: 200,
            data: [release({ publishedAt: '2026-06-21T07:00:00Z' })]
        });

        const { releases, hasMore } = await fetchBranchReleasePage('stable', 1);

        expect(releases).toHaveLength(1);
        expect(releases[0].canonicalVersion).toBe('2.7.0');
        expect(hasMore).toBe(false);
        expect(mocks.fetchGithubReleases).toHaveBeenCalledWith(
            expect.objectContaining({
                url: 'https://api.github.com/repos/VRChatCN-Kipfel/VRCX-0-Galaxies/releases?per_page=30&page=1'
            })
        );
    });

    it('reports more pages when GitHub returns a full page', async () => {
        mocks.fetchGithubReleases.mockResolvedValue({
            status: 200,
            data: Array.from({ length: 30 }, () =>
                release({ publishedAt: '2026-06-21T07:00:00Z' })
            )
        });

        const { hasMore } = await fetchBranchReleasePage('stable', 2);

        expect(hasMore).toBe(true);
        expect(mocks.fetchGithubReleases).toHaveBeenCalledWith(
            expect.objectContaining({
                url: 'https://api.github.com/repos/VRChatCN-Kipfel/VRCX-0-Galaxies/releases?per_page=30&page=2'
            })
        );
    });

    it('throws when the GitHub release request fails', async () => {
        mocks.fetchGithubReleases.mockResolvedValue({
            status: 500,
            data: []
        });

        await expect(fetchBranchReleasePage('stable', 1)).rejects.toThrow(
            'GitHub release request failed (500).'
        );
    });

    it('surfaces the message GitHub returns instead of the status code', async () => {
        mocks.fetchGithubReleases.mockResolvedValue({
            status: 403,
            data: JSON.stringify({
                message: 'API rate limit exceeded for 203.0.113.7.'
            })
        });

        await expect(fetchBranchReleasePage('stable', 1)).rejects.toThrow(
            'API rate limit exceeded for 203.0.113.7.'
        );
    });

    it('passes a non-JSON failure body through unchanged', async () => {
        mocks.fetchGithubReleases.mockResolvedValue({
            status: 403,
            data: 'blocked by upstream proxy'
        });

        await expect(fetchBranchReleasePage('stable', 1)).rejects.toThrow(
            'blocked by upstream proxy'
        );
    });

    it('keeps the transport error text instead of the command wrapper', async () => {
        mocks.fetchGithubReleases.mockRejectedValue(
            new Error(
                'Tauri command failed: app__external_api_github_releases_get: ' +
                    'error sending request for url (https://api.github.com/...): connection refused'
            )
        );

        const error = (await fetchBranchReleasePage('stable', 1).catch(
            (reason: Error) => reason
        )) as Error;

        expect(error.message).toContain('error sending request for url');
        expect(error.message).not.toContain('Tauri command failed');
    });

    it('keeps only matching GitHub prereleases in the beta branch', async () => {
        mocks.fetchGithubReleases.mockResolvedValue({
            status: 200,
            data: [
                release({ publishedAt: '2026-06-21T07:00:00Z' }),
                {
                    ...release({ publishedAt: '2026-06-22T07:00:00Z' }),
                    tag_name: 'v2.8.0-beta.2',
                    prerelease: true
                }
            ]
        });

        const { releases } = await fetchBranchReleasePage('beta', 1);

        expect(releases.map((item) => item.canonicalVersion)).toEqual([
            '2.8.0-beta.2'
        ]);
    });
});
