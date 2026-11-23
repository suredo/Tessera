import { expect, type Page } from "@playwright/test";
import { en } from "../../src/i18n/en.ts";
import { closeWorkspaces } from "./workspace-actions.ts";

// The same visible controls a person uses; no request markers or test-only host behavior (ENG-11).
export async function clickToolAction(page: Page, name: string) {
  await closeWorkspaces(page);
  const header = page.locator(".tool-header");
  await expect(header).toBeVisible();
  const direct = header.getByRole("button", { name, exact: true });
  if (await direct.isVisible()) return direct.click();
  const menu = page.locator(".tool-menu");
  if (!(await menu.isVisible()))
    await header.getByRole("button", { name: en["tool.more"] }).click();
  await menu.getByRole("button", { name, exact: true }).click();
}

export async function openToolHistory(page: Page) {
  await closeWorkspaces(page);
  // The header's History, or, on a narrow panel where it is in More, More's (e-mobile).
  if (!(await page.getByRole("region", { name: en["history.heading"] }).isVisible())) {
    await clickToolAction(page, en["history.heading"]);
  }
}

export async function openToolDetails(page: Page) {
  await closeWorkspaces(page);
  const show = page.getByRole("button", { name: en["details.show"], exact: true });
  if (await show.isVisible()) return show.click();
  if (await page.getByRole("region", { name: en["details.heading"] }).isVisible()) return;
  if (await page.getByRole("button", { name: en["tool.more"] }).isVisible()) {
    await clickToolAction(page, en["details.heading"]);
  } else {
    await page.getByRole("button", { name: en["details.show"] }).click();
  }
}
