import { beforeEach, describe, expect, it, vi } from 'vitest';

const commandMocks = vi.hoisted(() => ({
    appNotificationListQuery: vi.fn()
}));

const configMocks = vi.hoisted(() => ({
    getInt: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({ commands: commandMocks }));
vi.mock('./configRepository', () => ({ default: configMocks }));

import { queryNotifications } from './notificationPersistenceRepository';

describe('notificationPersistenceRepository', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        configMocks.getInt.mockImplementation(
            async (key: string, fallback: number) =>
                key === 'maxTableSize_v2' ? 250 : fallback
        );
        commandMocks.appNotificationListQuery.mockResolvedValue([]);
    });

    it('uses the bounded default list query and normalizes nested row data', async () => {
        commandMocks.appNotificationListQuery.mockResolvedValueOnce([
            {
                id: 'notification_1',
                details: null,
                data: 'invalid',
                responses: [{ type: 'accept' }, null, 'invalid']
            }
        ]);

        await expect(
            queryNotifications({ userId: ' usr_1 ' })
        ).resolves.toEqual([
            {
                id: 'notification_1',
                details: {},
                data: {},
                responses: [{ type: 'accept' }]
            }
        ]);
        expect(commandMocks.appNotificationListQuery).toHaveBeenCalledWith({
            userId: 'usr_1',
            search: '',
            filters: [],
            perTableLimit: 500,
            limit: 250,
            includeUnseen: true,
            beforeCreatedAt: '',
            beforeId: ''
        });
    });

    it('uses the search limit and disables unseen expansion for filtered queries', async () => {
        configMocks.getInt.mockImplementation(async (key: string) =>
            key === 'searchLimit' ? 1200 : 250
        );

        await queryNotifications({
            userId: 'usr_1',
            search: ' sender ',
            filters: [' invite ', '']
        });

        expect(commandMocks.appNotificationListQuery).toHaveBeenCalledWith({
            userId: 'usr_1',
            search: 'sender',
            filters: ['invite'],
            perTableLimit: 1200,
            limit: 1200,
            includeUnseen: false,
            beforeCreatedAt: '',
            beforeId: ''
        });
    });

    /** 翻页时把游标原样带过去，并且**不**展开未读（那条 SQL 没有 LIMIT）。 */
    it('passes the paging cursor and stops expanding unseen rows', async () => {
        await queryNotifications({
            userId: 'usr_1',
            before: { createdAt: '2026-04-04T00:00:00.000Z', id: 'n3' },
            limit: 50
        });

        expect(commandMocks.appNotificationListQuery).toHaveBeenCalledWith({
            userId: 'usr_1',
            search: '',
            filters: [],
            perTableLimit: 100,
            limit: 50,
            includeUnseen: false,
            beforeCreatedAt: '2026-04-04T00:00:00.000Z',
            beforeId: 'n3'
        });
    });

    it('skips list IPC when no current user id is available', async () => {
        await expect(queryNotifications({ userId: ' ' })).resolves.toEqual([]);
        expect(configMocks.getInt).not.toHaveBeenCalled();
        expect(commandMocks.appNotificationListQuery).not.toHaveBeenCalled();
    });
});
