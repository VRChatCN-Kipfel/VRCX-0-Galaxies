// @vitest-environment jsdom

import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    copyTextToClipboard: vi.fn().mockResolvedValue(true)
}));

vi.mock('@/services/clipboardService', () => ({
    copyTextToClipboard: mocks.copyTextToClipboard
}));

import {
    EntityDialogTabContent,
    EntityDialogTabs,
    EntityRawJson
} from './EntityDialogScaffold';

describe('EntityRawJson', () => {
    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    it('omits top-level app fields while preserving nested external JSON', async () => {
        render(
            <EntityRawJson
                value={{
                    id: 'usr_1',
                    $trustLevel: 'User',
                    metadata: {
                        $remoteField: 'preserved',
                        visible: true
                    }
                }}
            />
        );

        expect(screen.queryByText(/trustLevel/)).toBeNull();

        fireEvent.click(screen.getByText('"metadata":'));
        expect(screen.getByText('"$remoteField":')).toBeTruthy();

        fireEvent.click(
            screen.getByRole('button', { name: 'common.actions.copy' })
        );

        await waitFor(() => {
            expect(mocks.copyTextToClipboard).toHaveBeenCalledWith(
                JSON.stringify(
                    {
                        id: 'usr_1',
                        metadata: {
                            $remoteField: 'preserved',
                            visible: true
                        }
                    },
                    null,
                    2
                )
            );
        });
    });
});

/**
 * 新手导览的锚点是**字符串契约**，一侧改了另一侧不会报错，只会静默失效。
 *
 * `vrccTourSteps.ts` 用 `[data-tour="dialog-vrcc-tab"]` 两处消费：
 * - `openVrccTabInDialog()` 靠它找到页签按钮并点过去（:143）
 * - 榜单一步的 `advanceWhen` 靠它判断「详情已经开了」（:293）
 *
 * 丢了这个属性，导览会把两处都**跳过**，玩家看到「第 7 步完了直接到第 10 步」，
 * 而类型检查和其它测试都抓不到。所以这里直接钉死属性名与挂载位置。
 */
describe('EntityDialogTabs 导览锚点', () => {
    afterEach(cleanup);

    it('「星遇同频」页签按钮上带 data-tour="dialog-vrcc-tab"', () => {
        render(
            <EntityDialogTabs
                value="info"
                onValueChange={() => {}}
                tabs={[
                    { value: 'info', label: '房间' },
                    { value: 'vrcc', label: '星遇同频' }
                ]}
            >
                <EntityDialogTabContent value="info">
                    <div>房间内容</div>
                </EntityDialogTabContent>
                <EntityDialogTabContent value="vrcc">
                    <div>星遇内容</div>
                </EntityDialogTabContent>
            </EntityDialogTabs>
        );

        // 与 `vrccTourSteps.ts` 里的选择器逐字一致 —— 改这里等于改契约。
        const anchor = document.querySelector(
            '[data-tour="dialog-vrcc-tab"]'
        ) as HTMLElement | null;
        expect(anchor).not.toBeNull();

        // 必须挂在页签**按钮**上而不是内容上：内容未激活时不渲染，
        // 挂内容上导览会陷入「等元素出现 / 元素要等点击才出现」的死锁。
        expect(anchor?.getAttribute('role')).toBe('tab');
        expect(anchor?.textContent).toContain('星遇同频');
    });

    it('只有 vrcc 页签带锚点，其它页签不带', () => {
        render(
            <EntityDialogTabs
                value="info"
                onValueChange={() => {}}
                tabs={[
                    { value: 'info', label: '房间' },
                    { value: 'vrcc', label: '星遇同频' }
                ]}
            />
        );

        const anchors = document.querySelectorAll(
            '[data-tour="dialog-vrcc-tab"]'
        );
        expect(anchors).toHaveLength(1);
    });

    it('带 actions 插槽时页签仍带锚点（上游新增的包裹结构不能吃掉它）', () => {
        render(
            <EntityDialogTabs
                value="vrcc"
                onValueChange={() => {}}
                tabs={[
                    { value: 'info', label: '房间' },
                    { value: 'vrcc', label: '星遇同频' }
                ]}
                actions={<button type="button">more</button>}
            />
        );

        // actions 分支把 tabList 收进一个包裹 div 并加了 `min-w-0 flex-1`，
        // 这是上游 2.34.0 的新形状。锚点若只挂在无 actions 分支上，这里会挂。
        const anchor = document.querySelector('[data-tour="dialog-vrcc-tab"]');
        expect(anchor).not.toBeNull();
        expect(screen.getByText('more')).toBeTruthy();
    });
});
