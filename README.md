# GitHub Learn campaign links

**[Open the tool](https://v-giulianogemero.github.io/github-learn-link-generator/)**

An unofficial, browser-based UTM builder and personal campaign library for
GitHub Learn and other HTTPS sites. No account, Copilot installation, server, or production build is
required. This project is not affiliated with or endorsed by GitHub.

## Use

Share the **[How to use guide](https://v-giulianogemero.github.io/github-learn-link-generator/#how-to-use)**
with teammates for numbered instructions, channel guidance (including Learning
path), a worked example, QR sharing, library management, backups, and dashboard
explanations. The example is illustrative; it does not create stored records.
The navigation is **How to use | Create link | Link library | Initiatives |
Dashboard**. The main site still opens **Create link** by default; the direct
guide URL opens **How to use**, including after a refresh.

1. Create an initiative with a unique campaign key.
2. Enter any HTTPS destination (`https://learn.github.com/` remains the default),
   choose an email, QR, event, social, partner, or learning path preset, and describe the placement.
3. Generate and save: the saved URL and matching green QR code with the GitHub mark
   appear together automatically. Select **Copy link** or **Download SVG**.
   Scan-test codes before distributing or printing, retaining the white border.

Every saved link gets a QR code, across all six presets and custom channels.
Channels describe distribution/attribution, not which outputs are available.
Rendering or downloading a QR never switches the medium to `qr`, changes any
labels or the unique ID, or creates another record. **QR code** in Link library
uses the same rendering for existing saved URLs.

QRs use square green modules, darker finder patterns, a white four-module quiet
zone, and a small centered GitHub mark on white. The 2,200-character URL limit is
unchanged: byte-mode error correction is H up to 1,273 characters, Q up to 1,663,
and M for longer URLs. The logo backing is capped at 17, 13, or 11 modules
respectively, so dense codes at lower correction lose very little data.
Long URLs produce dense codes; a small screen preview may be too dense to scan.
Enlarge the SVG rather than printing a small preview.
Scan-test the **final size and material** with the devices you expect
people to use. No styling or error correction guarantees universal scanning.
If QR generation fails, the saved URL remains available; an explicit error
directs you to retry from Link library instead of saving a duplicate.

The **Learning path** preset sets `utm_medium=learning_path` and defaults the
source to `learning_path`. As with every preset, you can edit the source before
saving. The channel is also available as a suggestion in the Channel field.

Source, medium, campaign, content, and term are lowercased; spaces become
underscores. Every saved link includes a unique `learn_link_id`. Existing standard
UTM fields and `learn_link_id` before `#` are replaced; other query parameters and
full hash routes, including their own query strings, are preserved. Generated
URLs open the destination directly.

All HTTPS hosts are supported, including
`https://portal.github.partners/#/page/universe-2026`. Tracking parameters are
added to the URL query **before `#`**, not inside the hash route. For example:

```text
https://portal.github.partners/?utm_source=example&utm_medium=email&utm_campaign=example&learn_link_id=example-id#/page/universe-2026
```

Non-HTTPS schemes, embedded credentials, and nondefault ports are rejected.
Explicit HTTPS port 443 is accepted and normalized away. Supporting a host does
not verify its safety or whether its analytics reads these parameters; check
that you trust the destination before sharing. The tool does not visit or
validate the destination's content or sign-in behavior.

Search and filter saved links, group them by initiative, duplicate a record to
create a new ID, or archive and restore records. Archiving does **not** revoke the
URL. The dashboard reports link inventory, not traffic.

## Your library and backups

Each browser profile starts with an **empty library** stored locally in IndexedDB.
The database is named `learn-campaign-links`. Data is scoped to this browser and
origin, not shared with a team or synchronized between devices. Other sites on
the same GitHub Pages origin have the browser's same-origin storage privileges;
do not treat this as encrypted storage or store secrets.

There is no automatic team, Excel, or SharePoint synchronization. Sharing the
guide URL shares instructions, not your library. CSV is for reporting; use JSON
backup/import to preserve or transfer records between browsers.

Clearing site data, private browsing, browser storage eviction, or losing access
to your browser profile can remove the library. **Download JSON backups
regularly**, and keep them in a location appropriate for your campaign data.
Changing the site's origin does not migrate your library; export first and
import on the new site.

- **Download backup** saves the complete version 1 JSON library.
- **Import backup** validates a local file and asks before merging. Existing
  records are kept unchanged. Campaign keys are matched, conflicting IDs are
  rejected atomically, and repeat imports do not create duplicate links.
  Version 1 exports from the original local link manager are compatible.
  Existing Learn links, IDs, and URLs stay unchanged; no migration is needed
  for libraries containing both Learn and other HTTPS destinations.
  Only known library fields are retained.
- **Export all CSV** includes every link, including archived records and notes.
  Spreadsheet formula prefixes are neutralized. Click counts stay blank.

Reads and writes use IndexedDB transactions, so concurrent tabs cannot overwrite
one another's stale library snapshots. BroadcastChannel refreshes open tabs
without sending library content; tab focus and the Refresh button also reload
the latest state. Storage errors and corrupt data are shown explicitly, never
silently replaced with an empty library or claimed to be saved.

Limits: 1,000 initiatives, 20,000 links, and **20 MB for the complete formatted
JSON backup**, whichever is reached first. Writes that would exceed the backup
limit are rejected, keeping the library restorable. Imports are capped at 20 MB.
Generated URLs are capped at 2,200 characters for QR capacity.

## Privacy

The application does not upload your library, import files, notes, or generated
URLs. There are no analytics scripts, tracking pixels, remote fonts, external QR
services, cookies, credentials, or backend APIs in the tool. QR generation uses
the vendored MIT-licensed `qrcode-generator` 2.0.4; its source, integrity, and
license metadata are pinned in `dependencies.json`. The official GitHub mark
comes from the MIT-licensed [Octicons mark-github-16](https://github.com/primer/octicons/blob/ea8e6bb79894cc7e85564ee9b53d86b418738d04/icons/mark-github-16.svg),
bundled locally with its source and full license in `vendor/github-mark.mjs`.
Every downloaded SVG also embeds that attribution and license. Use of the mark
does not imply GitHub endorsement.

GitHub Pages receives ordinary requests for the public site and its static
assets, subject to GitHub's hosting policies. Copying a link uses your system
clipboard; downloads create local files. Opening or sharing a generated link
discloses its URL parameters to the recipient and to the destination site. Never put personal
information or secrets in URL parameters. Backups and CSV files include notes.
The page's content security policy blocks application network connections.

## Click tracking is not connected

There are no real, simulated, estimated, or zero-filled traffic figures. UTMs
and link IDs label URLs; they do not count clicks. A separate approved analytics
integration would need to capture destination events and preserve attribution,
including through sign-in. Attributed visits are not click counts.

Alternatively, a separately hosted and approved redirect service could record
link opens before forwarding to the destination. It would need privacy, access, retention,
and bot-filtering controls. No such service is included. Already distributed
direct links cannot retroactively become tracked redirects, and QR requests
are not the same as camera recognition.

## Development and checks

Production consists only of `index.html`, `styles.css`, `app.mjs`, `core.mjs`,
`storage.mjs`, `qr.mjs`, `favicon.svg`, and the QR/icon vendors. The optional development tools
require a current Node.js LTS release:

```sh
npm ci
npm test
npx playwright install chromium webkit
npm run test:browser
npm run serve
```

The preview is at `http://127.0.0.1:48317/github-learn-link-generator/`, deliberately
using the production subpath. The test-only Node static server is not a backend
and is not used on Pages. Browser tests use isolated profiles and synthetic
fixtures to cover persistence, concurrent tabs, backup restore, rollback,
invalid input, HTTPS host support and portal hash routes, exact decoding of
branded QR previews/downloads with the independent test-only jsQR decoder,
all channels and short/long URLs through the full 2,200-character limit,
clipboard errors, storage failures, text safety,
responsive layouts, guide navigation and example accuracy, and the absence of
campaign-data network requests.

The test-only decoder is pinned to the official jsQR repository commit containing
the prebuilt 1.4.0 distribution. It is not shipped to or loaded by the website.

To run the same browser checks against a deployment without modifying anyone's
existing browser library:

```sh
SITE_URL=https://v-giulianogemero.github.io/github-learn-link-generator/ npm run test:browser
```

## GitHub Pages deployment

Publish this public repository from **Settings > Pages > Deploy from a branch >
main > / (root)** with HTTPS enforced. `.nojekyll` enables direct static serving.
All application asset paths are relative, so the repository subpath works
without rewriting URLs. There is no build or secrets configuration.

Commit and push to `main` normally, without force-pushing. Check the Pages build
and deployed assets before announcing an update. Never commit browser exports,
saved libraries, private campaign data, or local environment configuration.
