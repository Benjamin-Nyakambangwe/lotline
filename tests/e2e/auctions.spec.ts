import { expect, test } from "@playwright/test";

const shots = process.env.E2E_SCREENSHOTS;

test("auctions list every auction with a ticking countdown, and open into Browse", async ({
  page,
}, info) => {
  await page.goto("/auctions");
  await expect(
    page.getByRole("heading", { name: "Auctions", level: 1 }),
  ).toBeVisible();
  const cards = page.locator("main a[href^='/browse?auction=']");
  await expect(cards.first()).toBeVisible({ timeout: 20_000 });

  // The countdown visibly ticks (seconds change).
  const timer = cards.first().getByRole("timer");
  const before = await timer.innerText();
  await expect
    .poll(() => timer.innerText(), { timeout: 4_000 })
    .not.toBe(before);

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

  // Open an auction: Browse filtered to it, with its banner and countdown.
  const title = await cards.first().locator("h3").innerText();
  await cards.first().click();
  await expect(page).toHaveURL(/\/browse\?auction=/);
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
