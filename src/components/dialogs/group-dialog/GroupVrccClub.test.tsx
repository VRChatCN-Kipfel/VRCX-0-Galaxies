// SPDX-License-Identifier: MPL-2.0
// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    clubCodeForGroup,
    isClubCodeShaped
} from '@/repositories/vrccClubRepository';

import { GroupVrccClub } from './GroupVrccClub';

const mocks = vi.hoisted(() => ({
    appVrccClub: vi.fn(),
    appVrccConnection: vi.fn(),
    appVrccMyClub: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appVrccClub: mocks.appVrccClub,
        appVrccConnection: mocks.appVrccConnection,
        appVrccMyClub: mocks.appVrccMyClub
    }
}));

vi.mock('@/services/shellIntegrationService', () => ({
    openExternalLink: vi.fn()
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: { count?: number }) =>
            options?.count === undefined ? key : `${key}:${options.count}`
    })
}));

function renderWithQuery(ui: ReactElement) {
    const client = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } }
    });
    return render(
        <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    );
}

/** 一份和实测 `GET /clubs/KIPFEL.2104` 一样形状的回答。 */
const clubResponse = {
    club: {
        code: 'KIPFEL.2104',
        name: '中文kipfel厅',
        lede: '喜欢/使用猫猫模？想要一个风气干净友好的大环境？来我们这喵！',
        tags: ['聊天', '新人友好'],
        members: 6871,
        here: 13,
        grade: 4,
        gradeName: '北极星',
        icon: 'https://vrcc.cc/c/KIPFEL.2104.icon.jpg',
        page: 'https://vrcc.cc/c/KIPFEL.2104'
    }
};

describe('clubCodeForGroup', () => {
    it('拼的就是 shortCode.discriminator', () => {
        expect(
            clubCodeForGroup({ shortCode: 'KIPFEL', discriminator: '2104' })
        ).toBe('KIPFEL.2104');
    });

    it('缺任何一个都返回空串，不拼出半截短码', () => {
        expect(clubCodeForGroup({ shortCode: 'KIPFEL' })).toBe('');
        expect(clubCodeForGroup({ discriminator: '2104' })).toBe('');
        expect(clubCodeForGroup({ shortCode: '', discriminator: '2104' })).toBe(
            ''
        );
        expect(clubCodeForGroup({})).toBe('');
    });

    it('短码形状与官方 pattern 一致', () => {
        expect(isClubCodeShaped('KIPFEL.2104')).toBe(true);
        expect(isClubCodeShaped('kipfel.2104')).toBe(true);
        expect(isClubCodeShaped('520.6088')).toBe(true);
        expect(isClubCodeShaped('KIPFEL.')).toBe(false);
        expect(isClubCodeShaped('KIPFEL')).toBe(false);
        expect(isClubCodeShaped('KIPFEL.21045')).toBe(false);
    });
});

describe('GroupVrccClub', () => {
    afterEach(cleanup);

    beforeEach(() => {
        vi.clearAllMocks();
        // 默认：已连接、令牌有 `clubs`，带令牌那条能拿到点赞与关注。
        mocks.appVrccConnection.mockResolvedValue({
            scope: 'profile maps clubs'
        });
        mocks.appVrccMyClub.mockResolvedValue({
            club: { likes: 6, followed: true }
        });
    });

    it('把社团渲染成左栏一块卡片', async () => {
        mocks.appVrccClub.mockResolvedValue(clubResponse);

        renderWithQuery(
            <GroupVrccClub
                group={{ shortCode: 'KIPFEL', discriminator: '2104' }}
            />
        );

        // **不渲染群组名**：它就贴在群组详情左栏，正上方已经写着一遍。
        expect(await screen.findByText('dialog.group.vrcc.club')).toBeTruthy();
        expect(screen.queryByText('中文kipfel厅')).toBeNull();
        // 评级、一句话、挂着几颗星、标签、来源声明都在。
        expect(screen.getByText('北极星')).toBeTruthy();
        expect(screen.getByText(clubResponse.club.lede)).toBeTruthy();
        expect(screen.getByText('dialog.group.vrcc.here:13')).toBeTruthy();
        expect(screen.getByText('聊天')).toBeTruthy();
        expect(screen.getByText('dialog.group.vrcc.source')).toBeTruthy();
        // 点赞与关注：只读展示，数据来自带令牌那条。
        expect(
            await screen.findByText('dialog.group.vrcc.likes:6')
        ).toBeTruthy();
        expect(screen.getByText('dialog.group.vrcc.followed')).toBeTruthy();
        // 群组人数不显示——VRChat 群组详情已经有权威值。
        expect(screen.queryByText('dialog.group.vrcc.members:6871')).toBeNull();
        expect(mocks.appVrccClub).toHaveBeenCalledWith('KIPFEL.2104');
    });

    it('没有 clubs 权限时不问带令牌那一条，点赞与关注都不显示', async () => {
        mocks.appVrccClub.mockResolvedValue(clubResponse);
        mocks.appVrccConnection.mockResolvedValue({ scope: 'profile maps' });

        renderWithQuery(
            <GroupVrccClub
                group={{ shortCode: 'KIPFEL', discriminator: '2104' }}
            />
        );

        expect(await screen.findByText('北极星')).toBeTruthy();
        await Promise.resolve();
        expect(mocks.appVrccMyClub).not.toHaveBeenCalled();
        expect(screen.queryByText('dialog.group.vrcc.likes:6')).toBeNull();
        expect(screen.queryByText('dialog.group.vrcc.followed')).toBeNull();
        // **也不该显示「未关注」**：拿不到数据不等于没关注，那是编造信息。
        expect(screen.queryByText('dialog.group.vrcc.not_followed')).toBeNull();
    });

    it('明确未关注时才显示「未关注」，拿不到数据时不显示', async () => {
        mocks.appVrccClub.mockResolvedValue(clubResponse);

        // ① 接口明确说没关注。
        mocks.appVrccMyClub.mockResolvedValue({
            club: { likes: 6, followed: false }
        });
        renderWithQuery(
            <GroupVrccClub
                group={{ shortCode: 'KIPFEL', discriminator: '2104' }}
            />
        );
        expect(
            await screen.findByText('dialog.group.vrcc.not_followed')
        ).toBeTruthy();
        expect(screen.queryByText('dialog.group.vrcc.followed')).toBeNull();
        cleanup();

        // ② 接口没给这个字段（拿不到）→ 两态都不显示。
        mocks.appVrccConnection.mockResolvedValue({
            scope: 'profile maps clubs'
        });
        mocks.appVrccMyClub.mockResolvedValue({ club: { likes: 6 } });
        renderWithQuery(
            <GroupVrccClub
                group={{ shortCode: 'KIPFEL', discriminator: '2104' }}
            />
        );
        expect(
            await screen.findByText('dialog.group.vrcc.likes:6')
        ).toBeTruthy();
        expect(screen.queryByText('dialog.group.vrcc.not_followed')).toBeNull();
        expect(screen.queryByText('dialog.group.vrcc.followed')).toBeNull();
    });

    it('不渲染横幅：横幅在 19rem 的左栏里只挤占空间', async () => {
        mocks.appVrccClub.mockResolvedValue({
            club: {
                ...clubResponse.club,
                banner: 'https://vrcc.cc/c/KIPFEL.2104.banner.jpg'
            }
        });

        const { container } = renderWithQuery(
            <GroupVrccClub
                group={{ shortCode: 'KIPFEL', discriminator: '2104' }}
            />
        );

        await screen.findByText('dialog.group.vrcc.club');
        const images = Array.from(container.querySelectorAll('img'));
        // 只保留图标那一张。
        expect(images).toHaveLength(1);
        expect(images[0]?.getAttribute('src')).toBe(clubResponse.club.icon);
    });

    it('404（后端转成 null）时整块不渲染', async () => {
        mocks.appVrccClub.mockResolvedValue(null);

        const { container } = renderWithQuery(
            <GroupVrccClub
                group={{ shortCode: 'VRCN', discriminator: '0483' }}
            />
        );

        // 绝大多数群组走这条：**不留占位、不显示「没有社团」的结论**。
        await vi.waitFor(() => {
            expect(mocks.appVrccClub).toHaveBeenCalled();
        });
        expect(
            container.querySelector('[data-tour="group-vrcc-club-card"]')
        ).toBeNull();
        expect(screen.queryByText('dialog.group.vrcc.club')).toBeNull();
    });

    it('群组缺短码时一个请求都不发', async () => {
        renderWithQuery(<GroupVrccClub group={{ shortCode: 'KIPFEL' }} />);

        // 给 react-query 一个调度机会再断言。
        await Promise.resolve();
        expect(mocks.appVrccClub).not.toHaveBeenCalled();
    });

    it('请求失败时不把网络问题说成「这个群组没有社团」', async () => {
        mocks.appVrccClub.mockRejectedValue(new Error('network down'));

        const { container } = renderWithQuery(
            <GroupVrccClub
                group={{ shortCode: 'VRCN', discriminator: '0483' }}
            />
        );

        await vi.waitFor(() => {
            expect(mocks.appVrccClub).toHaveBeenCalled();
        });
        expect(
            container.querySelector('[data-tour="group-vrcc-club-card"]')
        ).toBeNull();
    });

    it('没有评级（grade 为 null）时不显示评级行，其它照常', async () => {
        mocks.appVrccClub.mockResolvedValue({
            club: { ...clubResponse.club, grade: null, gradeName: null }
        });

        renderWithQuery(
            <GroupVrccClub
                group={{ shortCode: 'KIPFEL', discriminator: '2104' }}
            />
        );

        expect(await screen.findByText('dialog.group.vrcc.club')).toBeTruthy();
        // 没有评级时显示「未分级」，而不是留空或退到最低档。
        expect(
            screen.getByText('dialog.group.vrcc.grade_unknown')
        ).toBeTruthy();
        expect(screen.queryByText('北极星')).toBeNull();
    });
});
