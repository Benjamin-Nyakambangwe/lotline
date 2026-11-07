import { Client } from "pg";

/**
 * Only one worker may poll ABC. Leadership is a Postgres advisory lock held on a dedicated
 * connection: if that connection drops, the lock is gone and the worker must stop at once.
 * A standby retries every few seconds and takes over within one retry interval.
 */
export class Leader {
  private client: Client | null = null;
  private held = false;

  constructor(
    private readonly url: string,
    private readonly key = "lotline-worker",
  ) {}

  get isLeader() {
    return this.held;
  }

  /** Try once to become leader. */
  async tryAcquire(): Promise<boolean> {
    try {
      if (!this.client) {
        this.client = new Client({
          connectionString: this.url,
          application_name: "lotline-worker-lock",
        });
        this.client.on("error", () => this.drop());
        await this.client.connect();
      }
      const r = await this.client.query<{ ok: boolean }>(
        "select pg_try_advisory_lock(hashtext($1)) as ok",
        [this.key],
      );
      this.held = r.rows[0]?.ok === true;
      return this.held;
    } catch {
      await this.drop();
      return false;
    }
  }

  /** Is the lock connection still alive? If not, leadership is lost. */
  async check(): Promise<boolean> {
    if (!this.held || !this.client) return false;
    try {
      await this.client.query("select 1");
      return true;
    } catch {
      await this.drop();
      return false;
    }
  }

  async release() {
    if (this.client && this.held) {
      try {
        await this.client.query("select pg_advisory_unlock(hashtext($1))", [
          this.key,
        ]);
      } catch {
        // connection already gone: the lock went with it
      }
    }
    await this.drop();
  }

  private async drop() {
    this.held = false;
    const c = this.client;
    this.client = null;
    if (c) await c.end().catch(() => {});
  }
}
