// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const openExternalLink = vi.hoisted(() => vi.fn());
const toastAdd = vi.hoisted(() => vi.fn());

vi.mock('@/services/shellIntegrationService', () => ({ openExternalLink }));
vi.mock('@/services/toastService', () => ({ toast: { add: toastAdd } }));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key })
}));

import { useOpenExternalLink } from './useOpenExternalLink';

/**
 * 打开外链的反馈。
 *
 * 钉住的是一个真实反馈：玩家「用触摸板抖了一下，给俺弹了几个窗口」。
 * 原因不是缺少冷却，而是**点下去毫无回应**——成功时原来只写 `console.error`
 * 之外的什么都没有，玩家无法判断是没点上还是已经打开了，只能再点一次。
 *
 * 所以这个 hook 做两件事：即时 pending 状态、成功/失败回执。
 */
describe('useOpenExternalLink', () => {
    beforeEach(() => {
        openExternalLink.mockReset();
        toastAdd.mockReset();
    });

    it('点击后立刻进入 pending，结束后恢复', async () => {
        let resolve: () => void = () => {};
        openExternalLink.mockReturnValue(
            new Promise<void>((r) => {
                resolve = r;
            })
        );

        const { result } = renderHook(() => useOpenExternalLink());
        expect(result.current.pending).toBe(false);

        act(() => result.current.open('https://example.com'));

        // 关键：**同步**就能看到 pending，玩家的点击因此有立即回应。
        await waitFor(() => expect(result.current.pending).toBe(true));

        await act(async () => {
            resolve();
        });
        await waitFor(() => expect(result.current.pending).toBe(false));
    });

    it('成功时给一条轻提示', async () => {
        openExternalLink.mockResolvedValue(undefined);

        const { result } = renderHook(() => useOpenExternalLink());
        await act(async () => {
            result.current.open('https://example.com');
        });

        await waitFor(() =>
            expect(toastAdd).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'success' })
            )
        );
    });

    it('失败时给出可读提示，而不是只写控制台', async () => {
        openExternalLink.mockRejectedValue(new Error('no browser'));
        const consoleError = vi
            .spyOn(console, 'error')
            .mockImplementation(() => {});

        const { result } = renderHook(() => useOpenExternalLink());
        await act(async () => {
            result.current.open('https://example.com');
        });

        await waitFor(() =>
            expect(toastAdd).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'error' })
            )
        );

        consoleError.mockRestore();
    });

    it('失败后 pending 也要恢复，不能卡住', async () => {
        openExternalLink.mockRejectedValue(new Error('boom'));
        const consoleError = vi
            .spyOn(console, 'error')
            .mockImplementation(() => {});

        const { result } = renderHook(() => useOpenExternalLink());
        await act(async () => {
            result.current.open('https://example.com');
        });

        // 卡在 pending 的话按钮会永久禁用——比不加反馈更糟。
        await waitFor(() => expect(result.current.pending).toBe(false));
        consoleError.mockRestore();
    });

    it('并发打开多个链接时，最后一个结束才回到 idle', async () => {
        const resolvers: Array<() => void> = [];
        openExternalLink.mockImplementation(
            () =>
                new Promise<void>((r) => {
                    resolvers.push(r);
                })
        );

        const { result } = renderHook(() => useOpenExternalLink());
        act(() => {
            result.current.open('https://a.example');
            result.current.open('https://b.example');
        });

        await waitFor(() => expect(result.current.pending).toBe(true));

        // 只结束一个：另一个还在飞，不能提前回到 idle。
        await act(async () => {
            resolvers[0]();
        });
        expect(result.current.pending).toBe(true);

        await act(async () => {
            resolvers[1]();
        });
        await waitFor(() => expect(result.current.pending).toBe(false));
    });
});
