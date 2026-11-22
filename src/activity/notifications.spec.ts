import { mentioned, plainMentions } from './notifications';

const ada = { id: '11111111-1111-4111-8111-111111111111', name: 'Ada Lovelace' };
const adaToo = { id: '22222222-2222-4222-8222-222222222222', name: 'Ada Lovelace' };
const grace = { id: '33333333-3333-4333-8333-333333333333', name: 'Grace Hopper' };
const outsider = '44444444-4444-4444-8444-444444444444';

describe('mentioned', () => {
  it('finds people picked from the list by id, so a namesake is not told too', () => {
    expect(mentioned(`Over to @[Ada Lovelace](${adaToo.id})`, [ada, adaToo, grace])).toEqual([adaToo.id]);
  });

  it('still finds people typed by full or first name, any case', () => {
    expect(mentioned('Thanks @ada lovelace and @Grace!', [ada, grace])).toEqual([ada.id, grace.id]);
    expect(mentioned('@Gracefully done', [grace])).toEqual([]);
  });

  it('mixes both, once each', () => {
    expect(mentioned(`@[Grace Hopper](${grace.id}) and @Grace again`, [ada, grace])).toEqual([grace.id]);
  });

  it("leaves out anyone who isn't among the people given (those who can't open the board)", () => {
    expect(mentioned(`@[Someone Else](${outsider}) and @Nobody`, [ada, grace])).toEqual([]);
  });

  it('accepts ids in either case', () => {
    expect(mentioned(`@[Ada](${ada.id.toUpperCase()})`, [ada])).toEqual([ada.id]);
  });
});

describe('plainMentions', () => {
  it('shows picked mentions as names and leaves the rest of the text alone', () => {
    expect(plainMentions(`Over to @[Ada Lovelace](${ada.id}) — and @Grace [see](x)`)).toBe('Over to @Ada Lovelace — and @Grace [see](x)');
  });
});
