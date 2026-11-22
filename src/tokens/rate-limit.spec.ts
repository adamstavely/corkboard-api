import { TokenBuckets } from './rate-limit';

describe('TokenBuckets', () => {
  it('allows a burst, then calls at the refill rate, per token', () => {
    const buckets = new TokenBuckets(3, 1);
    const now = 1_000_000;
    expect([buckets.take('a', now), buckets.take('a', now), buckets.take('a', now)]).toEqual([0, 0, 0]);
    expect(buckets.take('a', now)).toBe(1);
    // Another token has its own bucket.
    expect(buckets.take('b', now)).toBe(0);
    expect(buckets.take('a', now + 1000)).toBe(0);
    expect(buckets.take('a', now + 1000)).toBe(1);
    // It refills only up to the burst.
    expect([0, 1, 2, 3].map(() => buckets.take('a', now + 60_000))).toEqual([0, 0, 0, 1]);
  });
});
