import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildLink, cleanDestination, createInitiative, createLink, emptyState, MAX_BACKUP_BYTES, mergeBackup, parseBackup, setArchived, toBackup, toCsv, validateState } from "../core.mjs";
import { qrcode } from "../vendor/qrcode.mjs";

function fixture() {
  const state = emptyState();
  const initiative = createInitiative(state, { name: "Example learning series", campaign: "Example Learning" });
  const input = {
    title: "Example poster", destination: "https://learn.github.com/?lang=en&utm_source=old&utm_source=older&utm_id=old#learn",
    initiativeId: initiative.id, source: "Community", medium: "QR", content: "Booth Poster", notes: "First line\nSecond line",
  };
  return { state, initiative, input };
}

test("UTMs normalize, replace existing labels and preserve query/fragment", () => {
  const { state, input } = fixture();
  const link = buildLink(input, state, "test-id");
  const url = new URL(link.url);
  assert.equal(link.campaign, "example_learning");
  assert.equal(url.searchParams.get("utm_source"), "community");
  assert.equal(url.searchParams.getAll("utm_source").length, 1);
  assert.equal(url.searchParams.get("utm_medium"), "qr");
  assert.equal(url.searchParams.get("utm_content"), "booth_poster");
  assert.equal(url.searchParams.get("learn_link_id"), "test-id");
  assert.equal(url.searchParams.get("lang"), "en");
  assert.equal(url.searchParams.has("utm_term"), false);
  assert.equal(url.searchParams.has("utm_id"), false);
  assert.equal(url.hash, "#learn");
  assert.equal(link.notes, "First line\nSecond line");
  assert.equal(new URL(link.destination).searchParams.has("utm_source"), false);
});

test("only HTTPS Learn destinations without credentials or custom ports", () => {
  for (const input of [
    "https://evil.test/", "https://learn.github.com.evil.test/", "https://learn.github.com@evil.test",
    "https://user@learn.github.com/", "http://learn.github.com", "javascript:alert(1)",
    "https://learn.github.com:8080/", "not a url", "https://learn.github.com/\n", "https://learn.github.com./",
    null, [], {},
  ]) assert.throws(() => cleanDestination(input));
  assert.equal(cleanDestination("https://learn.github.com/a?topic=C%2B%2B#b").href, "https://learn.github.com/a?topic=C%2B%2B#b");
  assert.equal(cleanDestination("https://learn.github.com:443/").href, "https://learn.github.com/");
});

test("parameter constraints, missing initiatives and duplicate campaign keys", () => {
  const { state, input } = fixture();
  for (const [key, value] of [["title", ""], ["title", "a".repeat(151)], ["source", "bad&value"], ["medium", "\u{1f389}"], ["initiativeId", "missing"], ["notes", "\u0001"], ["source", "a".repeat(101)]]) {
    assert.throws(() => buildLink({ ...input, [key]: value }, state));
  }
  assert.throws(() => buildLink(input, state, "<bad>"), /ID/);
  assert.throws(() => createInitiative(state, { name: "Duplicate", campaign: "EXAMPLE LEARNING" }), /already exists/);
});

test("links have unique IDs and archive preserves their URL", () => {
  const { state, input } = fixture();
  const first = createLink(state, input);
  const second = createLink(state, input);
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.url, second.url);
  assert.equal(new URL(first.url).searchParams.get("learn_link_id"), first.id);
  const url = first.url;
  setArchived(state, { id: first.id, archived: true });
  assert.equal(first.archived, true);
  assert.equal(first.url, url);
  setArchived(state, { id: first.id, archived: false });
  assert.throws(() => setArchived(state, { id: "missing", archived: true }), /not found/);
  assert.throws(() => setArchived(state, { id: first.id, archived: "true" }), /true or false/);
});

test("version 1 backups round-trip, merge campaigns and retain existing records", () => {
  const { state, input } = fixture();
  createLink(state, input);
  const incoming = parseBackup(toBackup(state));
  assert.deepEqual(incoming, state);
  const target = emptyState();
  const initiative = createInitiative(target, { name: "Local name", campaign: "example_learning" });
  assert.equal(mergeBackup(target, incoming).added, 1);
  assert.equal(mergeBackup(target, incoming).added, 0);
  assert.equal(target.initiatives.length, 1);
  assert.equal(target.links[0].initiativeId, initiative.id);
  target.links[0].archived = true;
  mergeBackup(target, incoming);
  assert.equal(target.links[0].archived, true);
  assert.deepEqual(validateState(target), target);
});

test("backup conflicts are detected even when campaign match precedes conflicting ID", () => {
  const target = fixture().state;
  const different = createInitiative(target, { name: "Different", campaign: "different" });
  const incoming = fixture().state;
  incoming.initiatives[0].id = different.id;
  assert.throws(() => mergeBackup(target, incoming), /Initiative ID conflict/);
  const { state, input } = fixture();
  createLink(state, input);
  const changed = structuredClone(state);
  changed.links[0] = { ...buildLink({ ...input, content: "changed" }, changed, state.links[0].id), createdAt: state.links[0].createdAt, archived: false };
  assert.throws(() => mergeBackup(state, changed), /Link ID conflict/);
});

test("malformed or tampered imports cannot become valid library records", () => {
  const { state, input } = fixture();
  createLink(state, input);
  for (const value of [null, [], {}, { ...state, version: 2 }, { ...state, updatedAt: "invalid" }, { ...state, initiatives: [null] }, { ...state, links: [null] }]) {
    assert.throws(() => validateState(value));
  }
  assert.throws(() => validateState({ ...state, links: [state.links[0], state.links[0]] }), /duplicate/);
  const bad = structuredClone(state);
  bad.links[0].url = "https://evil.test/";
  assert.throws(() => validateState(bad), /does not match/);
  bad.links[0].url = state.links[0].url;
  bad.links[0].campaign = "wrong";
  assert.throws(() => validateState(bad), /does not match/);
  assert.throws(() => parseBackup("{bad json"), /valid JSON/);
  assert.throws(() => parseBackup(" ".repeat(MAX_BACKUP_BYTES + 1)), /too large/);
  assert.throws(() => toBackup({ notes: "a".repeat(MAX_BACKUP_BYTES) }), /backup limit/);
  const extra = { ...state, unknownMetadata: "not retained", links: [{ ...state.links[0], extra: "not retained" }] };
  assert.deepEqual(validateState(extra), state);
});

test("CSV quotes multiline fields, neutralizes formulas and leaves clicks blank", () => {
  for (const prefix of ["=", "+", "-", "@", "\t=", "\n@"]) {
    const { state, input } = fixture();
    createLink(state, { ...input, title: '=HYPERLINK("example")', notes: `${prefix}formula\nsecond line` });
    const csv = toCsv(state);
    assert.match(csv, /"'=HYPERLINK\(""example""\)"/);
    assert.match(csv, /"false","","not_connected"/);
    assert.ok(csv.includes(`"'${prefix.trimStart()}formula\nsecond line"`));
  }
});

test("QR supports normal and exactly maximum-length accepted URLs", () => {
  const { state, input } = fixture();
  const normal = buildLink(input, state, "test-id");
  const fixed = buildLink({ ...input, destination: "https://learn.github.com/?q=", term: "a".repeat(100), content: "a".repeat(100) }, state, "test-id").url.length;
  const long = buildLink({
    ...input, destination: `https://learn.github.com/?q=${"a".repeat(2200 - fixed)}`, term: "a".repeat(100), content: "a".repeat(100),
  }, state, "test-id");
  assert.equal(long.url.length, 2200);
  for (const link of [normal, long]) {
    const qr = qrcode(0, "M");
    qr.addData(link.url, "Byte");
    qr.make();
    assert.ok(qr.getModuleCount() > 20);
    assert.match(qr.createSvgTag({ cellSize: 5, margin: 20, scalable: true }), /<svg[^>]+viewBox=/);
  }
  assert.throws(() => buildLink({ ...input, destination: "https://learn.github.com/?q=" + "a".repeat(2000), term: "a".repeat(100), content: "a".repeat(100) }, state), /too long/);
});

test("production code has relative assets and no local app or backend dependencies", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /src="\.\/app.mjs"/);
  assert.match(html, /href="\.\/styles.css"/);
  for (const file of ["app.mjs", "core.mjs", "storage.mjs", "index.html", "styles.css", "README.md"]) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\/Users\/|api\/library|api\/links|@github\/copilot-sdk/i);
    if (file.endsWith(".mjs")) assert.doesNotMatch(source, /\bfetch\s*\(|\bXMLHttpRequest\b|\bsendBeacon\b|\bWebSocket\b/);
  }
});
