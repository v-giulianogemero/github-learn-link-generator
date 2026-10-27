import { buildLink, emptyState, MAX_BACKUP_BYTES, parseBackup, toBackup, toCsv } from "./core.mjs";
import { Store, DATABASE_NAME } from "./storage.mjs";
import { qrcode } from "./vendor/qrcode.mjs";

const $ = (id) => document.getElementById(id);
const store = new Store();
const numbers = new Intl.NumberFormat();
const presets = {
  email: ["newsletter", "email"],
  qr: ["event", "qr"],
  event: ["event", "event"],
  social: ["linkedin", "social"],
  partner: ["partner", "referral"],
};
let library = emptyState();
let libraryReady = false;
let saving = false;
let savedLink = null;
let pendingBackup = null;
let qrDownload = null;
let qrObjectUrl = null;
let previewTimer;
let refreshVersion = 0;
let campaignEdited = false;
let visibleLimit = 50;
let currentView = "builder";
let channel;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(text, handler, className = "") {
  const node = element("button", className, text);
  node.type = "button";
  node.addEventListener("click", () => run(async () => {
    node.disabled = true;
    try { await handler(node); }
    finally { node.disabled = false; }
  }));
  return node;
}

function message(text, error = false, focus = false) {
  const target = $(error ? "error" : "notice");
  $(error ? "notice" : "error").hidden = true;
  target.textContent = text;
  target.hidden = false;
  if (focus) target.focus();
}

async function run(fn) {
  try { await fn(); }
  catch (error) { message(error.message, true, true); }
}

function selectOptions(select, values, prompt) {
  const current = select.value;
  select.replaceChildren(new Option(prompt, ""), ...values.map(([value, label]) => new Option(label, value)));
  if (values.some(([value]) => value === current)) select.value = current;
}

function updateControls() {
  $("link-fields").disabled = !libraryReady || saving;
  document.querySelectorAll("[data-storage]").forEach((node) => { node.disabled = !libraryReady; });
  $("save-link").disabled = saving || savedLink !== null;
}

async function refresh() {
  const version = ++refreshVersion;
  let next;
  try { next = await store.read(); }
  catch (error) {
    if (version === refreshVersion) {
      libraryReady = false;
      updateControls();
      $("save-status").textContent = "Library unavailable. Resolve the storage error, then use Refresh or reload.";
    }
    throw error;
  }
  if (version !== refreshVersion) return;
  library = next;
  libraryReady = true;
  const initiatives = library.initiatives.map((item) => [item.id, item.name]);
  selectOptions($("initiativeId"), initiatives, "Choose an initiative");
  selectOptions($("filter-initiative"), initiatives, "All initiatives");
  selectOptions($("filter-medium"), [...new Set(library.links.map((link) => link.medium))].sort().map((medium) => [medium, medium]), "All channels");
  $("nav-count").textContent = numbers.format(library.links.length);
  $("save-status").textContent = library.updatedAt ? `Last saved ${new Date(library.updatedAt).toLocaleString()}` : "Your library is empty. Create an initiative to get started.";
  if (savedLink && !library.links.some((link) => link.id === savedLink.id)) schedulePreview();
  updateControls();
  updateCampaignHint();
  renderCurrentView();
}

async function changed() {
  channel?.postMessage("changed");
  await refresh();
}

function showView(name, updateHash = true) {
  currentView = ["builder", "history", "initiatives", "dashboard"].includes(name) ? name : "builder";
  document.querySelectorAll(".view").forEach((view) => { view.hidden = view.id !== currentView; });
  document.querySelectorAll(".tab").forEach((tab) => {
    const active = tab.dataset.view === currentView;
    tab.classList.toggle("selected", active);
    if (active) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  });
  if (updateHash && location.hash !== `#${currentView}`) history.pushState(null, "", `#${currentView}`);
  renderCurrentView();
}

function renderCurrentView() {
  if (currentView === "history") renderHistory();
  if (currentView === "initiatives") renderInitiatives();
  if (currentView === "dashboard") renderDashboard();
}

function draft() { return Object.fromEntries(new FormData($("link-form"))); }

function updateCampaignHint() {
  const initiative = library.initiatives.find((item) => item.id === $("initiativeId").value);
  $("campaign-hint").textContent = initiative ? `utm_campaign = ${initiative.campaign}` : "An initiative keeps related links under one utm_campaign.";
  for (const node of document.querySelectorAll("[data-preset]")) {
    const active = presets[node.dataset.preset][1] === $("medium").value;
    node.classList.toggle("active", active);
    node.setAttribute("aria-pressed", String(active));
  }
}

function schedulePreview() {
  savedLink = null;
  $("save-link").disabled = saving;
  $("save-link").textContent = "Generate & save link";
  $("saved-actions").hidden = true;
  $("preview-help").hidden = false;
  updateCampaignHint();
  clearTimeout(previewTimer);
  $("preview-url").textContent = "Complete the required fields to preview your URL.";
  $("preview-title").textContent = $("title").value || "Ready when you are";
  $("preview-message").textContent = "Draft preview. Nothing is saved yet.";
  if (!$("link-form").checkValidity()) return;
  previewTimer = setTimeout(() => {
    try {
      $("preview-url").textContent = buildLink(draft(), library, "preview").url;
      $("preview-message").textContent = "Ready to generate. A unique link ID will be assigned when saved.";
    } catch (error) { $("preview-message").textContent = error.message; }
  }, 200);
}

async function copy(link) {
  try {
    await navigator.clipboard.writeText(link.url);
    message(`Copied "${link.title}".`);
  } catch {
    message("Clipboard access was blocked. Select and copy the URL displayed in the link card.", true, true);
  }
}

function openDialog(id, trigger = document.activeElement) {
  const dialog = $(id);
  dialog.addEventListener("close", () => {
    if (trigger?.isConnected) trigger.focus();
  }, { once: true });
  dialog.showModal();
}

function showQr(link, trigger) {
  const qr = qrcode(0, "M");
  qr.addData(link.url, "Byte");
  qr.make();
  const svg = qr.createSvgTag({ cellSize: 5, margin: 20, scalable: true });
  if (qrObjectUrl) URL.revokeObjectURL(qrObjectUrl);
  qrObjectUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  const img = element("img");
  img.src = qrObjectUrl;
  img.alt = `QR code for ${link.title}`;
  img.width = 340;
  img.height = 340;
  $("qr-image").replaceChildren(img);
  $("qr-label").textContent = link.title;
  qrDownload = { svg, filename: `${link.campaign}-${link.medium}-${link.id.slice(0, 8)}.svg` };
  openDialog("qr-dialog", trigger);
}

function downloadBlob(content, type, filename) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = element("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function loadDraft(link) {
  for (const name of ["title", "destination", "initiativeId", "source", "medium", "content", "term", "notes"]) {
    $(name).value = link[name] || "";
  }
  $("title").value = `${link.title} (copy)`.slice(0, 150);
  schedulePreview();
  showView("builder");
  $("title").focus();
  message("Draft copied. Saving creates a new link ID; the original is unchanged.");
}

function empty(title, description, action) {
  const container = element("div", "empty");
  container.append(element("h3", "", title), element("p", "", description));
  if (action) container.append(action);
  return container;
}

function renderHistory() {
  const search = $("search").value.trim().toLowerCase();
  const initiatives = new Map(library.initiatives.map((item) => [item.id, item]));
  const links = library.links.filter((link) =>
    ($("include-archived").checked || !link.archived)
    && (!$("filter-initiative").value || $("filter-initiative").value === link.initiativeId)
    && (!$("filter-medium").value || $("filter-medium").value === link.medium)
    && (!search || [link.title, link.url, link.notes, initiatives.get(link.initiativeId).name].join(" ").toLowerCase().includes(search)));
  const shown = Math.min(visibleLimit, links.length);
  $("results-count").textContent = `${numbers.format(links.length)} of ${numbers.format(library.links.length)} saved links${shown < links.length ? ` (showing ${numbers.format(shown)})` : ""}`;
  $("load-more").hidden = shown >= links.length;
  const list = $("links-list");
  list.replaceChildren();
  if (!links.length) {
    list.append(empty(library.links.length ? "No matching links" : "Your next campaign starts here", library.links.length ? "Try a different search or include archived links." : "Create a link to keep in this browser library.", button("Create a link", () => showView("builder"), "primary")));
    return;
  }
  for (const link of links.slice(0, visibleLimit)) {
    const initiative = initiatives.get(link.initiativeId);
    const card = element("article", "link-card");
    const top = element("div", "link-top");
    top.append(element("h3", "", link.title), element("span", "badge", link.archived ? "Archived" : link.medium));
    card.append(top, element("div", "meta", `${initiative.name} / ${link.source} / ${link.medium} / ${new Date(link.createdAt).toLocaleDateString()}`));
    const url = element("code", "url-box", link.url);
    url.tabIndex = 0;
    card.append(url);
    if (link.notes) card.append(element("p", "link-note", link.notes));
    const actions = element("div", "button-row");
    actions.append(
      button("Copy link", () => copy(link)),
      button("QR code", (trigger) => showQr(link, trigger)),
      button("Duplicate", () => loadDraft(link)),
      button(link.archived ? "Restore" : "Archive", async () => {
        await store.setArchived({ id: link.id, archived: !link.archived });
        await changed();
        message(link.archived ? "Link restored." : "Link archived. The URL still works. Select Include archived to restore it.");
        $("include-archived").focus();
      }),
      element("span", "badge", "Clicks: Not connected"),
    );
    card.append(actions);
    list.append(card);
  }
}

function openInitiative(trigger) {
  $("initiative-form").reset();
  $("initiative-error").hidden = true;
  campaignEdited = false;
  openDialog("initiative-dialog", trigger);
  $("initiative-name").focus();
}

function linksByInitiative() {
  const grouped = new Map(library.initiatives.map((item) => [item.id, []]));
  for (const link of library.links) grouped.get(link.initiativeId).push(link);
  return grouped;
}

function renderInitiatives() {
  const list = $("initiative-list");
  list.replaceChildren();
  if (!library.initiatives.length) {
    list.append(empty("A home for every initiative", "Start with an event, newsletter program, product launch, or learning campaign.", button("Create your first initiative", openInitiative, "primary")));
    return;
  }
  const grouped = linksByInitiative();
  for (const initiative of library.initiatives) {
    const links = grouped.get(initiative.id);
    const card = element("article", "card");
    card.append(element("h3", "", initiative.name), element("code", "", initiative.campaign));
    if (initiative.notes) card.append(element("p", "", initiative.notes));
    card.append(element("p", "", `${numbers.format(links.length)} links / ${numbers.format(new Set(links.map((link) => link.medium)).size)} channels / ${numbers.format(links.filter((link) => link.archived).length)} archived`));
    const actions = element("div", "button-row");
    actions.append(
      button("Create link", () => {
        $("initiativeId").value = initiative.id;
        schedulePreview();
        showView("builder");
        $("title").focus();
      }),
      button("View links", () => {
        $("filter-initiative").value = initiative.id;
        $("filter-medium").value = "";
        $("search").value = "";
        $("include-archived").checked = true;
        visibleLimit = 50;
        showView("history");
      }),
    );
    card.append(actions);
    list.append(card);
  }
}

function renderBars(target, rows) {
  target.replaceChildren();
  if (!rows.length) {
    target.append(element("p", "muted", "No saved links yet."));
    return;
  }
  const max = Math.max(1, ...rows.map(([, count]) => count));
  for (const [name, count] of rows.sort((a, b) => b[1] - a[1])) {
    const row = element("div", "bar-row");
    const label = element("div", "bar-label");
    label.append(element("span", "", name), element("strong", "", numbers.format(count)));
    const bar = element("progress");
    bar.max = max;
    bar.value = count;
    bar.setAttribute("aria-label", `${name}: ${numbers.format(count)} saved links`);
    row.append(label, bar);
    target.append(row);
  }
}

function renderDashboard() {
  const mediums = new Map();
  for (const link of library.links) mediums.set(link.medium, (mediums.get(link.medium) || 0) + 1);
  const stats = [
    ["Saved links", numbers.format(library.links.length), `${numbers.format(library.links.filter((link) => link.archived).length)} archived`],
    ["Initiatives", numbers.format(library.initiatives.length), "Campaign groups"],
    ["Channels used", numbers.format(mediums.size), "Distribution methods"],
    ["Link clicks", "Unavailable", "Not connected"],
  ];
  $("stats").replaceChildren(...stats.map(([label, value, detail]) => {
    const stat = element("div", "stat");
    stat.append(element("span", "stat-label", label), element("span", "stat-value", value), element("span", "stat-detail", detail));
    return stat;
  }));
  renderBars($("channel-chart"), [...mediums]);
  const grouped = linksByInitiative();
  renderBars($("initiative-chart"), library.initiatives.map((item) => [item.name, grouped.get(item.id).length]));
}

document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => showView(tab.dataset.view)));
window.addEventListener("popstate", () => showView(location.hash.slice(1), false));
document.querySelectorAll("[data-close]").forEach((node) => node.addEventListener("click", () => $(node.dataset.close).close()));
document.querySelectorAll("[data-preset]").forEach((node) => node.addEventListener("click", () => {
  [$("source").value, $("medium").value] = presets[node.dataset.preset];
  schedulePreview();
}));
for (const id of ["add-initiative", "initiative-new"]) $(id).addEventListener("click", () => openInitiative($(id)));
for (const id of ["connection-info", "dashboard-connect"]) $(id).addEventListener("click", () => openDialog("tracking-dialog", $(id)));
for (const id of ["search", "filter-initiative", "filter-medium", "include-archived"]) $(id).addEventListener("input", () => {
  visibleLimit = 50;
  renderHistory();
});
$("load-more").addEventListener("click", () => { visibleLimit += 50; renderHistory(); });
$("history-new").addEventListener("click", () => showView("builder"));
$("refresh-library").addEventListener("click", () => run(refresh));
$("link-form").addEventListener("input", schedulePreview);
$("copy-result").addEventListener("click", () => { if (savedLink) run(() => copy(savedLink)); });
$("qr-result").addEventListener("click", () => { if (savedLink) run(() => showQr(savedLink, $("qr-result"))); });
$("download-qr").addEventListener("click", () => run(() => {
  if (qrDownload) downloadBlob(qrDownload.svg, "image/svg+xml", qrDownload.filename);
}));
$("qr-dialog").addEventListener("close", () => {
  if (qrObjectUrl) URL.revokeObjectURL(qrObjectUrl);
  qrObjectUrl = null;
  qrDownload = null;
  $("qr-image").replaceChildren();
});

$("link-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (saving || savedLink) return;
  run(async () => {
    const input = draft();
    saving = true;
    updateControls();
    $("save-link").textContent = "Saving...";
    clearTimeout(previewTimer);
    try {
      const link = await store.createLink(input);
      savedLink = link;
      $("preview-title").textContent = link.title;
      $("preview-message").textContent = "Your campaign link is saved and ready to share.";
      $("preview-url").textContent = link.url;
      $("saved-actions").hidden = false;
      $("preview-help").hidden = true;
      await changed();
      message(`Saved "${link.title}" in this browser. Click counting is not connected.`);
      $("copy-result").focus();
    } finally {
      saving = false;
      $("save-link").textContent = savedLink ? "Saved - edit to create another" : "Generate & save link";
      updateControls();
    }
  });
});

$("initiative-name").addEventListener("input", () => {
  if (!campaignEdited) $("initiative-campaign").value = $("initiative-name").value.trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "");
});
$("initiative-campaign").addEventListener("input", () => { campaignEdited = true; });
$("initiative-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = $("initiative-form").querySelector('[type="submit"]');
  if (submit.disabled) return;
  submit.disabled = true;
  submit.textContent = "Saving...";
  try {
    const result = await store.createInitiative(Object.fromEntries(new FormData(event.target)));
    await changed();
    $("initiative-dialog").close();
    $("initiativeId").value = result.id;
    schedulePreview();
    message(`Created initiative "${result.name}".`);
  } catch (error) {
    $("initiative-error").textContent = error.message;
    $("initiative-error").hidden = false;
    $("initiative-error").focus();
    if (!$("initiative-dialog").open) message(error.message, true, true);
  } finally {
    submit.disabled = false;
    submit.textContent = "Create initiative";
  }
});

$("download-backup").addEventListener("click", () => run(async () => {
  const current = await store.read();
  downloadBlob(toBackup(current), "application/json", "learn-links-backup.json");
}));
$("export-csv").addEventListener("click", () => run(async () => {
  downloadBlob(toCsv(await store.read()), "text/csv;charset=utf-8", "learn-links.csv");
}));
$("import-backup").addEventListener("click", () => $("backup-file").click());
$("backup-file").addEventListener("change", () => run(async () => {
  const file = $("backup-file").files[0];
  $("backup-file").value = "";
  if (!file) return;
  if (file.size > MAX_BACKUP_BYTES) throw new Error("Backup is too large. Maximum size is 20 MB.");
  pendingBackup = parseBackup(await file.text());
  $("import-summary").textContent = `${numbers.format(pendingBackup.initiatives.length)} initiatives and ${numbers.format(pendingBackup.links.length)} links in this backup.`;
  $("import-error").hidden = true;
  openDialog("import-dialog", $("import-backup"));
}));
$("import-dialog").addEventListener("close", () => { pendingBackup = null; });
$("confirm-import").addEventListener("click", async () => {
  if (!pendingBackup) return;
  $("confirm-import").disabled = true;
  try {
    const result = await store.importBackup(pendingBackup);
    $("import-dialog").close();
    await changed();
    message(result.message);
  } catch (error) {
    if ($("import-dialog").open) {
      $("import-error").textContent = error.message;
      $("import-error").hidden = false;
      $("import-error").focus();
    } else message(error.message, true, true);
  } finally { $("confirm-import").disabled = false; }
});

if (typeof BroadcastChannel !== "undefined") {
  try {
    channel = new BroadcastChannel(DATABASE_NAME);
    channel.onmessage = () => run(refresh);
  } catch {
    message("Live tab refresh is unavailable. Use Refresh to see changes from another tab. Saves still use transactions.", true);
  }
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) run(refresh); });
window.addEventListener("focus", () => run(refresh));
window.addEventListener("beforeunload", (event) => {
  if (!savedLink && $("title").value.trim()) {
    event.preventDefault();
    event.returnValue = "";
  }
});
showView(location.hash.slice(1), false);
await run(refresh);
updateCampaignHint();
