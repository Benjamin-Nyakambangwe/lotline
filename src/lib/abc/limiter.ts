/**
 * One shared limiter for every request to ABC: a token bucket (rate + burst), a
 * concurrency cap, and a priority queue so hot lots are never stuck behind a catalogue sync.
 */

export type Priority = "hot" | "ondemand" | "warm" | "sync" | "enrich";
const ORDER: Record<Priority, number> = {
  hot: 0,
  ondemand: 1,
  warm: 2,
  sync: 3,
  enrich: 4,
};

export interface LimiterOptions {
  concurrency: number;
  ratePerSec: number;
  burst: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
}

interface Job {
  run: () => Promise<unknown>;
  priority: Priority;
  seq: number;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

export class Limiter {
  private readonly opts: Required<LimiterOptions>;
  private tokens: number;
  private lastRefill: number;
  private running = 0;
  private seq = 0;
  private queue: Job[] = [];
  private timerArmed = false;
  readonly started: Record<Priority, number> = {
    hot: 0,
    ondemand: 0,
    warm: 0,
    sync: 0,
    enrich: 0,
  };

  constructor(opts: LimiterOptions) {
    this.opts = {
      now: Date.now,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      ...opts,
    };
    this.tokens = opts.burst;
    this.lastRefill = this.opts.now();
  }

  get inFlight() {
    return this.running;
  }
  get queued() {
    return this.queue.length;
  }
  queuedBy(priority: Priority) {
    return this.queue.filter((j) => j.priority === priority).length;
  }

  schedule<T>(run: () => Promise<T>, priority: Priority = "sync"): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        run,
        priority,
        seq: this.seq++,
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      this.pump();
    });
  }

  private refill() {
    const now = this.opts.now();
    const add = ((now - this.lastRefill) / 1000) * this.opts.ratePerSec;
    this.tokens = Math.min(this.opts.burst, this.tokens + add);
    this.lastRefill = now;
  }

  private next(): Job | undefined {
    let best = -1;
    for (let i = 0; i < this.queue.length; i++) {
      const j = this.queue[i];
      const b = best >= 0 ? this.queue[best] : undefined;
      if (
        !b ||
        ORDER[j.priority] < ORDER[b.priority] ||
        (ORDER[j.priority] === ORDER[b.priority] && j.seq < b.seq)
      )
        best = i;
    }
    return best >= 0 ? this.queue.splice(best, 1)[0] : undefined;
  }

  private pump() {
    this.refill();
    while (this.running < this.opts.concurrency && this.queue.length > 0) {
      if (this.tokens < 1) {
        if (!this.timerArmed) {
          this.timerArmed = true;
          const wait = Math.ceil(
            ((1 - this.tokens) / this.opts.ratePerSec) * 1000,
          );
          this.opts.setTimer(() => {
            this.timerArmed = false;
            this.pump();
          }, wait);
        }
        return;
      }
      const job = this.next();
      if (!job) return;
      this.tokens -= 1;
      this.running++;
      this.started[job.priority]++;
      job
        .run()
        .then(job.resolve, job.reject)
        .finally(() => {
          this.running--;
          this.pump();
        });
    }
  }
}
