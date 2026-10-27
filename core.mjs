const utmKeys = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "utm_id", "learn_link_id"];
export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;
export const MAX_URL_LENGTH = 2200;

export function emptyState() {
  return { version: 1, initiatives: [], links: [], updatedAt: null };
}

function text(value, label, max = 100, required = true, multiline = false) {
  if (value === undefined && !required) return "";
  const controls = multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/;
  if (typeof value !== "string" || (required && !value.trim()) || value.length > max || controls.test(value)) {
    throw new Error(`${label} must be ${required ? "non-empty text" : "text"} of at most ${max} characters, without control characters.`);
  }
  return value.trim();
}

export function slug(value, label, required = true) {
  const result = text(value, label, 100, required).toLowerCase().replace(/\s+/g, "_");
  if (result && !/^[a-z0-9][a-z0-9_.-]*$/.test(result)) {
    throw new Error(`${label}: use letters a-z, numbers, spaces, underscores, dots, or hyphens.`);
  }
  return result;
}

export function cleanDestination(value) {
  let url;
  try {
    url = new URL(text(value, "Destination URL", 2048));
  } catch {
    throw new Error("Enter a valid https://learn.github.com URL.");
  }
  if (url.protocol !== "https:" || url.hostname !== "learn.github.com" || url.username || url.password || url.port) {
    throw new Error("Destination must be on https://learn.github.com, without credentials or a custom port.");
  }
  for (const key of utmKeys) url.searchParams.delete(key);
  return url;
}

function validId(id) {
  return typeof id === "string" && /^[a-z0-9-]{1,64}$/.test(id);
}

function validDate(value) {
  return typeof value === "string" && value.length <= 100 && !Number.isNaN(Date.parse(value));
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function buildLink(input, state, id = crypto.randomUUID()) {
  if (!record(input)) throw new Error("Link details are required.");
  if (!validId(id)) throw new Error("Invalid link ID.");
  const initiative = state.initiatives.find((item) => item.id === input.initiativeId);
  if (!initiative) throw new Error("Choose an existing initiative first.");
  const destination = cleanDestination(input.destination);
  const link = {
    id,
    title: text(input.title, "Link title", 150),
    destination: destination.href,
    initiativeId: initiative.id,
    source: slug(input.source, "Source"),
    medium: slug(input.medium, "Medium"),
    campaign: initiative.campaign,
    content: slug(input.content, "Content", false),
    term: slug(input.term, "Term", false),
    notes: text(input.notes, "Notes", 500, false, true),
  };
  const url = new URL(destination);
  url.searchParams.set("utm_source", link.source);
  url.searchParams.set("utm_medium", link.medium);
  url.searchParams.set("utm_campaign", link.campaign);
  if (link.content) url.searchParams.set("utm_content", link.content);
  if (link.term) url.searchParams.set("utm_term", link.term);
  url.searchParams.set("learn_link_id", id);
  if (url.href.length > MAX_URL_LENGTH) {
    throw new Error("Generated URL is too long for a reliable QR code. Shorten the destination or parameters.");
  }
  return { ...link, url: url.href };
}

export function validateState(input) {
  if (!record(input) || input.version !== 1 || !Array.isArray(input.initiatives) || !Array.isArray(input.links)) {
    throw new Error("Invalid library format. Expected a version 1 Learn link library.");
  }
  if (input.initiatives.length > 1000 || input.links.length > 20000) throw new Error("Library exceeds supported size (1,000 initiatives or 20,000 links).");
  if (input.updatedAt !== null && !validDate(input.updatedAt)) throw new Error("Invalid library save date.");
  const state = emptyState();
  state.updatedAt = input.updatedAt;
  const ids = new Set();
  const campaigns = new Set();
  for (const item of input.initiatives) {
    if (!record(item) || !validId(item.id) || ids.has(item.id) || !validDate(item.createdAt)) {
      throw new Error("Invalid or duplicate initiative.");
    }
    const campaign = slug(item.campaign, "Campaign");
    if (campaign !== item.campaign || campaigns.has(campaign)) throw new Error("Campaign keys must be unique and normalized.");
    state.initiatives.push({
      id: item.id,
      name: text(item.name, "Initiative name", 100),
      campaign,
      notes: text(item.notes, "Initiative notes", 500, false, true),
      createdAt: item.createdAt,
    });
    ids.add(item.id);
    campaigns.add(campaign);
  }
  ids.clear();
  for (const item of input.links) {
    if (!record(item) || !validId(item.id) || ids.has(item.id) || !validDate(item.createdAt) || typeof item.archived !== "boolean") {
      throw new Error("Invalid or duplicate link.");
    }
    const expected = buildLink(item, state, item.id);
    if (expected.url !== item.url || item.campaign !== expected.campaign) throw new Error("A saved link does not match its parameters.");
    // Only known library fields survive import; unrelated metadata is not retained.
    state.links.push({ ...expected, createdAt: item.createdAt, archived: item.archived });
    ids.add(item.id);
  }
  return state;
}

export function createInitiative(state, input) {
  const item = {
    id: crypto.randomUUID(),
    name: text(input?.name, "Initiative name", 100),
    campaign: slug(input?.campaign, "Campaign"),
    notes: text(input?.notes, "Notes", 500, false, true),
    createdAt: new Date().toISOString(),
  };
  if (state.initiatives.some((entry) => entry.campaign === item.campaign)) {
    throw new Error("This campaign key already exists. Choose that initiative or use a different key.");
  }
  state.initiatives.push(item);
  return item;
}

export function createLink(state, input) {
  const link = { ...buildLink(input, state), createdAt: new Date().toISOString(), archived: false };
  state.links.unshift(link);
  return link;
}

export function setArchived(state, input) {
  if (typeof input?.archived !== "boolean") throw new Error("Archived must be true or false.");
  const link = state.links.find((item) => item.id === input.id);
  if (!link) throw new Error("Link not found. Refresh your library and try again.");
  link.archived = input.archived;
  return link;
}

export function mergeBackup(state, incoming) {
  const initiativeMap = new Map();
  for (const item of incoming.initiatives) {
    const sameId = state.initiatives.find((entry) => entry.id === item.id);
    if (sameId && sameId.campaign !== item.campaign) throw new Error("Initiative ID conflict. Import cancelled; no data changed.");
    const existing = sameId || state.initiatives.find((entry) => entry.campaign === item.campaign);
    initiativeMap.set(item.id, existing?.id || item.id);
    if (!existing) state.initiatives.push(item);
  }
  let added = 0;
  for (const item of incoming.links) {
    const existing = state.links.find((entry) => entry.id === item.id);
    if (existing) {
      if (existing.url !== item.url) throw new Error("Link ID conflict. Import cancelled; no data changed.");
      continue;
    }
    state.links.push({ ...item, initiativeId: initiativeMap.get(item.initiativeId) });
    added++;
  }
  state.links.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return { added, message: `Imported ${added} new links. Existing links were kept unchanged.` };
}

export function parseBackup(json) {
  if (new TextEncoder().encode(json).byteLength > MAX_BACKUP_BYTES) throw new Error("Backup is too large. Maximum size is 20 MB.");
  let input;
  try { input = JSON.parse(json); }
  catch { throw new Error("Choose a valid JSON backup exported by this tool."); }
  return validateState(input);
}

export function toBackup(state) {
  const json = JSON.stringify(state, null, 2) + "\n";
  if (new TextEncoder().encode(json).byteLength > MAX_BACKUP_BYTES) {
    throw new Error("Library would exceed the 20 MB backup limit. No changes saved. Use a separate browser profile for a new library.");
  }
  return json;
}

export function toCsv(state) {
  const headers = ["id", "title", "initiative", "source", "medium", "campaign", "content", "term", "destination", "url", "created_at", "archived", "clicks", "tracking_status", "notes"];
  const cell = (value) => {
    let string = String(value ?? "");
    if (/^\s*[=+\-@]/.test(string)) string = `'${string}`;
    return `"${string.replaceAll('"', '""')}"`;
  };
  const names = new Map(state.initiatives.map((item) => [item.id, item.name]));
  const rows = state.links.map((link) => [
    link.id, link.title, names.get(link.initiativeId),
    link.source, link.medium, link.campaign, link.content, link.term, link.destination,
    link.url, link.createdAt, link.archived, "", "not_connected", link.notes,
  ]);
  return "\uFEFF" + [headers, ...rows].map((row) => row.map(cell).join(",")).join("\r\n");
}
