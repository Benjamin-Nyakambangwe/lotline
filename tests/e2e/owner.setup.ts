import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { expect, test as setup } from "@playwright/test";
import { OWNER_STATE } from "../../playwright.config";
import { signInViaForm } from "./helpers";

const OWNER = process.env.E2E_OWNER_EMAIL ?? "owner@lotline.test";

setup("owner signs in through the sign-in form", async ({ page }) => {
  await signInViaForm(page, OWNER);
  await expect(
    page.getByRole("heading", { name: "Nothing on the line yet." }),
  ).toBeVisible();
  mkdirSync(dirname(OWNER_STATE), { recursive: true });
  await page.context().storageState({ path: OWNER_STATE });
});
