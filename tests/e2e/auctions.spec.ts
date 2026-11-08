import { expect, test } from "@playwright/test";

const shots = process.env.E2E_SCREENSHOTS;

test("auctions show as picture cards with when they close, closed ones on request, and open into Browse", async ({
  page,
}, info) => {
  await page.goto("/auctions");
  await expect(
    page.getByRole("heading", { name: "Auctions", level: 1 }),
  ).toBeVisible();
  const cards = page.locator("main a[href^='/browse?auction=']");
  await expect(cards.first()).toBeVisible({ timeout: 20_000 });

  // A cover picture, when it closes, no countdown.
  const first = cards.first();
  await expect(first.locator("img").first()).toBeVisible();
  // While an auction closes, the pill and the line both say "Closing now".
  await expect(first.getByText(/Closes |Closing now/).first()).toBeVisible();
  await expect(first.getByRole("timer")).toHaveCount(0);
  if (shots)
    await page.screenshot({
      path: `${shots}/auctions-${info.project.name}.png`,
      fullPage: info.project.name === "phone",
    });

  // Location switch narrows the list and is remembered.
  const all = await cards.count();
  await page.getByRole("button", { name: /^Bulawayo/ }).click();
  await expect.poll(() => cards.count()).toBeLessThan(all);
  await page.reload();
  await expect(page.getByRole("button", { name: /^Bulawayo/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: /^All/ }).click();

  // Closed auctions are hidden until asked for.
  const toggle = page.getByRole("button", { name: /Show closed auctions/ });
  if (await toggle.isVisible()) {
    await expect(
      page.getByRole("heading", { name: /Closed in the last 30 days/ }),
    ).toHaveCount(0);
    await toggle.click();
    await expect(
      page.getByRole("heading", { name: /Closed in the last 30 days/ }),
    ).toBeVisible();
    await expect(
      page
        .locator("main a[href^='https://app.abcauctions.co.zw/search']")
        .first(),
    ).toBeVisible();
    await page.getByRole("button", { name: "Hide closed auctions" }).click();
  }

  // Open an auction: Browse filtered to it, with its banner and countdown.
  const title = await first.locator("h3").innerText();
  await first.click();
  // Dev mode compiles /browse on first visit: allow for it.
  await expect(page).toHaveURL(/\/browse\?auction=/, { timeout: 20_000 });
  const banner = page.locator("section[aria-label='Auction']");
  await expect(banner).toContainText(title, { timeout: 20_000 });
  await expect(banner.getByRole("timer")).toBeVisible();
  await expect(page.locator("main button h3").first()).toBeVisible();
  if (shots)
    await page.screenshot({
      path: `${shots}/auction-browse-${info.project.name}.png`,
    });
});

test("browse cards show a countdown pill with the closing time", async ({
  page,
}, info) => {
  await page.goto("/browse");
  await expect(page.getByText(/^\d[\d,]* lots/)).toBeVisible({
    timeout: 20_000,
  });
  const card = page.locator("main button:has(h3)").first();
  await expect(card.getByRole("timer")).toBeVisible();
  await expect(card).toContainText(
    /closes (today|tomorrow|\w{3} \d+ \w{3}) \d\d:\d\d/,
  );
  await card.click();
  const detail = page.locator("[aria-label='Lot details']");
  await expect(detail.getByText("Closes in")).toBeVisible({ timeout: 15_000 });
  await expect(
    detail.getByRole("link", { name: /[A-Z]{2,5}#\d+/ }),
  ).toBeVisible();
  if (shots)
    await page.screenshot({
      path: `${shots}/browse-cards-${info.project.name}.png`,
    });
});
