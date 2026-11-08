import { expect, test } from "@playwright/test";

const shots = process.env.E2E_SCREENSHOTS;

// The test server runs the assistant in fake mode (scripts/with-test-db.mjs): a scripted
// stand-in for Claude that uses the real tools, database and streaming.
test("ask the assistant: it streams an answer with lot links and a watch to confirm", async ({
  page,
}, info) => {
  await page.goto("/assistant");
  await expect(
    page.getByRole("heading", { name: "Ask Lotline" }),
  ).toBeVisible();
  await expect(page.getByText(/left this month/)).toBeVisible({
    timeout: 15_000,
  });

  const box = page.getByRole("textbox", { name: "Ask Lotline" });
  await box.fill("Find me an OptiPlex");
  await box.press("Enter");

  const conversation = page.getByRole("list", { name: "Conversation" });
  await expect(conversation.getByText("Find me an OptiPlex")).toBeVisible();
  await expect(
    conversation.getByText(/Searching lots for “optiplex”/),
  ).toBeVisible({ timeout: 20_000 });
  const lotLink = conversation.getByRole("link", { name: /optiplex/i }).first();
  await expect(lotLink).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(/\?c=[0-9a-f-]{36}/);

  // A proposal: nothing happens until Confirm.
  const card = conversation
    .getByText("Watch this lot?")
    .locator("..")
    .locator("..");
  await expect(card).toBeVisible();
  await expect(conversation.getByText(/Tap Confirm/)).toBeVisible();
  if (shots)
    await page.screenshot({
      path: `${shots}/assistant-${info.project.name}.png`,
      fullPage: false,
    });
  await card.getByRole("button", { name: "Confirm" }).click();
  await expect(card.getByText("Done")).toBeVisible();

  // Lot links open the lot right here.
  await lotLink.click();
  await expect(page).toHaveURL(/lot=\d+/);
  await expect(page.getByRole("link", { name: /Bid on ABC/ })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "Close lot" }).click();

  // Reopening the conversation shows the same chat, with the action already done.
  const url = page.url();
  await page.goto(url);
  await expect(
    page
      .getByRole("list", { name: "Conversation" })
      .getByText("Find me an OptiPlex"),
  ).toBeVisible();
  await expect(page.getByText("Done")).toBeVisible();
});

test("a lot's Ask button opens the assistant with a question about it", async ({
  page,
}) => {
  await page.goto("/browse?q=optiplex");
  await page.locator("main button h3").first().click();
  await page
    .getByRole("button", { name: "Ask Lotline about this lot" })
    .click();
  const panel = page.locator("section[aria-label='Ask Lotline']");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("textbox", { name: "Ask Lotline" })).toHaveValue(
    /Is lot \d+ .* worth bidding on/,
  );
});

test("ask from anywhere: the floating button opens the chat in place, and it keeps going", async ({
  page,
}, info) => {
  await page.goto("/browse");
  const fab = page.getByRole("button", { name: "Ask Lotline" });
  await expect(fab).toBeVisible({ timeout: 15_000 });
  await fab.click();
  const panel = page.locator("section[aria-label='Ask Lotline']");
  await expect(panel).toBeVisible();
  // Never the whole screen on a phone (on wider screens it's a docked card).
  if (info.project.name === "phone") {
    const box = await panel.boundingBox();
    const vh = page.viewportSize()?.height ?? 0;
    expect(box?.height ?? 0).toBeLessThanOrEqual(vh * 0.7 + 2);
  }

  const input = panel.getByRole("textbox", { name: "Ask Lotline" });
  await input.fill("Find me an OptiPlex");
  await input.press("Enter");
  const link = panel.getByRole("link", { name: /optiplex/i }).first();
  await expect(link).toBeVisible({ timeout: 20_000 });
  if (process.env.E2E_SCREENSHOTS)
    await page.screenshot({
      path: `${process.env.E2E_SCREENSHOTS}/ask-panel-${info.project.name}.png`,
    });

  await link.click();
  await expect(page).toHaveURL(/lot=\d+/);
  if (info.project.name === "phone") {
    // The panel steps aside for the lot sheet; the conversation is still there.
    await expect(panel).toHaveCount(0);
    await page.getByRole("button", { name: "Close lot" }).click();
    await page.getByRole("button", { name: "Ask Lotline" }).click();
  }
  await expect(panel.getByText("Find me an OptiPlex")).toBeVisible();

  // Expand to the full page: same conversation.
  await panel.getByRole("link", { name: "Open full page" }).click();
  await expect(page).toHaveURL(/\/assistant\?c=[0-9a-f-]{36}/);
  await expect(
    page
      .getByRole("list", { name: "Conversation" })
      .getByText("Find me an OptiPlex"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Ask Lotline" })).toHaveCount(
    0,
  );
});
