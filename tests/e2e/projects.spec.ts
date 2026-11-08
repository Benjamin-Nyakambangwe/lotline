import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { withTestDb } from "./helpers";

const shots = process.env.E2E_SCREENSHOTS;

test("plan a project: a need, backups in order, maxes, budget flags, CSV, delete", async ({
  page,
}, info) => {
  const name = `Homelab ${info.project.name} ${Date.now() % 100_000}`;
  const errors: string[] = [];
  page.on("pageerror", (e) =>
    errors.push(`pageerror: ${e.message.slice(0, 400)}`),
  );
  page.on("console", (m) => {
    if (m.type() === "error")
      errors.push(`console: ${m.text().slice(0, 1500)}`);
  });
  await page.goto("/projects");
  // Let hydration finish: a modal opened mid-hydration marks unhydrated siblings aria-hidden.
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "New project" }).click();
  const create = page.getByRole("dialog", { name: "New project" });
  await create.getByLabel("Name").fill(name);
  await create.getByLabel("Budget, all-in (optional)").fill("300");
  await create.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/, {
    timeout: 20_000,
  });
  await expect(page.getByRole("heading", { level: 1 })).toContainText(name);

  // A need, with its max given as an all-in figure and snapped to ABC's bid steps.
  const form = page.getByRole("form", { name: "Add a need" });
  await form.getByLabel("What you need").fill("Mini PC");
  await form.getByLabel("How many").fill("2");
  await form.getByLabel("Max per lot (optional)").fill("60");
  await form.getByLabel("Max is").selectOption("allin");
  await expect(form.getByText("= $45 hammer · $54.10 all-in")).toBeVisible();
  await form.getByRole("button", { name: "Add need" }).click();
  const need = page.getByRole("article", { name: "Mini PC" });
  await expect(
    need.getByText(/0 of 2 filled · max \$45 \(\$54\.10/),
  ).toBeVisible({
    timeout: 10_000,
  });

  // Bulk add from the picker: lots further down the closing order, so none close mid-test.
  await need.getByRole("button", { name: "Add lots" }).click();
  const picker = page.getByRole("dialog", { name: "Add lots to Mini PC" });
  await picker.getByRole("searchbox", { name: "Search lots to add" }).fill("");
  const boxes = picker.getByRole("checkbox");
  await expect(boxes.nth(40)).toBeVisible({ timeout: 20_000 });
  for (const i of [30, 31, 32]) await boxes.nth(i).click();
  await expect(picker.getByText("3 selected")).toBeVisible();
  if (shots)
    await page.screenshot({ path: `${shots}/picker-${info.project.name}.png` });
  await picker.getByRole("button", { name: "Add 3 lots" }).click();
  await expect(picker).toBeHidden();

  const rows = need
    .getByRole("list", { name: "Lots for Mini PC" })
    .getByRole("listitem");
  await expect(rows).toHaveCount(3, { timeout: 10_000 });
  const titleOf = async (i: number) =>
    (
      await rows
        .nth(i)
        .getByRole("button", { name: /^Open / })
        .getAttribute("aria-label")
    )?.slice(5) ?? "";
  const [a, b, c] = [await titleOf(0), await titleOf(1), await titleOf(2)];
  const order = async () => [
    await titleOf(0),
    await titleOf(1),
    await titleOf(2),
  ];

  // Reorder: down, then make the last one primary.
  await rows.nth(0).getByRole("button", { name: "Move down" }).click();
  await expect.poll(order, { timeout: 10_000 }).toEqual([b, a, c]);
  await rows
    .nth(2)
    .getByRole("button", { name: `More for ${c}` })
    .click();
  await page.getByRole("menuitem", { name: "Make primary" }).click();
  await expect.poll(order, { timeout: 10_000 }).toEqual([c, b, a]);
  await expect(rows.nth(0).getByTitle("Primary")).toBeVisible();

  // A high max of its own on the primary puts the worst case over the $300 budget.
  const max = rows.nth(0).getByRole("textbox", { name: "Max (the need's)" });
  await max.fill("99999");
  await max.press("Enter");
  await expect(
    rows.nth(0).getByRole("textbox", { name: "Max for this lot" }),
  ).toHaveValue(/99,?999/, {
    timeout: 10_000,
  });
  await expect(rows.nth(0).getByText("In worst case")).toBeVisible();
  const budget = page.getByRole("region", { name: "Budget" });
  await expect(budget.getByText("Over budget", { exact: true })).toBeVisible();
  await expect(budget.getByText(/^Over by/)).toBeVisible();

  // Skip a backup.
  await rows
    .nth(1)
    .getByRole("button", { name: `More for ${b}` })
    .click();
  await page.getByRole("menuitem", { name: "Skip it" }).click();
  await expect(rows.nth(1).getByText("Skipped", { exact: true })).toBeVisible({
    timeout: 10_000,
  });
  if (shots)
    await page.screenshot({
      path: `${shots}/project-${info.project.name}.png`,
      fullPage: true,
    });

  expect(errors).toEqual([]);

  // CSV export.
  await page.getByRole("button", { name: "Project options" }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: "Export CSV" }).click(),
  ]);
  const csv = readFileSync((await download.path()) as string, "utf8");
  expect(csv.split("\n")[0]).toMatch(/Need/);
  expect(csv).toContain("Mini PC");
  expect(csv).toContain(c.replaceAll('"', '""'));

  // The lots joined the watchlist too.
  const lotIds = await withTestDb(async (q) =>
    (
      await q(
        `select pc.lot_id from project_candidates pc join project_needs n on n.id = pc.need_id
         join projects p on p.id = n.project_id where p.name = $1`,
        [name],
      )
    ).map((r) => Number(r.lot_id)),
  );
  expect(lotIds).toHaveLength(3);

  // Delete, then tidy the watchlist rows this test added.
  await page.getByRole("button", { name: "Project options" }).click();
  await page.getByRole("menuitem", { name: "Delete project" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(page).toHaveURL(/\/projects$/, { timeout: 20_000 });
  await expect(page.getByRole("link", { name: new RegExp(name) })).toHaveCount(
    0,
  );
  await withTestDb((q) =>
    q(
      `delete from user_lots where lot_id = any($1::int[])
         and user_id = (select id from "user" where email = 'owner@lotline.test')`,
      [lotIds],
    ),
  );
});

test("add a lot to a project from its page", async ({ page }, info) => {
  const name = `Lot page ${info.project.name} ${Date.now() % 100_000}`;
  const ids = await withTestDb(async (q) => {
    const [u] = await q(
      `select id from "user" where email = 'owner@lotline.test'`,
    );
    const [p] = await q(
      `insert into projects (user_id, name, budget_all_in) values ($1, $2, 200) returning id`,
      [u.id, name],
    );
    await q(
      `insert into project_needs (project_id, title, quantity, sort) values ($1, 'Switch', 1, 1)`,
      [p.id],
    );
    const [lot] = await q(
      `select id from lots where status = 1 and end_at > now() + interval '2 hours' and end_at < now() + interval '1 year' order by end_at limit 1`,
    );
    return {
      project: p.id as string,
      lot: Number(lot.id),
      user: u.id as string,
    };
  });
  await page.goto(`/browse?lot=${ids.lot}`);
  const detail = page.locator("[aria-label='Lot details']");
  await detail.getByRole("button", { name: "Add to a project" }).click();
  await page.getByRole("menuitem", { name: "Switch" }).click();
  await expect(page.getByText(`Added to ${name}: Switch`)).toBeVisible({
    timeout: 10_000,
  });

  await page.goto(`/projects/${ids.project}`);
  const rows = page
    .getByRole("list", { name: "Lots for Switch" })
    .getByRole("listitem");
  await expect(rows).toHaveCount(1, { timeout: 15_000 });
  if (shots) {
    await page.goto("/projects");
    await expect(
      page.getByRole("link", { name: new RegExp(name) }),
    ).toBeVisible();
    await page.screenshot({
      path: `${shots}/projects-${info.project.name}.png`,
    });
  }
  await withTestDb(async (q) => {
    await q(`delete from projects where id = $1`, [ids.project]);
    await q(`delete from user_lots where lot_id = $1 and user_id = $2`, [
      ids.lot,
      ids.user,
    ]);
  });
});
