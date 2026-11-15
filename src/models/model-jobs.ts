import { ModelError } from './adapters/types';

/** How many model requests one workspace may have running at once on this API instance. */
export const MAX_JOBS_PER_WORKSPACE = 4;
/** How long a whole model request (every step and tool call) may take before it's stopped. */
export const JOB_MS = 5 * 60_000;
/** How long shutdown waits for stopped model work to wind up (saving what it did) before going on regardless. */
export const DRAIN_MS = 10_000;

const RESTARTING = 'The server is restarting, so the request was stopped. Try again shortly.';

/**
 * The model requests running now: at most MAX_JOBS_PER_WORKSPACE per workspace, each stopped after JOB_MS, and all of
 * them stopped when the API shuts down. Each request gets a signal the adapters pass to every call, so stopping it
 * stops the call in flight rather than leaving it to finish unseen.
 */
export class ModelJobs {
  readonly #running = new Map<string, number>();
  readonly #jobs = new Set<AbortController>();
  /** Every piece of model work underway (see work), and every request (see run), for shutdown to wait on. */
  readonly #underway = new Set<Promise<unknown>>();
  #closed = false;

  constructor(
    private readonly maxPerWorkspace = MAX_JOBS_PER_WORKSPACE,
    private readonly jobMs = JOB_MS,
  ) {}

  /** Runs one request for a workspace, with a signal that ends at the deadline, at shutdown, or when `outer` does. */
  async run<T>(orgId: string, outer: AbortSignal | undefined, job: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.#closed) throw new ModelError(RESTARTING);
    const running = this.#running.get(orgId) ?? 0;
    if (running >= this.maxPerWorkspace) {
      throw new ModelError(`Your workspace already has ${running} model requests running. Try again when one finishes.`);
    }
    this.#running.set(orgId, running + 1);
    const controller = new AbortController();
    this.#jobs.add(controller);
    const deadline = setTimeout(() => controller.abort(new ModelError('The model took too long, so the request was stopped. Try a narrower one.')), this.jobMs);
    deadline.unref();
    const pending = job(outer ? AbortSignal.any([outer, controller.signal]) : controller.signal);
    this.#underway.add(pending);
    try {
      return await pending;
    } finally {
      this.#underway.delete(pending);
      clearTimeout(deadline);
      this.#jobs.delete(controller);
      const left = (this.#running.get(orgId) ?? 1) - 1;
      if (left > 0) this.#running.set(orgId, left);
      else this.#running.delete(orgId);
    }
  }

  /** How many requests a workspace has running. */
  runningIn(orgId: string): number {
    return this.#running.get(orgId) ?? 0;
  }

  /**
   * Runs a whole piece of model work: the requests and everything done with their answers (changing the board, saving
   * the chat reply), so shutdown waits for it to finish before boards are saved and the database closes. Refused once
   * shutdown has begun.
   */
  async work<T>(work: () => Promise<T>): Promise<T> {
    if (this.#closed) throw new ModelError(RESTARTING);
    const pending = work();
    this.#underway.add(pending);
    try {
      return await pending;
    } finally {
      this.#underway.delete(pending);
    }
  }

  /** Stops every request, e.g. at shutdown. */
  stopAll(): void {
    for (const job of this.#jobs) job.abort(new ModelError(RESTARTING));
  }

  /**
   * At shutdown: refuses new work, stops every request, and waits (up to `ms`) for the work underway to finish with what
   * it has, so it lands before boards are saved and the HTTP server stops waiting on the requests that asked for it.
   */
  async drain(ms = DRAIN_MS): Promise<void> {
    this.#closed = true;
    this.stopAll();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<void>((resolve) => (timer = setTimeout(resolve, ms)));
    try {
      // Work can start more work as it ends (a chat answer after its run); wait until none is left.
      while (this.#underway.size) await Promise.race([Promise.allSettled([...this.#underway]), late.then(() => Promise.reject(new Error('late')))]);
    } catch {
      // Out of time: go on, and let the deadline's abort have done what it can.
    } finally {
      clearTimeout(timer);
    }
  }
}
