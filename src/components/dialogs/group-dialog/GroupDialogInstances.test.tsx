// SPDX-License-Identifier: MPL-2.0
// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GroupDialogInstanceRow } from '@/domain/entities/group';

import { GroupDialogInstances } from './GroupDialogInstances';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key })
}));

vi.mock('./GroupInstanceRows', () => ({
    GroupInstanceRows: ({
        instances
    }: {
        instances: { location?: string }[];
    }) => (
        <ul data-testid="rows">
            {instances.map((instance) => (
                <li key={instance.location} data-location={instance.location} />
            ))}
        </ul>
    )
}));

function row(location: string) {
    return { location } as GroupDialogInstanceRow;
}

describe('GroupDialogInstances', () => {
    afterEach(cleanup);

    it('原样渲染上游给的房间，不再自己拉数据', () => {
        render(
            <GroupDialogInstances
                activeInstances={[row('wrld_a:1'), row('wrld_b:2')]}
                currentUserId="usr_me"
            />
        );

        // 合并与好友匹配都在上游（`useGroupClubInstanceRecords` +
        // `mergeGroupInstances`），这里只负责画出来。
        const items = Array.from(
            screen.getByTestId('rows').querySelectorAll('li')
        ).map((node) => node.getAttribute('data-location'));
        expect(items).toEqual(['wrld_a:1', 'wrld_b:2']);
        expect(screen.queryByText('dialog.group.vrcc.rooms_source')).toBeNull();
    });

    it('列表里混有社团房间时才多一行来源说明', () => {
        render(
            <GroupDialogInstances
                activeInstances={[row('wrld_a:1')]}
                currentUserId="usr_me"
                hasClubRooms
            />
        );

        expect(screen.getByText('dialog.group.vrcc.rooms_source')).toBeTruthy();
    });

    it('空列表也能渲染', () => {
        render(
            <GroupDialogInstances activeInstances={[]} currentUserId="usr_me" />
        );

        expect(screen.getByTestId('rows').querySelectorAll('li')).toHaveLength(
            0
        );
    });
});
