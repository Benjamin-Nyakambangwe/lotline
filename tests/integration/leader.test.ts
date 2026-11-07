import { describe, expect, it } from "vitest";
import { Leader } from "@/worker/leader";

// Advisory locks need a real Postgres with two connections. Runs only against the throwaway
// test database: `node scripts/with-test-db.mjs npx vitest run tests/integration/leader.test.ts`
const url = process.env.DATABASE_URL ?? "";
const enabled = /\/lotline_test(\?|$)/.test(url);

describe.skipIf(!enabled)("worker leadership (real Postgres)", () => {
  it("lets exactly one worker lead, and hands over when it lets go", async () => {
    const key = `lotline-test-${Date.now()}`;
    const a = new Leader(url, key);
    const b = new Leader(url, key);
    try {
      expect(await a.tryAcquire()).toBe(true);
      expect(await b.tryAcquire()).toBe(false);
      expect(await a.check()).toBe(true);
      await a.release();
      expect(a.isLeader).toBe(false);
      expect(await b.tryAcquire()).toBe(true);
    } finally {
      await a.release();
      await b.release();
    }
  });
});
