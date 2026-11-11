import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function readLibrary(page) {
  return page.evaluate(async () => {
    const { Store } = await import("./storage.mjs");
    return new Store().read();
  });
}

async function start(page) {
  await page.goto("./");
  await expect(page.locator("#title")).toBeEnabled();
}

async function initiative(page, name = "Example learning") {
  await page.locator("#add-initiative").click();
  await page.locator("#initiative-name").fill(name);
  await page.getByRole("button", { name: "Create initiative", exact: true }).click();
  await expect(page.locator("#initiative-dialog")).not.toBeVisible();
  await expect(page.locator("#initiativeId")).not.toHaveValue("");
}

async function save(page, title = "Example link") {
  await page.locator("#title").fill(title);
  await page.locator("#save-link").click();
  await expect(page.locator("#saved-actions")).toBeVisible();
  await expect(page.locator("#save-link")).toBeDisabled();
  await expect(page.locator("#notice")).toContainText("Saved");
}

async function download(page, id) {
  const pending = page.waitForEvent("download");
  await page.locator(id).click();
  const result = await pending;
  const content = await readFile(await result.path(), "utf8");
  return { content, filename: result.suggestedFilename() };
}

async function chooseBackup(page, data) {
  await page.locator("#backup-file").setInputFiles({
    name: "example-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(typeof data === "string" ? data : JSON.stringify(data)),
  });
}

test("first link, presets, validation, QR, copy, inventory, CSV and reload stay local", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await start(page);
  expect((await readLibrary(page)).links).toEqual([]);
  expect((await readLibrary(page)).initiatives).toEqual([]);
  const requests = [];
  page.on("request", (request) => {
    if (!request.url().startsWith("blob:")) requests.push({ url: request.url(), method: request.method() });
  });
  await initiative(page);
  for (const [preset, source, medium] of [["email", "newsletter", "email"], ["qr", "event", "qr"], ["event", "event", "event"], ["social", "linkedin", "social"], ["learning_path", "learning_path", "learning_path"], ["partner", "partner", "referral"]]) {
    await page.locator(`[data-preset="${preset}"]`).click();
    await expect(page.locator("#source")).toHaveValue(source);
    await expect(page.locator("#medium")).toHaveValue(medium);
  }
  await page.locator("#title").fill('<img src=x onerror=alert(1)>');
  for (const destination of ["http://example.com/", "https://user:password@portal.github.partners/", "https://portal.github.partners:8443/"]) {
    await page.locator("#destination").fill(destination);
    await page.locator("#save-link").click();
    await expect(page.locator("#error")).toContainText("Destination must use HTTPS, without credentials or a nondefault port.");
    await expect(page.locator("#save-link")).toBeEnabled();
    expect((await readLibrary(page)).links).toHaveLength(0);
  }
  await page.locator("#destination").fill("https://learn.github.com/?lang=en&utm_source=old#start");
  await page.locator("#content").fill("Hero Button");
  await save(page, '=HYPERLINK("example")');
  const original = (await readLibrary(page)).links[0];
  expect(new URL(original.url).searchParams.get("lang")).toBe("en");
  expect(new URL(original.url).searchParams.get("utm_content")).toBe("hero_button");
  expect(new URL(original.url).hash).toBe("#start");
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text) => { window.copiedText = text; } } });
  });
  await page.locator("#copy-result").click();
  await expect(page.locator("#notice")).toContainText("Copied");
  expect(await page.evaluate(() => window.copiedText)).toBe(original.url);
  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => { throw new DOMException("Denied", "NotAllowedError"); };
  });
  await page.locator("#copy-result").click();
  await expect(page.locator("#error")).toContainText("Select and copy the URL");
  await page.locator("#qr-result").click();
  await expect(page.locator("#qr-image img")).toBeVisible();
  await expect.poll(() => page.locator("#qr-image img").evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
  const svg = await download(page, "#download-qr");
  expect(svg.filename).toMatch(/\.svg$/);
  expect(svg.content).toContain("<svg");
  expect(svg.content).toContain("viewBox=");
  await page.locator('#qr-dialog [data-close]').click();
  const backup = await download(page, "#download-backup");
  expect(JSON.parse(backup.content).links[0]).toEqual(original);
  await page.locator('[data-view="history"]').click();
  const csv = await download(page, "#export-csv");
  expect(csv.content).toContain(`"'=HYPERLINK(""example"")"`);
  expect(csv.content).toContain('"false","","not_connected"');
  await page.getByRole("button", { name: "Duplicate", exact: true }).click();
  await expect(page.locator("#title")).toHaveValue(/\(copy\)/);
  await save(page, "<img src=x onerror=alert(1)>");
  const duplicate = (await readLibrary(page)).links[0];
  expect(duplicate.id).not.toBe(original.id);
  await page.locator('[data-view="history"]').click();
  await expect(page.locator(".link-card img")).toHaveCount(0);
  await page.locator("#search").fill("<img");
  await expect(page.locator(".link-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.locator(".link-card")).toHaveCount(0);
  await page.locator("#include-archived").check();
  await expect(page.locator(".link-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await page.locator("#search").fill("");
  await page.locator("#filter-medium").selectOption("referral");
  await expect(page.locator(".link-card")).toHaveCount(2);
  await page.locator('[data-view="dashboard"]').click();
  await expect(page.locator("#stats")).toContainText("Unavailable");
  await expect(page.locator("#stats")).toContainText("Not connected");
  await expect(page.locator("#stats .stat-value").first()).toHaveText("2");
  expect(requests).toEqual([]);
  await page.reload();
  await expect(page.locator("#dashboard")).toBeVisible();
  expect((await readLibrary(page)).links).toHaveLength(2);
  expect(errors).toEqual([]);
});

test("Learning path preset stays consistent through preview, save, filtering, inventory and backups", async ({ page, browser, baseURL }) => {
  await start(page);
  await initiative(page);
  await save(page, "Existing email link");
  const existing = (await readLibrary(page)).links[0];
  const preset = page.getByRole("button", { name: "Learning path", exact: true });
  await expect(preset).toBeVisible();
  await expect(page.locator('#mediums option[value="learning_path"]')).toHaveCount(1);
  await preset.click();
  await expect(preset).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-preset="email"]')).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#source")).toHaveValue("learning_path");
  await expect(page.locator("#medium")).toHaveValue("learning_path");
  await expect(page.locator("#preview-url")).toContainText("utm_source=learning_path&utm_medium=learning_path");
  await expect(page.locator("#preview-url")).toContainText("learn_link_id=preview");
  await page.locator("#source").fill("Example Path");
  await expect(page.locator("#preview-url")).toContainText("utm_source=example_path&utm_medium=learning_path");
  await save(page, "Learning path link");
  const saved = (await readLibrary(page)).links[0];
  expect(saved.medium).toBe("learning_path");
  expect(saved.source).toBe("example_path");
  expect(new URL(saved.url).searchParams.get("utm_medium")).toBe("learning_path");
  await expect(page.locator("#preview-url")).toHaveText(saved.url);
  const backup = await download(page, "#download-backup");
  expect(JSON.parse(backup.content).links).toEqual([saved, existing]);
  await page.locator('[data-view="history"]').click();
  await page.locator("#filter-medium").selectOption("learning_path");
  await expect(page.locator(".link-card")).toHaveCount(1);
  await expect(page.locator(".link-card h3")).toHaveText("Learning path link");
  await expect(page.locator(".link-card .url-box")).toHaveText(saved.url);
  const csv = await download(page, "#export-csv");
  expect(csv.content).toContain('"example_path","learning_path"');
  expect(csv.content).toContain(`"${saved.url}"`);
  expect(csv.content).toContain(`"${existing.url}"`);
  await page.locator("#filter-medium").selectOption("email");
  await expect(page.locator(".link-card h3")).toHaveText("Existing email link");
  await page.locator('[data-view="dashboard"]').click();
  await expect(page.getByRole("progressbar", { name: "learning_path: 1 saved links", exact: true })).toHaveAttribute("value", "1");
  await expect(page.getByRole("progressbar", { name: "email: 1 saved links", exact: true })).toHaveAttribute("value", "1");
  await expect(page.locator("#stats")).toContainText("Not connected");
  await page.reload();
  await expect(page.locator("#nav-count")).toHaveText("2");
  expect((await readLibrary(page)).links).toEqual([saved, existing]);
  const context = await browser.newContext({ baseURL });
  try {
    const restored = await context.newPage();
    await start(restored);
    await chooseBackup(restored, backup.content);
    await restored.locator("#confirm-import").click();
    await expect(restored.locator("#notice")).toContainText("Imported 2");
    expect((await readLibrary(restored)).links).toEqual([saved, existing]);
  } finally { await context.close(); }
});

for (const destination of [
  "https://portal.github.partners/#/page/universe-2026",
  "https://portal.github.partners/?lang=en&tag=one&tag=two&utm_source=old&learn_link_id=old#/page/universe-2026?tab=overview&next=%2Fwelcome%3Fx%3D1&utm_source=route",
]) {
  test(`portal preview, save, reload, QR, export and restore: ${destination}`, async ({ page, browser, baseURL }) => {
    await start(page);
    await expect(page.locator("#destination")).toHaveValue("https://learn.github.com/");
    const requests = [];
    page.on("request", (request) => {
      if (!request.url().startsWith("blob:")) requests.push(request.url());
    });
    await initiative(page, "Portal regression");
    await page.locator("#title").fill("Portal test link");
    await page.locator("#destination").fill(destination);
    const hash = new URL(destination).hash;
    const prefix = destination.includes("?lang=") ? "lang=en&tag=one&tag=two&" : "";
    const expectedUrl = (id) => `https://portal.github.partners/?${prefix}utm_source=newsletter&utm_medium=email&utm_campaign=portal_regression&learn_link_id=${id}${hash}`;
    await expect(page.locator("#preview-url")).toHaveText(expectedUrl("preview"));
    await save(page, "Portal test link");
    const saved = (await readLibrary(page)).links[0];
    expect(saved.url).toBe(expectedUrl(saved.id));
    await expect(page.locator("#preview-url")).toHaveText(saved.url);
    await page.locator("#qr-result").click();
    await expect.poll(() => page.locator("#qr-image img").evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
    expect((await download(page, "#download-qr")).content).toContain("<svg");
    await page.locator('#qr-dialog [data-close]').click();
    const backup = await download(page, "#download-backup");
    expect(JSON.parse(backup.content).links).toEqual([saved]);
    await page.locator('[data-view="history"]').click();
    const csv = await download(page, "#export-csv");
    expect(csv.content).toContain(`"${saved.url}"`);
    expect(csv.content).toContain('"false","","not_connected"');
    expect(requests).toEqual([]);
    await page.reload();
    await expect(page.locator("#links-list .url-box")).toHaveText(saved.url);
    expect((await readLibrary(page)).links).toEqual([saved]);
    const context = await browser.newContext({ baseURL });
    try {
      const restored = await context.newPage();
      await start(restored);
      await chooseBackup(restored, backup.content);
      await restored.locator("#confirm-import").click();
      await expect(restored.locator("#notice")).toContainText("Imported 1");
      expect((await readLibrary(restored)).links).toEqual([saved]);
      await restored.reload();
      expect((await readLibrary(restored)).links).toEqual([saved]);
    } finally { await context.close(); }
  });
}

test("two open tabs refresh and concurrent transactions never lose records", async ({ page, context }) => {
  await start(page);
  await initiative(page);
  const second = await context.newPage();
  await start(second);
  const group = (await readLibrary(page)).initiatives[0];
  await second.locator("#initiativeId").selectOption(group.id);
  await Promise.all([save(page, "First tab"), save(second, "Second tab")]);
  await expect(page.locator("#nav-count")).toHaveText("2");
  await expect(second.locator("#nav-count")).toHaveText("2");
  const createMany = (target, prefix) => target.evaluate(async ({ prefix, group }) => {
    const { Store } = await import("./storage.mjs");
    return Promise.all(Array.from({ length: 8 }, (_, index) => new Store().createLink({
      title: `${prefix} ${index}`, destination: "https://learn.github.com/", initiativeId: group.id, source: "example", medium: "email",
    })));
  }, { prefix, group });
  await Promise.all([createMany(page, "one"), createMany(second, "two")]);
  const state = await readLibrary(page);
  expect(state.links).toHaveLength(18);
  expect(new Set(state.links.map((link) => link.id)).size).toBe(18);
  await second.reload();
  await expect(second.locator("#nav-count")).toHaveText("18");
  expect((await readLibrary(second)).links).toEqual(state.links);
});

test("compatible backups restore locally, merge idempotently and reject invalid data", async ({ page, browser, baseURL }) => {
  await start(page);
  await initiative(page);
  await save(page);
  const { content } = await download(page, "#download-backup");
  const source = JSON.parse(content);
  const context = await browser.newContext({ baseURL });
  const restored = await context.newPage();
  try {
    await start(restored);
    expect((await readLibrary(restored)).links).toEqual([]);
    await chooseBackup(restored, content);
    await expect(restored.locator("#import-summary")).toContainText("1 initiatives and 1 links");
    expect((await readLibrary(restored)).links).toEqual([]);
    await restored.locator("#confirm-import").click();
    await expect(restored.locator("#notice")).toContainText("Imported 1");
    expect((await readLibrary(restored)).links).toEqual(source.links);
    await chooseBackup(restored, content);
    await restored.locator("#confirm-import").click();
    await expect(restored.locator("#notice")).toContainText("Imported 0");
    await chooseBackup(restored, "{invalid");
    await expect(restored.locator("#error")).toContainText("valid JSON");
    const bad = structuredClone(source);
    bad.links[0].url = "https://example.com/";
    await chooseBackup(restored, bad);
    await expect(restored.locator("#error")).toContainText("does not match");
    await chooseBackup(restored, { ...source, version: 2 });
    await expect(restored.locator("#error")).toContainText("version 1");
    expect((await readLibrary(restored)).links).toEqual(source.links);
    await restored.reload();
    expect((await readLibrary(restored)).links).toEqual(source.links);
  } finally { await context.close(); }
});

test("an import conflict rolls back every earlier record in its transaction", async ({ page }) => {
  await start(page);
  await initiative(page);
  await save(page);
  const before = await readLibrary(page);
  const incoming = await page.evaluate(async () => {
    const { Store } = await import("./storage.mjs");
    const { buildLink, createInitiative } = await import("./core.mjs");
    const state = await new Store().read();
    createInitiative(state, { name: "New before conflict", campaign: "new_before_conflict" });
    state.links[0] = { ...state.links[0], ...buildLink({ ...state.links[0], source: "different" }, state, state.links[0].id) };
    return state;
  });
  await chooseBackup(page, incoming);
  await page.locator("#confirm-import").click();
  await expect(page.locator("#import-error")).toContainText("Link ID conflict");
  expect(await readLibrary(page)).toEqual(before);
});

test("quota and corrupt storage failures are explicit and never overwrite existing data", async ({ page }) => {
  await start(page);
  await initiative(page);
  const before = await readLibrary(page);
  await page.evaluate(() => {
    window.originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = () => { throw new DOMException("Storage quota reached", "QuotaExceededError"); };
  });
  await page.locator("#title").fill("Cannot be saved");
  await page.locator("#save-link").click();
  await expect(page.locator("#error")).toContainText("Could not save");
  await expect(page.locator("#saved-actions")).not.toBeVisible();
  await expect(page.locator("#save-link")).toBeEnabled();
  await page.evaluate(() => { IDBObjectStore.prototype.put = window.originalPut; });
  expect(await readLibrary(page)).toEqual(before);
  await page.locator("#save-link").click();
  await expect(page.locator("#saved-actions")).toBeVisible();
  await page.evaluate(async () => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.open("learn-campaign-links", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("library", "readwrite");
        tx.objectStore("library").put({ corrupt: true }, "state");
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
  });
  await page.reload();
  await expect(page.locator("#error")).toContainText("Invalid library format");
  await expect(page.locator("#title")).toBeDisabled();
  await expect(page.locator("#download-backup")).toBeDisabled();
  const raw = await page.evaluate(async () => {
    const { Store } = await import("./storage.mjs");
    try { await new Store().createInitiative({ name: "Must not overwrite", campaign: "no" }); }
    catch (error) {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open("learn-campaign-links", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("library", "readonly");
          const get = tx.objectStore("library").get("state");
          tx.oncomplete = () => { db.close(); resolve({ message: error.message, data: get.result }); };
        };
      });
    }
  });
  expect(raw.data).toEqual({ corrupt: true });
  expect(raw.message).toContain("No existing data was overwritten");
});

test("unavailable IndexedDB leaves clear recovery guidance, not a pretend library", async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(globalThis, "indexedDB", { value: undefined }); });
  await page.goto("./");
  await expect(page.locator("#error")).toContainText("Browser storage is unavailable");
  await expect(page.locator("#title")).toBeDisabled();
  await expect(page.locator("#save-status")).toContainText("Library unavailable");
});

test("responsive light/dark layouts, labels, focus and dialog keyboard controls", async ({ page }) => {
  await start(page);
  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    for (const width of [375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.locator("#destination")).toHaveAccessibleName("Destination URL Required");
      await page.locator("#connection-info").click();
      await expect(page.locator("#tracking-dialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.locator("#tracking-dialog")).not.toBeVisible();
      await expect(page.locator("#connection-info")).toBeFocused();
    }
  }
});
