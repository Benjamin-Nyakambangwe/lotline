/**
 * Circuit breaker for ABC. Opens after `consecutive` failures in a row, or when more than
 * `failureRate` of at least `minSamples` requests in the last `windowMs` failed. While open,
 * requests are refused; after `openMs` one probe is allowed (half-open) and its result
 * decides whether to close again.
 */
export type BreakerState = "closed" | "open" | "half-open";

export interface BreakerOptions {
  consecutive?: number;
  failureRate?: number;
  minSamples?: number;
  windowMs?: number;
  openMs?: number;
  now?: () => number;
}

export class Breaker {
  private readonly o: Required<BreakerOptions>;
  private _state: BreakerState = "closed";
  private openedAt = 0;
  private consecutiveFailures = 0;
  private probing = false;
  private samples: { at: number; ok: boolean }[] = [];

  constructor(opts: BreakerOptions = {}) {
    this.o = {
      consecutive: 5,
      failureRate: 0.5,
      minSamples: 10,
      windowMs: 60_000,
      openMs: 60_000,
      now: Date.now,
      ...opts,
    };
  }

  get state(): BreakerState {
    if (this._state === "open" && this.o.now() - this.openedAt >= this.o.openMs)
      return "half-open";
    return this._state;
  }

  /** May a request go out now? In half-open, only one probe at a time. */
  canRequest(): boolean {
    const s = this.state;
    if (s === "closed") return true;
    if (s === "open") return false;
    if (this.probing) return false;
    this._state = "half-open";
    this.probing = true;
    return true;
  }

  onSuccess() {
    this.record(true);
    this.consecutiveFailures = 0;
    if (this._state !== "closed") {
      this._state = "closed";
      this.probing = false;
      this.samples = [];
    }
  }

  onFailure() {
    this.record(false);
    this.consecutiveFailures++;
    if (this._state === "half-open") return this.open();
    const recent = this.samples;
    const failed = recent.filter((s) => !s.ok).length;
    if (
      this.consecutiveFailures >= this.o.consecutive ||
      (recent.length >= this.o.minSamples &&
        failed / recent.length > this.o.failureRate)
    ) {
      this.open();
    }
  }

  private open() {
    this._state = "open";
    this.openedAt = this.o.now();
    this.probing = false;
  }

  private record(ok: boolean) {
    const now = this.o.now();
    this.samples.push({ at: now, ok });
    this.samples = this.samples.filter((s) => now - s.at <= this.o.windowMs);
  }
}
