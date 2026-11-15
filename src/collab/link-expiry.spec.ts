import type { ParticipantsStore } from '../feedback/participants.store';
import type { HttpAdapterHost } from '@nestjs/core';
import type { UsersService } from '../auth/users.service';
import type { BoardsService } from '../boards/boards.service';
import type { LinksService } from '../links/links.service';
import type { SearchIndex } from '../search/search-index';
import { CollabService } from './collab.service';

describe("a share link's deadline", () => {
  afterEach(() => jest.useRealTimers());

  it('lets its viewers go even when the database check at the deadline fails, rather than leaving them on', async () => {
    jest.useFakeTimers();
    const links = { byId: jest.fn().mockRejectedValueOnce(new Error('database unavailable')) } as unknown as LinksService;
    const users = { signedOut: { subscribe: () => ({ unsubscribe: () => undefined }) } } as unknown as UsersService;
    const collab = new CollabService({} as HttpAdapterHost, users, {} as BoardsService, {} as SearchIndex, links, {} as ParticipantsStore);
    const disconnect = jest.spyOn(collab, 'disconnectLink').mockImplementation(() => undefined);

    collab.watchLink('l1', Date.now() + 1000);
    await jest.advanceTimersByTimeAsync(1000);
    expect(links.byId).toHaveBeenCalledWith('l1');
    expect(disconnect).toHaveBeenCalledWith('l1');
  });
});
