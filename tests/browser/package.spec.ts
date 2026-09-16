import { expect, test } from "@playwright/test";

test("the built player package loads in plain HTML", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/examples/basic/");

  await expect(page.locator("#module-status")).toHaveText("Player package loaded.");
  expect(errors).toEqual([]);
});
