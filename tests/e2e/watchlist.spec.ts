import { expect, test } from "@playwright/test";

const shots = process.env.E2E_SCREENSHOTS;

test("watch a lot, plan it, and follow it on the board", async ({
  page,
}, info) => {
  await page.goto("/browse?bids=some&sort=ending");
  const card = page
    .locator("main button h3")
    .nth(info.project.name === "phone" ? 1 : 2);
  const title = (await card.innerText()).trim();
  await card.click();
  const detail = page.locator("[aria-label='Lot details']");
  await expect(detail.getByRole("link", { name: /Bid on ABC/ })).toBeVisible({
    timeout: 15_000,
  });

  await detail.getByRole("button", { name: "Watch", exact: true }).click();
  await expect(
    detail.getByRole("button", { name: "Stop watching" }),
  ).toBeVisible();
  const plan = detail.getByRole("region", { name: "Your plan" });
  await expect(plan).toBeVisible({ timeout: 15_000 });

  // Without a linked bidder ID, status comes from the bid you enter (an estimate).
  const myBid = plan.getByRole("textbox", { name: "Your bid on ABC" });
  await myBid.fill("99999");
  await myBid.press("Enter");
  await expect(plan.getByText("Winning")).toBeVisible({ timeout: 10_000 });
  await myBid.fill("1");
  await myBid.press("Enter");
  await expect(plan.getByText("Outbid")).toBeVisible({ timeout: 10_000 });

  const max = plan.getByRole("textbox", { name: "Your max" });
  await max.fill("1");
  await max.press("Enter");
  await expect(plan.getByText(/is over your max/)).toBeVisible({
    timeout: 10_000,
  });
  await expect(plan.getByRole("button", { name: /that's me/ })).toBeVisible();

  await page.goto("/watchlist?tab=open");
  const row = page.getByRole("listitem").filter({ hasText: title });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row.getByText("Outbid")).toBeVisible();
  await expect(row.getByText("Over your max")).toBeVisible();
  await expect(row.getByRole("timer")).toBeVisible();
  await expect(row.getByRole("textbox", { name: "Your max" })).toHaveValue("1");
  await expect(
    page.getByRole("alert").filter({ hasText: /Outbid on \d+ lot/ }),
  ).toBeVisible();
  if (shots)
    await page.screenshot({
      path: `${shots}/watchlist-${info.project.name}.png`,
    });

  await row.getByRole("button", { name: `Stop watching ${title}` }).click();
  await expect(row).toHaveCount(0, { timeout: 10_000 });
});
