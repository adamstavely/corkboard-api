/** How many calls a token may make at once, and how many it gets back each second after. */
const BURST = 60;
const PER_SECOND = 2;
/** Buckets left full this long are forgotten. */
const FORGET_MS = 10 * 60_000;

/**
 * A token bucket per access token, in memory: an agent may make BURST calls at once and PER_SECOND after that. Kept per
 * API process, which is enough to stop a runaway agent.
 */
export class TokenBuckets {
  readonly #buckets = new Map<string, { tokens: number; at: number }>();

  constructor(
    private readonly burst = BURST,
    private readonly perSecond = PER_SECOND,
  ) {}

  /** Takes one call from the token's bucket: 0 if allowed, else how many seconds until the next is. */
  take(key: string, now = Date.now()): number {
    if (this.#buckets.size > 10_000) this.#sweep(now);
    const b = this.#buckets.get(key) ?? { tokens: this.burst, at: now };
    b.tokens = Math.min(this.burst, b.tokens + ((now - b.at) / 1000) * this.perSecond);
    b.at = now;
    this.#buckets.set(key, b);
    if (b.tokens < 1) return Math.ceil((1 - b.tokens) / this.perSecond);
    b.tokens -= 1;
    return 0;
  }

  #sweep(now: number): void {
    for (const [key, b] of this.#buckets) if (now - b.at > FORGET_MS) this.#buckets.delete(key);
  }
}
