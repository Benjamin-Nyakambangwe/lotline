import { expect, test } from "@playwright/test";

const shots = process.env.E2E_SCREENSHOTS;
const countOf = async (page: import("@playwright/test").Page) =>
  Number(
    (await page.getByText(/^\d[\d,]* lots?/).innerText())
      .match(/^[\d,]+/)?.[0]
      .replace(/,/g, "") ?? Number.NaN,
  );

test("instant search tolerates typos and highlights matches", async ({
  page,
}, info) => {
  await page.goto("/browse");
  const box = page.getByRole("searchbox", { name: "Search lots" });
  await expect(page.getByText(/^\d[\d,]* lots/)).toBeVisible({
    timeout: 20_000,
  });
  await box.fill("optiplx");
  const first = page.locator("main button h3").first();
  await expect(first).toContainText(/optiplex/i);
  await expect(page.locator("main mark").first()).toBeVisible();
  await expect(page).toHaveURL(/q=optiplx/);
  if (shots)
    await page.screenshot({
      path: `${shots}/browse-search-${info.project.name}.png`,
    });
});

test("filters narrow results with live counts and live in the URL", async ({
  page,
}) => {
  await page.goto("/browse");
  await expect(page.getByText(/^\d[\d,]* lots/)).toBeVisible({
    timeout: 20_000,
  });
  const total = await countOf(page);
  await page.getByRole("button", { name: "Category" }).click();
  await page.getByRole("checkbox").first().click();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/category=/);
  await expect.poll(() => countOf(page)).toBeLessThan(total);
  expect(await countOf(page)).toBeGreaterThan(0);
});

test("opening a lot keeps the page usable (sheet ≤ 70% on phones)", async ({
  page,
}, info) => {
  await page.goto("/browse?q=optiplex");
  await page.locator("main button h3").first().click();
  await expect(page).toHaveURL(/lot=\d+/);
  const bid = page.getByRole("link", { name: /Bid on ABC/ });
  await expect(bid).toBeVisible({ timeout: 15_000 });
  await expect(bid).toHaveAttribute(
    "href",
    /app\.abcauctions\.co\.zw\/home\(dialog:lot\/\d+\/\d+\)/,
  );

  if (info.project.name === "phone") {
    const sheet = page.locator("section[aria-label='Lot details']");
    const box = await sheet.boundingBox();
    const vh = page.viewportSize()?.height ?? 0;
    expect(box?.height ?? 0).toBeLessThanOrEqual(vh * 0.7 + 1);
    // The board behind the sheet still scrolls.
    const before = await page.evaluate(() => window.scrollY);
    await page.mouse.move(10, 120);
    await page.mouse.wheel(0, 400);
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(before);
  } else {
    await expect(page.locator("aside[aria-label='Lot details']")).toBeVisible();
  }
  if (shots)
    await page.screenshot({
      path: `${shots}/browse-lot-${info.project.name}.png`,
    });

  await page.getByRole("button", { name: "Close lot" }).click();
  await expect(page).not.toHaveURL(/lot=/);
});

test("search from anywhere: the search button and ⌘K", async ({
  page,
}, info) => {
  await page.goto("/dashboard");
  const input = page.getByPlaceholder(/Search lots, paste an ABC link/);
  // Clicks before hydration do nothing (dev mode compiles pages on demand), so retry until it opens.
  await expect(async () => {
    await page
      .getByRole("button", { name: /Search lots/ })
      .filter({ visible: true })
      .first()
      .click();
    await expect(input).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await input.fill("chair");
  await expect(page.getByRole("option").first()).toBeVisible({
    timeout: 20_000,
  });
  if (shots)
    await page.screenshot({
      path: `${shots}/command-${info.project.name}.png`,
    });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/dashboard\?lot=\d+/);
  await expect(page.getByRole("link", { name: /Bid on ABC/ })).toBeVisible({
    timeout: 15_000,
  });

  // Now that the page is interactive, the keyboard shortcut opens it too.
  await page.getByRole("button", { name: "Close lot" }).click();
  await page.keyboard.press("Control+k");
  await expect(input).toBeVisible();
});

test("a lot has a full page too", async ({ page }) => {
  await page.goto("/browse?q=optiplex");
  await page.locator("main button h3").first().click();
  await page.getByRole("link", { name: "Open full page" }).click();
  await expect(page).toHaveURL(/\/lots\/\d+$/);
  await expect(
    page.locator("main").getByRole("heading", { level: 2 }),
  ).toContainText(/optiplex/i);
});

test("cards lead with a big photo you can swipe through", async ({
  page,
}, info) => {
  await page.goto("/browse?q=chair");
  const carousel = page
    .locator("main section[aria-roledescription='carousel']")
    .filter({ hasText: /^.*\/\d+/ })
    .first();
  await expect(carousel).toBeVisible({ timeout: 20_000 });
  const counter = carousel.getByText(/^1\/\d+$/);
  await expect(counter).toBeVisible();
  const box = await carousel.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThan(150); // prominent, not a thumbnail

  if (info.project.name === "phone") {
    // Swipe: scroll the track one photo along.
    await carousel
      .locator("div.snap-x")
      .evaluate((el) => el.scrollTo({ left: el.clientWidth }));
  } else {
    await carousel.hover();
    await carousel.getByRole("button", { name: "Next photo" }).click();
  }
  await expect(carousel.getByText(/^2\/\d+$/)).toBeVisible();
  // The rest of the gallery arrived and the second photo rendered.
  const second = carousel.locator("img").nth(1);
  await expect(second).toBeVisible({ timeout: 10_000 });
  await expect
    .poll(
      () =>
        second.evaluate(
          (img: HTMLImageElement) => img.complete && img.naturalWidth,
        ),
      {
        timeout: 20_000,
      },
    )
    .toBeGreaterThan(0);
  if (process.env.E2E_SCREENSHOTS)
    await page.screenshot({
      path: `${process.env.E2E_SCREENSHOTS}/cards-${info.project.name}.png`,
    });

  // Tapping the photo opens the lot, which shows its photos large too.
  await carousel.locator("img").nth(1).click();
  await expect(page).toHaveURL(/lot=\d+/);
  await expect(
    page.locator(
      "[aria-label='Lot details'] section[aria-roledescription='carousel']",
    ),
  ).toBeVisible({ timeout: 15_000 });
});
