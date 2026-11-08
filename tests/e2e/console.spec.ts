import { expect, test } from "@playwright/test";

// Catches hydration mismatches and Cache Components violations (URL or request data read
// outside <Suspense>), which only show up in the browser console.
test("main pages load without console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) =>
    errors.push(`pageerror: ${e.message.slice(0, 300)}`),
  );
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 300)}`);
  });
  for (const url of [
    "/dashboard",
    "/auctions",
    "/browse?q=chair",
    "/watchlist",
    "/assistant",
  ]) {
    await page.goto(url);
    await page.waitForLoadState("networkidle");
  }
  expect(errors).toEqual([]);
});
