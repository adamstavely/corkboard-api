import { atLeast, boardRole, needs } from './roles';

describe('roles', () => {
  it('orders the four roles', () => {
    expect(atLeast('owner', 'updater')).toBe(true);
    expect(atLeast('updater', 'updater')).toBe(true);
    expect(atLeast('commenter', 'updater')).toBe(false);
    expect(atLeast('commenter', 'reader')).toBe(true);
  });

  it('lets a board raise or lower the workspace role, but never below a workspace owner', () => {
    expect(boardRole('updater', null)).toBe('updater');
    expect(boardRole('reader', 'updater')).toBe('updater');
    expect(boardRole('updater', 'reader')).toBe('reader');
    expect(boardRole('updater', 'none')).toBeUndefined();
    expect(boardRole('owner', 'none')).toBe('owner');
    expect(boardRole('owner', 'reader')).toBe('owner');
  });

  it('says who can do what', () => {
    expect(needs('owner')).toBe('You need to be an owner to manage this.');
    expect(needs('updater')).toBe('You need to be an updater to change this.');
    expect(needs('commenter')).toBe('You need to be a commenter to comment here.');
  });
});
