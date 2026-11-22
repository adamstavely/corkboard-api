import { covers, latestExpiry, refusalText } from './rules';

describe('workspace policy rules', () => {
  it('lets each choice reach the people it names, and no one below', () => {
    const wsOwner = { orgRole: 'owner', boardRole: 'owner' } as const;
    const boardOwner = { orgRole: 'updater', boardRole: 'owner' } as const;
    const editor = { orgRole: 'updater', boardRole: 'updater' } as const;
    const reader = { orgRole: 'reader', boardRole: 'reader' } as const;
    expect([wsOwner, boardOwner, editor, reader].map((p) => covers('workspace_owners', p))).toEqual([true, false, false, false]);
    expect([wsOwner, boardOwner, editor, reader].map((p) => covers('board_owners', p))).toEqual([true, true, false, false]);
    expect([wsOwner, boardOwner, editor, reader].map((p) => covers('editors', p))).toEqual([true, true, true, false]);
    expect([wsOwner, boardOwner, editor, reader].map((p) => covers('everyone', p))).toEqual([true, true, true, true]);
  });

  it('counts the facilitator as an owner for feedback only', () => {
    const facilitator = { orgRole: 'updater', boardRole: 'updater', facilitator: true } as const;
    expect(covers('board_owners', facilitator, 'feedback')).toBe(true);
    expect(covers('board_owners', facilitator, 'shareLinks')).toBe(false);
    expect(covers('board_owners', { ...facilitator, boardRole: 'commenter' }, 'feedback')).toBe(false);
  });

  it('says which policy said no', () => {
    expect(refusalText('shareLinks', 'workspace_owners')).toBe("This workspace's policy lets only workspace owners make and manage share links.");
    expect(refusalText('feedback', 'board_owners')).toBe("This workspace's policy lets only board owners and the facilitator open boards for outside feedback.");
    expect(refusalText('exports', 'editors')).toBe("This workspace's policy lets only people who can edit the board export boards.");
  });

  it('works out the latest a link may expire', () => {
    expect(latestExpiry(null, 0)).toBeNull();
    expect(latestExpiry(2, 1000)).toBe(1000 + 2 * 86_400_000);
  });
});
