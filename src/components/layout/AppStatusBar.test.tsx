// @vitest-environment jsdom

import {
    act,
    cleanup,
    fireEvent,
    render,
    screen
} from '@testing-library/react';
import type { ComponentProps, PropsWithChildren, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { commands } from '@/platform/tauri/bindings';
import { STATUS_BAR_CONFIG_KEYS } from '@/repositories/configKeys';
import configRepository from '@/repositories/configRepository';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useVrccHealthStore } from '@/state/vrccHealthStore';

const segmentRenders = vi.hoisted(() => [] as string[]);

vi.mock('@/platform/tauri/bindings', async () =>
    (await import('@/test/mockCommands')).mockBindingsModule()
);

vi.mock('@/repositories/configRepository', () => ({
    default: {
        getString: vi.fn(() => Promise.resolve(null)),
        setString: vi.fn(() => Promise.resolve())
    }
}));

vi.mock('@/services/toastService', () => ({
    toast: { add: vi.fn(), close: vi.fn() }
}));

vi.mock('@/ui/shadcn/tooltip', () => ({
    Tooltip: ({ children }: PropsWithChildren) => <>{children}</>,
    TooltipContent: ({ children }: PropsWithChildren) => (
        <div role="tooltip">{children}</div>
    ),
    TooltipTrigger: ({ render }: { render?: ReactNode }) => <>{render}</>
}));

vi.mock('./status-bar/DoNotDisturbMenu', () => ({
    DoNotDisturbMenu: () => null
}));
vi.mock('./status-bar/GameIsolationToggle', () => ({
    GameIsolationToggle: () => null
}));
vi.mock('./status-bar/DesktopWidgetToggle', () => ({
    DesktopWidgetToggle: () => null
}));
vi.mock('./status-bar/OfflineRecordIndicator', () => ({
    OfflineRecordIndicator: () => null
}));

vi.mock('./status-bar/StatusBarParts', async (importOriginal) => {
    const actual =
        await importOriginal<typeof import('./status-bar/StatusBarParts')>();
    return {
        ...actual,
        StatusSegment: (props: ComponentProps<typeof actual.StatusSegment>) => {
            segmentRenders.push(String(props.label));
            return <actual.StatusSegment {...props} />;
        }
    };
});

import { AppStatusBar } from './AppStatusBar';

beforeEach(() => {
    useRuntimeStore.getState().resetRuntimeState();
    useRuntimeStore.getState().setNowPlayingState({
        url: 'https://example.com/track',
        name: 'Track',
        position: 0,
        length: 0
    });
    // 星遇健康由常驻探针写进独立 store，runtime 的 reset 不管它。
    useVrccHealthStore.getState().reset();
    // `getString` 的返回类型是 `string`（不是 `string | null`）：`defaultValue`
    // 是**入参**默认值，不是返回默认值 —— 查不到时它给 `''`。
    vi.mocked(configRepository.getString).mockResolvedValue('');
});

afterEach(() => {
    cleanup();
    segmentRenders.length = 0;
});

describe('AppStatusBar', () => {
    it('re-renders only the segment whose data changed', async () => {
        render(<AppStatusBar />);
        await act(async () => {});
        expect(segmentRenders).toContain('status_bar.now_playing');
        expect(segmentRenders).toContain('VRChat');

        segmentRenders.length = 0;
        act(() =>
            useRuntimeStore.getState().setNowPlayingState({ name: 'Next' })
        );
        expect(segmentRenders).toEqual(['status_bar.now_playing']);

        segmentRenders.length = 0;
        act(() =>
            useRuntimeStore.getState().setGameState({
                lastGameLogAt: '2026-10-29T00:00:00.000Z',
                lastGameLogType: 'location'
            })
        );
        expect(segmentRenders).toEqual(['VRChat']);
    });

    it('shows the media details on hover and holds the time while paused', async () => {
        useRuntimeStore.getState().setNowPlayingState({
            url: 'https://youtu.be/abc',
            name: 'Song',
            displayName: 'Alice',
            thumbnailUrl: 'https://img.test/a.jpg',
            length: 200,
            position: 30,
            startedAt: '2026-10-30T00:00:00.000Z',
            paused: true
        });
        render(<AppStatusBar />);
        await act(async () => {});

        const tooltip = screen
            .getAllByRole('tooltip')
            .find((element) => element.textContent?.includes('Alice'));
        expect(tooltip?.querySelector('img')?.getAttribute('src')).toBe(
            'https://img.test/a.jpg'
        );
        expect(tooltip?.textContent).toContain('https://youtu.be/abc');
        expect(screen.getByText('00:30 / 03:20')).not.toBeNull();
    });

    it('shows the reconnect state as text and retries on click', async () => {
        vi.mocked(commands.appRealtimeRetryNow).mockResolvedValue();
        render(<AppStatusBar />);
        await act(async () => {});
        expect(screen.queryByText(/status_bar\.realtime_retry/)).toBeNull();

        act(() =>
            useRuntimeStore.getState().setTransportState({
                websocketConnected: false,
                interrupted: true,
                retryWaiting: true,
                retryAt: new Date(Date.now() + 30_000).toISOString(),
                lastError: 'websocket read: connection reset',
                outageStartedAt: '2026-10-29T00:00:00.000Z'
            })
        );

        const segment = screen.getByRole('button', {
            name: /status_bar\.realtime_retry_in/
        });
        expect(
            screen.queryByText(/status_bar\.realtime_reason/)
        ).not.toBeNull();
        fireEvent.click(segment);

        expect(commands.appRealtimeRetryNow).toHaveBeenCalledTimes(1);
    });
});

/**
 * 星遇同频（vrcc.cc）那一段。
 *
 * 上面 `re-renders only the segment whose data changed` 是**上游自带**的断言，
 * 保护的是「分段自读 store」这个架构（`StatusBarFooterModel` 大对象被删除后，
 * 任何一次 nowPlaying 变化都不该拖着重渲整条状态栏）。
 *
 * 但它保护不到 `VrccStatusSegment` —— 上游写这个测试时星遇段还不存在。
 * fork 特有代码被放进上游结构、而保护它的测试不存在，是这次合并里反复出现的
 * 同一类缺口（`data-tour` 锚点也是如此）。所以在这里把两边约束并列摆着。
 */
describe('星遇段（fork 特有）', () => {
    it('默认渲染：DEFAULT_VISIBILITY.vrcc = true', async () => {
        render(<AppStatusBar />);
        await act(async () => {});

        // 和 VRChat 服务器状态同权，默认就在，不需要任何配置。
        expect(segmentRenders).toContain('status_bar.vrcc');
    });

    it('配置里关掉 vrcc 后不渲染', async () => {
        // 状态栏读 `STATUS_BAR_CONFIG_KEYS.visibility` 里的 JSON。
        vi.mocked(configRepository.getString).mockImplementation(
            async (key: string) =>
                key === STATUS_BAR_CONFIG_KEYS.visibility
                    ? JSON.stringify({ vrcc: false })
                    : ''
        );

        render(<AppStatusBar />);
        await act(async () => {});

        // 注意：这里必须断言 **DOM** 而不是 `segmentRenders`。
        // `segmentRenders` 是累积数组 —— 配置是异步读的，首帧用
        // `DEFAULT_VISIBILITY` 渲染过一次、把 'status_bar.vrcc' 记了进去，
        // 配置到达后那次重渲并不会把它从数组里抹掉。DOM 才反映最终状态。
        expect(screen.queryByText('status_bar.vrcc')).toBeNull();
        // 关掉星遇不该把别的段一起带走。
        expect(screen.getByText('status_bar.servers')).not.toBeNull();
    });

    it('failing 态不崩，且圆点染色', async () => {
        // 服务端 5xx：站方那边的事。这一段最容易在渲染期炸的路径
        // （`details` 里带服务端原文、`dotClassName` 覆盖色、tooltip 多行）。
        useVrccHealthStore
            .getState()
            .setHealth({ state: 'failing', reason: 'HTTP 500' }, Date.now());

        render(<AppStatusBar />);
        await act(async () => {});

        expect(segmentRenders).toContain('status_bar.vrcc');
        const segment = screen.getByRole('button', {
            name: /status_bar\.vrcc/
        });
        const dot = segment.querySelector('span');
        expect(dot?.className).toContain('--status-askme');
    });

    it('不订阅 runtimeStore：nowPlaying / gameState 变化时不重渲', async () => {
        // **这条是防「将来有人图省事把它接到 runtimeStore」的。**
        //
        // 星遇的结论来自独立 store（`useVrccHealthStore`），与 VRChat 的
        // runtime 快照无关。一旦有人把 `useRuntimeStore(...)` 塞进
        // `VrccStatusSegment`，它就会跟着 nowPlaying / gameState 一起重渲 ——
        // 那正是上面上游那条严格 `toEqual` 断言失败的方式（数组里多出
        // 'status_bar.vrcc'）。这里提前钉死。
        render(<AppStatusBar />);
        await act(async () => {});
        expect(segmentRenders).toContain('status_bar.vrcc');

        segmentRenders.length = 0;
        act(() =>
            useRuntimeStore.getState().setNowPlayingState({ name: 'Next' })
        );
        expect(segmentRenders).toEqual(['status_bar.now_playing']);

        segmentRenders.length = 0;
        act(() =>
            useRuntimeStore.getState().setGameState({
                lastGameLogAt: '2026-10-29T00:00:00.000Z',
                lastGameLogType: 'location'
            })
        );
        expect(segmentRenders).toEqual(['VRChat']);
    });

    it('健康结论变化时它自己会重渲（不是死组件）', async () => {
        // 反向断言：上一条「不订阅 runtimeStore」不能靠「它根本不响应任何
        // store」来实现 —— 那样它就成了一个永远画同一份数据的死组件。
        render(<AppStatusBar />);
        await act(async () => {});
        expect(segmentRenders).toContain('status_bar.vrcc');

        segmentRenders.length = 0;
        act(() =>
            useVrccHealthStore
                .getState()
                .setHealth({ state: 'ok', at: null }, Date.now())
        );
        expect(segmentRenders).toEqual(['status_bar.vrcc']);
    });
});
