import { moveTo, spread } from './breakouts-doc';

describe('breakout groups', () => {
  const people = ['Ada', 'Grace', 'Linus', 'Edsger', 'Barbara'].map((name) => ({ id: name.toLowerCase(), name }));

  it('spreads people across groups evenly', () => {
    expect(spread(people, ['a', 'b']).map((g) => g.map((p) => p.name))).toEqual([
      ['Ada', 'Linus', 'Barbara'],
      ['Grace', 'Edsger'],
    ]);
    expect(spread([], ['a', 'b'])).toEqual([[], []]);
  });

  it('moves someone into one group and out of the others', () => {
    const groups = spread(people, ['a', 'b']).map((members, i) => ({ frameId: ['a', 'b'][i], members, endsAt: null, seconds: 0 }));
    const moved = moveTo(groups, people[0], 'b');
    expect(moved[0].members.map((p) => p.name)).toEqual(['Linus', 'Barbara']);
    expect(moved[1].members.map((p) => p.name)).toEqual(['Grace', 'Edsger', 'Ada']);
  });
});
