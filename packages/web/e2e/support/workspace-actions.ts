import { expect, type Page } from "@playwright/test";
import { en } from "../../src/i18n/en.ts";

// Follow the public drawer and row menu, just as a person does (ENG-11).
export async function openWorkspaces(page: Page) {
  const drawer = page.getByRole("dialog", { name: en["workspaces.heading"], exact: true });
  if (!(await drawer.isVisible())) {
    const menu = page.locator(".tool-menu");
    if (await menu.isVisible()) {
      // A submitted naming form closes asynchronously. Escape must reach More, rather than
      // dismissing only its child popover and leaving the menu over the drawer opener.
      await expect(menu.locator(".name-panel:popover-open")).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
    }
    await page.getByRole("button", { name: en["workspaces.heading"], exact: true }).click();
  }
  await expect(drawer).toBeVisible();
  return drawer;
}

export async function closeWorkspaces(page: Page) {
  const drawer = page.getByRole("dialog", { name: en["workspaces.heading"], exact: true });
  if (await drawer.isVisible())
    await drawer.getByRole("button", { name: en["workspaces.close"], exact: true }).click();
}

export async function clickWorkspaceAction(page: Page, name: string | RegExp) {
  const drawer = await openWorkspaces(page);
  const hidden = drawer.getByRole("button", { name, exact: true, includeHidden: true });
  if (!(await hidden.isVisible())) {
    await hidden.locator("xpath=ancestor::li").locator(".workspace-more").click();
  }
  await drawer.getByRole("button", { name, exact: true }).click();
}

export async function selectWorkspace(page: Page, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await clickWorkspaceAction(page, new RegExp(`^(Open ${escaped}|${escaped}, open)$`));
}

export async function openAppSection(page: Page, name: string) {
  await expect(page.locator(".empty, .app")).toBeVisible();
  if (await page.locator(".empty").isVisible()) {
    const label =
      name === en["nav.status"]
        ? en["setup.openStatus"]
        : name === en["nav.connections"]
          ? en["home.connections"]
          : name === en["nav.trash"]
            ? en["home.trash"]
            : name;
    await page.getByRole("button", { name: label, exact: true }).click();
    return;
  }
  if (name !== en["nav.workspaces"]) {
    const firstScreen = page.getByRole("button", { name, exact: true });
    if (await firstScreen.isVisible()) return firstScreen.click();
  }
  const drawer = await openWorkspaces(page);
  if (name === en["nav.workspaces"]) {
    const current = drawer.locator(".workspace-name[aria-current=true]");
    if (await current.count()) await current.click();
    else await drawer.getByRole("button", { name: en["workspaces.new"], exact: true }).click();
  } else {
    await drawer.getByRole("button", { name, exact: true }).click();
  }
}
