// SPDX-License-Identifier: MPL-2.0
// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GroupVrccClubNotice } from './GroupVrccClubNotice';

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

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key })
}));

// 翻译那一层的交互不是这条要测的，直接把 source 当正文渲染。
vi.mock('@/components/translation/TranslatableText', () => ({
    TranslatableText: ({
        source,
        children
    }: {
        source: string;
        children: (args: {
            action: null;
            meta: null;
            error: null;
            text: string;
        }) => ReactElement;
    }) => children({ action: null, meta: null, error: null, text: source })
}));

function renderWithQuery(ui: ReactElement) {
    const client = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } }
    });
    return render(
        <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    );
}

const group = {
    id: 'grp_f0b1a7b9',
    shortCode: 'ONLYFR',
    discriminator: '5576'
};

/**
 * 实测 `ONLYFR.5576` 的 notice。
 *
 * 接口原始值是 `"segs": [["文字", 0], ["QQ群：…", 1]]`——每段是一个**两元素
 * 数组**。契约层的 `VrccClubTextSeg` 手写 `Deserialize` 会把它转成
 * `{text, hidden}`，所以前端拿到的是对象数组。
 *
 * 曾经契约里多套了一层 `Vec`（`Vec<Vec<VrccClubTextSeg>>`），结果把
 * `"文字"` 和 `0` 当成两个段去解，全变成 `{text: null}`——**公告渲染成空白**。
 * 这里保留转换后的正确形状，作为那条 bug 的回归护栏。
 */
const realNotice = {
    segs: [
        {
            text: '星夜吧是 VRChat 里的星空主题酒吧。在这里可以匹配新朋友、滑你喜欢的人的卡、收集塔罗牌、斗地主、玩街机，也能听驻台歌手现场献唱。\n今夜，来星夜吧坐坐吧。\n',
            hidden: false
        },
        { text: 'QQ群：1081176823', hidden: true }
    ],
    until: 1799251199999
};

describe('GroupVrccClubNotice', () => {
    afterEach(cleanup);

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.appVrccClub.mockResolvedValue({ club: { code: 'ONLYFR.5576' } });
        mocks.appVrccConnection.mockResolvedValue({ scope: 'profile clubs' });
        mocks.appVrccMyClub.mockResolvedValue({ club: { notice: realNotice } });
    });

    it('把分段的公告拼成一整段，联系方式照常显示', async () => {
        renderWithQuery(<GroupVrccClubNotice group={group} />);

        expect(
            await screen.findByText('dialog.group.vrcc.notice.title')
        ).toBeTruthy();
        // 正文与联系方式都在——**不打码**。
        expect(
            screen.getByText(/星夜吧是 VRChat 里的星空主题酒吧/)
        ).toBeTruthy();
        expect(screen.getByText(/QQ群：1081176823/)).toBeTruthy();
        // 没过期，不该有「已失效」。
        expect(
            screen.queryByText('dialog.group.vrcc.notice.expired')
        ).toBeNull();
    });

    it('过期了照常显示内容，只在右下角挂一个「已失效」', async () => {
        mocks.appVrccMyClub.mockResolvedValue({
            club: { notice: { ...realNotice, until: 1 } }
        });

        renderWithQuery(<GroupVrccClubNotice group={group} />);

        // 内容仍在。
        expect(
            await screen.findByText(/星夜吧是 VRChat 里的星空主题酒吧/)
        ).toBeTruthy();
        // 标记也在。
        expect(
            screen.getByText('dialog.group.vrcc.notice.expired')
        ).toBeTruthy();
    });

    it('没有 notice 时整块不渲染', async () => {
        mocks.appVrccMyClub.mockResolvedValue({ club: { notice: null } });

        const { container } = renderWithQuery(
            <GroupVrccClubNotice group={group} />
        );

        await vi.waitFor(() => {
            expect(mocks.appVrccMyClub).toHaveBeenCalled();
        });
        expect(screen.queryByText('dialog.group.vrcc.notice.title')).toBeNull();
        expect(container.querySelector('section')).toBeNull();
    });

    it('没有 clubs 权限时不问带令牌那一条', async () => {
        mocks.appVrccConnection.mockResolvedValue({ scope: 'profile maps' });

        renderWithQuery(<GroupVrccClubNotice group={group} />);

        await vi.waitFor(() => {
            expect(mocks.appVrccConnection).toHaveBeenCalled();
        });
        expect(mocks.appVrccMyClub).not.toHaveBeenCalled();
        expect(screen.queryByText('dialog.group.vrcc.notice.title')).toBeNull();
    });

    it('群组没入驻社团时也不问带令牌那一条', async () => {
        mocks.appVrccClub.mockResolvedValue(null);

        renderWithQuery(<GroupVrccClubNotice group={group} />);

        await vi.waitFor(() => {
            expect(mocks.appVrccClub).toHaveBeenCalled();
        });
        expect(mocks.appVrccMyClub).not.toHaveBeenCalled();
    });
});
