import { expect, test } from "@playwright/test";
import { withTestDb } from "./helpers";

const shots = process.env.E2E_SCREENSHOTS;

// An auction night: 40 watched lots closing over the next half hour, 20 s apart. Some the
// owner leads, some they're outbid on, a few extended by late bids, the rest just watched.
async function seedTonight() {
  return withTestDb(async (q) => {
    const [owner] = await q(
      `select id from "user" where email = 'owner@lotline.test'`,
    );
    await q(`delete from user_lots where user_id = $1`, [owner.id]);
    const lots = await q(
      `select id, current_bid from lots where status = 1 and current_bid is not null and campaign_id is not null order by id limit 40`,
    );
    for (const [i, l] of lots.entries()) {
      const extended = i % 9 === 4;
      await q(
        `update lots set end_at = now() + make_interval(secs => $2), original_end_at = now() + make_interval(secs => $3), final_state = 'open' where id = $1`,
        [
          l.id,
          25 * 60 + i * 20,
          extended ? 25 * 60 + i * 20 - 240 : 25 * 60 + i * 20,
        ],
      );
      const myBid =
        i % 3 === 0 ? Number(l.current_bid) + 100 : i % 3 === 1 ? 1 : null;
      await q(
        `insert into user_lots (user_id, lot_id, watching, my_bid) values ($1, $2, true, $3)`,
        [owner.id, l.id, myBid],
      );
    }
    return lots.length;
  });
}

test.describe.configure({ mode: "serial" });

test("the dashboard leads with the next close, counts match the board, and tonight fits a phone", async ({
  page,
}, info) => {
  const n = await seedTonight();
  expect(n).toBe(40);
  await page.goto("/dashboard");

  const hero = page.getByRole("region", { name: "Next to close" });
  await expect(hero).toBeVisible({ timeout: 20_000 });
  await expect(hero.getByRole("timer")).toHaveText(/\d+:\d\d/);

  const tile = (label: string) =>
    page
      .getByRole("region", { name: "Your numbers" })
      .getByRole("link")
      .filter({ hasText: label });
  await expect(tile("Winning")).toContainText(/\d+/);
  const winning = Number(
    (await tile("Winning").locator("p").nth(1).innerText()).trim(),
  );
  const outbid = Number(
    (await tile("Outbid").locator("p").nth(1).innerText()).trim(),
  );
  const soon = Number(
    (
      await tile("Closing within an hour").locator("p").nth(1).innerText()
    ).trim(),
  );
  expect(winning).toBeGreaterThan(0);
  expect(outbid).toBeGreaterThan(0);
  expect(soon).toBe(40);

  // Tonight: every lot is on the timeline, with a legend; the page never scrolls sideways.
  const tonight = page.getByRole("region", { name: /Tonight/ });
  await expect(tonight).toBeVisible();
  await expect(
    tonight.getByRole("button", { name: /closes \d\d:\d\d/ }),
  ).toHaveCount(40);
  await expect(tonight.getByRole("list", { name: "Legend" })).toContainText(
    "Winning",
  );
  await expect(tonight.getByRole("list", { name: "Legend" })).toContainText(
    "Extended",
  );
  // Compare with the device's own width: Android Chrome widens its layout viewport to fit
  // content that's too wide, so innerWidth alone can't catch overflow.
  const deviceWidth = page.viewportSize()?.width ?? 0;
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(deviceWidth);
  if (shots)
    await page.screenshot({
      path: `${shots}/dashboard-${info.project.name}.png`,
      fullPage: true,
    });

  // Hovering (or focusing) a lot says what it is.
  await tonight
    .getByRole("button", { name: /closes/ })
    .first()
    .focus();
  await expect(page.getByRole("tooltip")).toBeVisible();

  // The same counts as the Watchlist board.
  await page.goto("/watchlist?tab=open");
  const rows = page
    .getByRole("list", { name: "Watched lots" })
    .getByRole("listitem");
  await expect(rows).toHaveCount(40, { timeout: 15_000 });
  await expect(rows.filter({ hasText: "Winning" })).toHaveCount(winning);
  await expect(rows.filter({ hasText: "Outbid" })).toHaveCount(outbid);
});

test.afterAll(async () => {
  await withTestDb(async (q) => {
    await q(
      `delete from user_lots where user_id = (select id from "user" where email = 'owner@lotline.test')`,
    );
  });
});
