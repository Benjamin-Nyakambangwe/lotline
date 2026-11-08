import { expect, test } from "@playwright/test";

test("the app is installable: manifest, service worker and icons are public", async ({
  browser,
}) => {
  // A fresh context with no session: phones fetch these before anyone signs in.
  const ctx = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const req = ctx.request;
  const manifest = await req.get("/manifest.webmanifest");
  expect(manifest.status()).toBe(200);
  const m = await manifest.json();
  expect(m).toMatchObject({
    name: "Lotline",
    display: "standalone",
    start_url: "/watchlist",
  });
  expect(
    m.icons.some((i: { purpose: string }) => i.purpose === "maskable"),
  ).toBe(true);
  const sw = await req.get("/sw.js");
  expect(sw.status()).toBe(200);
  expect(await sw.text()).toContain('addEventListener("push"');
  for (const icon of [
    "/icons/icon-192.png",
    "/icons/apple-touch-icon.png",
    "/icons/badge-96.png",
  ]) {
    const r = await req.get(icon);
    expect(r.status(), icon).toBe(200);
    expect(r.headers()["content-type"]).toBe("image/png");
  }
  await ctx.close();
});

test("settings: alerts on this device, the bidder link, and how to install", async ({
  page,
}) => {
  await page.goto("/settings");
  await expect(
    page.getByRole("heading", { name: "Alerts on this device" }),
  ).toBeVisible();
  // The test server has no VAPID keys: it says so instead of offering a switch that can't work.
  await expect(
    page.getByText(/aren't set up on the server yet|can't receive alerts/),
  ).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.getByRole("heading", { name: "Your ABC bidder number" }),
  ).toBeVisible();
  await expect(page.getByText(/Not linked|is linked/)).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.getByRole("heading", { name: "Install Lotline" }),
  ).toBeVisible();
});

test("sign the Home Screen app in by pasting a one-time link from a signed-in browser", async ({
  browser,
  page,
  context,
}, info) => {
  test.skip(
    info.project.name !== "desktop",
    "clipboard permissions: run once, on desktop",
  );
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/settings");
  await page
    .getByRole("button", { name: "Copy sign-in link for the app" })
    .click();
  await expect(
    page.getByText(/Copied\. Open Lotline from your Home Screen/),
  ).toBeVisible();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(/\/api\/auth\/magic-link\/verify\?token=/);

  // The "app": a separate browser with no cookies of its own.
  const app = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const p = await app.newPage();
  await p.goto("/sign-in");
  const paste = p.getByLabel("Have a sign-in or invite link? Paste it here");
  await paste.fill("https://evil.example/api/auth/magic-link/verify?token=abc");
  await p.getByRole("button", { name: "Open", exact: true }).click();
  await expect(
    p.getByText("That isn't a Lotline sign-in or invite link."),
  ).toBeVisible();

  await paste.fill(link);
  await p.getByRole("button", { name: "Open", exact: true }).click();
  await p.waitForURL("**/watchlist");
  await expect(p.getByRole("heading", { name: "Watchlist" })).toBeVisible();

  // Used once: the same link doesn't work again.
  const again = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const q = await again.newPage();
  await q.goto(link);
  await expect(q).not.toHaveURL(/\/watchlist$/);
  await app.close();
  await again.close();
});
