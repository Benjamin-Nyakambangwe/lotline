import type { Logger } from "./log";

export interface LoopSpec {
  name: string;
  /** delay before the first run */
  initialDelayMs?: number;
  /** run once; return the delay until the next run (ms) */
  run: () => Promise<number>;
  /** delay after a failed run */
  errorDelayMs?: number;
}

/**
 * Independent self-scheduling loops. Each loop never overlaps itself; stop() waits for
 * in-flight runs so leadership can be handed over cleanly.
 */
export class Loops {
  private active = false;
  private timers = new Map<string, NodeJS.Timeout>();
  private running = new Map<string, Promise<void>>();
  private wakers = new Map<string, () => void>();

  constructor(
    private readonly specs: LoopSpec[],
    private readonly log: Logger,
  ) {}

  start() {
    if (this.active) return;
    this.active = true;
    for (const s of this.specs) this.schedule(s, s.initialDelayMs ?? 0);
  }

  /** Run a loop now instead of waiting for its timer (e.g. on a NOTIFY). */
  wake(name: string) {
    this.wakers.get(name)?.();
  }

  async stop() {
    this.active = false;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.wakers.clear();
    await Promise.allSettled([...this.running.values()]);
  }

  private schedule(s: LoopSpec, delay: number) {
    if (!this.active) return;
    const fire = () => {
      this.timers.delete(s.name);
      this.wakers.delete(s.name);
      if (!this.active || this.running.has(s.name)) return;
      const p = (async () => {
        let next = s.errorDelayMs ?? 60_000;
        try {
          next = await s.run();
        } catch (e) {
          this.log.warn(
            { loop: s.name, err: String((e as Error).message).slice(0, 300) },
            "loop run failed",
          );
        } finally {
          this.running.delete(s.name);
        }
        this.schedule(s, next);
      })();
      this.running.set(s.name, p);
    };
    const t = setTimeout(fire, Math.max(0, delay));
    this.timers.set(s.name, t);
    this.wakers.set(s.name, () => {
      clearTimeout(t);
      fire();
    });
  }
}
