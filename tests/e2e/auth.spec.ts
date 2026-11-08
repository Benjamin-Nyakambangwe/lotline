import { expect, test } from "@playwright/test";

const shots = process.env.E2E_SCREENSHOTS;
const signedOut = { cookies: [], origins: [] };

test.describe("signed out", () => {
  test.use({ storageState: signedOut });

  test("visitors land on sign-in", async ({ page }, info) => {
    await page.goto("/watchlist");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fwatchlist/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(
      page.getByText("Not affiliated with ABC Auctions"),
    ).toBeVisible();
    if (shots)
      await page.screenshot({
        path: `${shots}/sign-in-${info.project.name}.png`,
        fullPage: true,
      });
  });

  test("APIs refuse anonymous requests", async ({ request }) => {
    expect((await request.get("/api/live")).status()).toBe(401);
  });
});

test("the owner sees the dashboard and the admin area", async ({
  page,
}, info) => {
  await page.goto("/dashboard");
  await expect(
    page.getByRole("region", { name: "Your numbers" }),
  ).toBeVisible();
  if (shots)
    await page.screenshot({
      path: `${shots}/dashboard-${info.project.name}.png`,
      fullPage: true,
    });

  if (info.project.name === "desktop") {
    await expect(page.getByRole("link", { name: "Admin" })).toBeVisible();
  } else {
    await page.getByRole("button", { name: "More" }).click();
    await expect(page.getByRole("menuitem", { name: "Admin" })).toBeVisible();
    await page.keyboard.press("Escape");
  }
  await page.goto("/admin/invites");
  await expect(page.getByRole("heading", { name: "People" })).toBeVisible();
});

test("an invited friend joins through their link, once, as a member", async ({
  page,
  browser,
}, info) => {
  const friend = `friend-${info.project.name}-${Date.now()}@lotline.test`;
  await page.goto("/admin/invites");
  await page.getByLabel("Email").fill(friend);
  await page.getByRole("button", { name: "Create link" }).click();
  const link = page.locator("input[readonly]");
  await expect(link).toHaveValue(/\/invite\//);
  const url = await link.inputValue();
  if (shots)
    await page.screenshot({
      path: `${shots}/invites-${info.project.name}.png`,
      fullPage: true,
    });

  // The friend opens the link in their own (signed-out) browser, in light mode.
  const ctx = await browser.newContext({
    ...info.project.use,
    storageState: signedOut,
    colorScheme: "light",
  });
  const p2 = await ctx.newPage();
  await p2.goto(url);
  await expect(p2.getByText(`Signing in as ${friend}`)).toBeVisible();
  await p2.getByRole("button", { name: "Continue" }).click();
  await p2.waitForURL("**/dashboard");
  await expect(p2.getByRole("region", { name: "Your numbers" })).toBeVisible();
  if (shots)
    await p2.screenshot({
      path: `${shots}/dashboard-light-${info.project.name}.png`,
      fullPage: true,
    });

  // Members don't get the admin area.
  await p2.goto("/admin/invites");
  await expect(p2).toHaveURL(/\/dashboard$/);

  // The link only works once.
  const ctx3 = await browser.newContext({ storageState: signedOut });
  const p3 = await ctx3.newPage();
  await p3.goto(url);
  await expect(
    p3.getByRole("heading", { name: "This link no longer works" }),
  ).toBeVisible();
  await ctx.close();
  await ctx3.close();
});
