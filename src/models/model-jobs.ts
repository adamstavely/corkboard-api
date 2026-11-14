import { ModelError } from './adapters/types';

/** How many model requests one workspace may have running at once on this API instance. */
export const MAX_JOBS_PER_WORKSPACE = 4;
/** How long a whole model request (every step and tool call) may take before it's stopped. */
export const JOB_MS = 5 * 60_000;

/**
 * The model requests running now: at most MAX_JOBS_PER_WORKSPACE per workspace, each stopped after JOB_MS, and all of
 * them stopped when the API shuts down. Each request gets a signal the adapters pass to every call, so stopping it
 * stops the call in flight rather than leaving it to finish unseen.
 */
export class ModelJobs {
  readonly #running = new Map<string, number>();
  readonly #jobs = new Set<AbortController>();

  constructor(
    private readonly maxPerWorkspace = MAX_JOBS_PER_WORKSPACE,
    private readonly jobMs = JOB_MS,
  ) {}

  /** Runs one request for a workspace, with a signal that ends at the deadline, at shutdown, or when `outer` does. */
  async run<T>(orgId: string, outer: AbortSignal | undefined, job: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const running = this.#running.get(orgId) ?? 0;
    if (running >= this.maxPerWorkspace) {
      throw new ModelError(`Your workspace already has ${running} model requests running. Try again when one finishes.`);
    }
    this.#running.set(orgId, running + 1);
    const controller = new AbortController();
    this.#jobs.add(controller);
    const deadline = setTimeout(() => controller.abort(new ModelError('The model took too long, so the request was stopped. Try a narrower one.')), this.jobMs);
    deadline.unref();
    try {
      return await job(outer ? AbortSignal.any([outer, controller.signal]) : controller.signal);
    } finally {
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

  /** Stops every request, e.g. at shutdown. */
  stopAll(): void {
    for (const job of this.#jobs) job.abort(new ModelError('The server is restarting, so the request was stopped. Try again shortly.'));
  }
}
