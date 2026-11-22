// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NotificationSourceCapsule } from './NotificationSourceCapsule';

afterEach(cleanup);

const OPTIONS = [
    { key: 'vrchat' as const, label: 'VRChat', count: 4 },
    { key: 'vrcc' as const, label: 'Orbitune', count: 0 }
];

describe('NotificationSourceCapsule', () => {
    it('marks the active source as selected', () => {
        render(
            <NotificationSourceCapsule
                value="vrchat"
                options={OPTIONS}
                onChange={vi.fn()}
                label="Notification source"
            />
        );

        expect(
            screen
                .getByRole('tab', { name: /VRChat/ })
                .getAttribute('aria-selected')
        ).toBe('true');
        expect(
            screen
                .getByRole('tab', { name: /Orbitune/ })
                .getAttribute('aria-selected')
        ).toBe('false');
    });

    it('reports the clicked source and ignores clicks on the active one', () => {
        const onChange = vi.fn();
        render(
            <NotificationSourceCapsule
                value="vrchat"
                options={OPTIONS}
                onChange={onChange}
                label="Notification source"
            />
        );

        fireEvent.click(screen.getByRole('tab', { name: /Orbitune/ }));
        expect(onChange).toHaveBeenCalledWith('vrcc');

        onChange.mockClear();
        fireEvent.click(screen.getByRole('tab', { name: /VRChat/ }));
        expect(onChange).not.toHaveBeenCalled();
    });

    it('hides a zero count so an empty source does not look like a badge', () => {
        render(
            <NotificationSourceCapsule
                value="vrchat"
                options={OPTIONS}
                onChange={vi.fn()}
                label="Notification source"
            />
        );

        expect(screen.getByText('4')).toBeTruthy();
        // 0 的那一段只显示标签。
        expect(screen.getByRole('tab', { name: 'Orbitune' }).textContent).toBe(
            'Orbitune'
        );
    });
});
