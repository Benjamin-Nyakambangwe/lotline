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
