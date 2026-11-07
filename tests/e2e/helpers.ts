import { readFileSync, statSync } from "node:fs";
import type { Page } from "@playwright/test";

const LOG = process.env.E2E_SERVER_LOG ?? "";

export const logOffset = () => (LOG ? statSync(LOG).size : 0);

/** Wait for the console-mode sign-in link for `email` printed after `offset`. */
export async function waitForMagicLink(
  email: string,
  offset: number,
  timeoutMs = 15_000,
): Promise<string> {
  if (!LOG) throw new Error("set E2E_SERVER_LOG to the server's log file");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // offset is in bytes (statSync), so slice the Buffer before decoding.
    const text = readFileSync(LOG).subarray(offset).toString("utf8");
    const m = new RegExp(
      `sign-in link for ${email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*(\\S+)`,
    ).exec(text);
    if (m) return m[1];
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no sign-in link for ${email} appeared in the server log`);
}

/** Sign in through the real sign-in form and the emailed (logged) magic link. */
export async function signInViaForm(page: Page, email: string) {
  await page.goto("/sign-in");
  const offset = logOffset();
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await page.getByText(/Check (the server terminal|your email)/).waitFor();
  await page.goto(await waitForMagicLink(email, offset));
  await page.waitForURL("**/dashboard");
}
