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

test("HTTPS destinations on any host are accepted, including the default port", () => {
  for (const destination of [
    "https://learn.github.com/a?topic=C%2B%2B#b",
    "https://portal.github.partners/#/page/universe-2026",
    "https://github.com/features?locale=en#overview",
    "https://example.com/",
    "https://events.example.org/path?tag=one&tag=two#details",
    "https://learn.github.com.example.org/",
    "https://example.com./",
  ]) assert.equal(cleanDestination(destination).href, destination);
  assert.equal(cleanDestination("https://learn.github.com:443/").href, "https://learn.github.com/");
  assert.equal(cleanDestination("https://example.com:443/").href, "https://example.com/");
});

test("non-HTTPS schemes, credentials, nondefault ports and invalid input remain rejected", () => {
  for (const input of [
    "https://learn.github.com@example.com/",
    "https://user@learn.github.com/", "http://learn.github.com", "javascript:alert(1)",
    "http://portal.github.partners/#/page/universe-2026", "ftp://example.com/", "data:text/html,test",
    "file:///example", "//example.com/", "mailto:test@example.com", "https://",
    "https://user:password@portal.github.partners/", "https://:password@example.com/",
    "https://learn.github.com:8080/", "https://portal.github.partners:8443/", "https://example.com:80/",
    "not a url", "https://learn.github.com/\n",
    null, [], {},
  ]) assert.throws(() => cleanDestination(input));
});

test("Partners portal keeps its full hash route and places tracking before the hash", () => {
  const { state, input } = fixture();
  for (const query of ["", "?lang=en&tag=one&tag=two&topic=C%2B%2B&utm_source=old&utm_source=older&utm_id=old&learn_link_id=old"]) {
    for (const hash of ["#/page/universe-2026", "#/page/universe-2026?tab=overview&next=%2Fwelcome%3Fx%3D1&utm_source=route"]) {
      const link = buildLink({ ...input, destination: `https://portal.github.partners/${query}${hash}` }, state, "portal-test");
      const expectedQuery = query ? "lang=en&tag=one&tag=two&topic=C%2B%2B&" : "";
      assert.equal(link.url, `https://portal.github.partners/?${expectedQuery}utm_source=community&utm_medium=qr&utm_campaign=example_learning&utm_content=booth_poster&learn_link_id=portal-test${hash}`);
      const url = new URL(link.url);
      assert.equal(url.hash, hash);
      assert.equal(url.searchParams.get("learn_link_id"), "portal-test");
      assert.equal(url.searchParams.getAll("utm_source").length, 1);
      assert.equal(url.searchParams.has("utm_id"), false);
      const qr = qrcode(0, "M");
      qr.addData(link.url, "Byte");
      qr.make();
      assert.match(qr.createSvgTag(), /<svg/);
    }
  }
});

test("old Learn backups and mixed-host backups round-trip without rewriting URLs or IDs", () => {
  const legacy = {
    version: 1, updatedAt: "2026-10-27T00:00:00.000Z",
    initiatives: [{ id: "legacy-initiative", name: "Example", campaign: "example", notes: "", createdAt: "2026-10-27T00:00:00.000Z" }],
    links: [{
      id: "legacy-link", title: "Example Learn link", destination: "https://learn.github.com/?lang=en#learn",
      initiativeId: "legacy-initiative", source: "newsletter", medium: "email", campaign: "example",
      content: "", term: "", notes: "", createdAt: "2026-10-27T00:00:00.000Z", archived: false,
      url: "https://learn.github.com/?lang=en&utm_source=newsletter&utm_medium=email&utm_campaign=example&learn_link_id=legacy-link#learn",
    }],
  };
  assert.deepEqual(parseBackup(toBackup(legacy)), legacy);
  const state = structuredClone(legacy);
  for (const destination of ["https://portal.github.partners/#/page/universe-2026", "https://example.org/?lang=en#/route?tab=details"]) {
    createLink(state, { ...legacy.links[0], destination });
  }
  assert.deepEqual(parseBackup(toBackup(state)), state);
  assert.deepEqual(state.links.at(-1), legacy.links[0]);
  const restored = emptyState();
  assert.equal(mergeBackup(restored, validateState(state)).added, 3);
  assert.equal(mergeBackup(restored, validateState(state)).added, 0);
  for (const link of state.links) {
    assert.deepEqual(restored.links.find((item) => item.id === link.id), link);
    assert.ok(toCsv(state).includes(`"${link.url}"`));
  }
});

test("imports still reject unsafe destinations even when saved URLs match their parameters", () => {
  const { state, input } = fixture();
  const link = createLink(state, { ...input, destination: "https://portal.github.partners/#/page/universe-2026" });
  for (const origin of ["http://portal.github.partners", "https://user:password@portal.github.partners", "https://portal.github.partners:8443"]) {
    const unsafe = structuredClone(state);
    unsafe.links[0].destination = link.destination.replace("https://portal.github.partners", origin);
    unsafe.links[0].url = link.url.replace("https://portal.github.partners", origin);
    assert.throws(() => parseBackup(JSON.stringify(unsafe)), /Destination must/);
  }
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
