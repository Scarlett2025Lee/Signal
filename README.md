# Signal · Local job-search website

React + TypeScript + Vite, with a small Node.js 24 HTTP server and embedded SQLite. The website runs on your own computer, stores data in the project folder, and needs no Tauri, Rust, Python, database server, or cloud account.

`D:\Signal` is the project root and a local Git repository (branch `main`). Commands below run from this folder.

For Windows on D:, see [中文启动说明](START_HERE.zh-CN.md).

## Current capabilities (v0.3.5)

Company Discovery is one combined page for final eligible companies. Funding Feed bookmarks redirect there. No candidate-review/save workflow or separate company-entry page is required.

The background pipeline detects financing events (not generic verbs like closes compliance gaps), reads publisher articles beyond RSS excerpts, finds company-specific US base/HQ evidence and source URLs, follows the official company link and linked public about/team/contact/careers pages, and reads official-linked Greenhouse/Lever/Ashby boards. It collects business summary, company socials, founders and publicly posted contact links, public locations and PM/GTM/Data role titles. Sources, evidence and checked dates are retained. Explicit headquarters statements are required; an Organization mailing address alone does not prove headquarters. Conflicts, non-US/late-stage/debt/acquisition/non-funding news and incomplete company-page research are excluded from visible results. Unknown public contact fields say that the checked pages did not contain them, not that no such information exists anywhere.

Results cover US AI/Fintech companies, Pre-seed to Series B, with financing news published in the seven-day New York calendar window. The displayed date is the news-publication date, not proof of funds closing. There is no exhaustive web-search provider or LinkedIn scraping; this is bounded research of reachable publisher/official pages. At most 60 news candidates per run (`MAX_RESEARCH`) are researched with four workers. Coverage/failures remain report-level diagnostics, never manual company tasks.

Existing incorrect unconfirmed articles are retained privately but removed from displayed results. Schema 004 triggers a new automatic run after upgrade; old confirmed data remains intact and is re-enriched when encountered. Weekly scheduling, exports, D-drive storage and automatic updates remain available.

**Contacts, Outreach CRM and Follow-ups.** Contacts are kept per company (founders found by research appear automatically). Outreach records move through seven stages (Research → Ready → Contacted → In conversation → Interviewing → Offer → Closed); moving to Contacted records today's date. Follow-ups can be scheduled, completed, snoozed or dismissed, and due ones are counted on the Dashboard. A company card on Companies has "Add to outreach".

**Cold Email Generator.** Fills an editable template (stored in SQLite) from the company's funding, description, location, open PM/GTM/Data roles and the contact's first name, leading with the chosen track. Drafts are saved per outreach record and can be copied or opened in your email app. Signal never sends email; "I sent it" only records a manual send. The default template has [bracketed] lines for your own background: fill them once in "Edit template". The description comes from the company website's meta description, which is sometimes a slogan, so review that line.

The interface is in English. Resume / Project matching is still a placeholder.

## Source access and coverage

Public RSS feeds have limited history and can fail, block clients or change their URL. Coverage limits and failures are shown per source; zero retrieved records do not establish no funding occurred. Heuristic extraction produces candidates requiring review, not verified facts. Historical Markdown digests are not silently imported.

Active sources (`ACTIVE_SOURCES` in `server/funding-sources.mjs`): FinTech Global, Tech.eu, AlleyWatch, GeekWire, Crunchbase News, TechCrunch Fundraising and PR Newswire VC. FinSMEs is kept in the list but marked `disabled`: it answers automated RSS readers with HTTP 403, and Signal respects that block rather than disguising its client. GeekWire likewise refuses article pages (403) while allowing its RSS, so its RSS text is used as the evidence. The PR Newswire feed has no pagination, so each run sees only about one day of releases.

US evidence can come from "‹place›-based ‹Company›", "‹Company›, headquartered in ‹place›", "‹place› startup ‹Company›", AP-style states ("Kirkland, Wash."), and a press-release dateline that introduces the company ("REDWOOD CITY, Calif., Nov. 5, 2026 /PRNewswire/ -- ‹Company›"). Funding roundups, market statistics, investor-side announcements ("X Announces Investment in Y") and acquisitions are excluded. Classification version 6 re-checks stored candidates and triggers a fresh run.

A live dry run on 2026-11-07 read 132 articles and included 5 US companies, up from 1 with the original three sources. A single run can still lose a source to a timeout; that is reported per source.

Destinations: fintech.global, tech.eu, www.alleywatch.com, www.geekwire.com, news.crunchbase.com, techcrunch.com, www.prnewswire.com, plus their configured www/non-www redirects. No API key is needed. Production/development launchers respect inherited HTTP proxy settings via Node's --use-env-proxy.

## Development

Use Node.js 24.19.x or later within version 24 (its built-in `node:sqlite` supplies SQLite) and npm. A globally installed Node may be older; the launcher's portable copy in `.tools/` is the right version. In Git Bash, from `D:\Signal`:

```sh
export PATH="/d/Signal/.tools/node-v24.19.0-win-x64:$PATH"
npm ci        # only needed if node_modules is missing or package-lock.json changed
npm run dev
```

Stop any `Start-Signal.cmd` server first: both it and the development API use port 1421.

This starts the API on loopback port 1421 and Vite on loopback port 1420. Open `http://127.0.0.1:1420` **on the same computer**. The Vite proxy forwards `/api` to the local backend. Ctrl+C stops both processes. `npm run dev:ui` alone starts only the frontend and cannot supply database counts.

## Run the built website

```sh
npm run build
npm start
```

Open `http://127.0.0.1:1421` on the computer running the server. This is a local website, not a published Internet address. Servers in a cloud task do not make your laptop's localhost work. The service binds only to `127.0.0.1` and rejects unrecognized Host headers; do not expose this personal-data scaffold to the Internet without a separate deployment/authentication design.

The Windows launcher `Start-Signal.cmd` calls `Start-Signal.ps1`. It requires the project to be on D:, downloads portable Node 24.19.0 from nodejs.org on first use, checks the official SHA-256 manifest, installs locked dependencies, builds the website, and starts it. Tools, npm cache, process temporary files, and database all use directories under the project on D:. It needs Internet access for the first setup, but does not install Node globally. The launcher prints five progress stages, keeps the CMD window open on exit, and saves diagnostics under `.cache/logs/`. Once the health endpoint confirms SQLite is connected, it opens Chrome with a separate profile/cache under the project on D:. `Open-Signal.cmd` remains available to reopen the browser. The launcher owns its server process and stops it when interrupted.

The launcher has run successfully on Windows 11 (see `.cache/logs/startup.log`). Because this folder is a Git checkout, its automatic update step stops before writing any file and the launcher continues with the local code (see Automatic updates). Windows itself, PowerShell, antivirus, and an already installed browser may still use system files on C:; the application cannot guarantee zero system-disk writes.

## Storage

By default, `data/signal.sqlite3` lives under this project, regardless of the shell's working directory. Override it with the absolute path `SIGNAL_DATA_DIR`; relative/empty values are rejected. An unavailable directory causes startup to fail, without a fallback to AppData. Default production port is 1421; `SIGNAL_PORT` can override it when running just the built server. Development's Vite proxy and the Windows browser launcher use 1421.

Migrations 001–005 are applied transactionally in order using `PRAGMA user_version`, preserving a populated v1 database. Existing records survive restart. A database created by a newer application version is rejected. Foreign keys are enabled per connection. No sample companies or personal documents are seeded. If you used an older desktop scaffold, close it and back up its database before copying it to the new selected data directory; no old data is moved or deleted automatically.

Amounts use integer minor units with an explicit currency. Funding dates use `YYYY-MM-DD`; future write endpoints should normalize timestamps to UTC ISO 8601 ending in `Z`. Match scores range from 0 to 100, and each match names exactly one resume or project with a rationale. Outreach protects linked company/contact history from deletion. Deleting outreach cascades its drafts, matches, and reminders. The backend exposes typed funding/report/review/export, company-profile, health and aggregate endpoints. JSON writes have size/origin checks; arbitrary SQL and filesystem operations are not exposed.

Back up the entire `data` folder with the server stopped before upgrades. Its contents are private plain-text SQLite data and are ignored by Git. Resume uploads have not yet been built.

## Offline layout preview

```sh
npm run preview:export
```

Copy `dist/signal-preview.html` to any folder on D: and open that file in Chrome or Edge. Scripts and styles are embedded. This is a navigation/layout preview only: it does not connect to SQLite or save records. Use the full local website for SQLite.

## Validation

```sh
npm run build
npm test
npm run test:server
npm run test:schema
npm run format:check   # Prettier; `npm run format` rewrites files
```

UI tests cover funding review/generation/errors, company source links/editing, navigation, routes, offline state, counts and retry. Server tests cover legacy migration, date/exclusion/deduplication logic, review/evidence validation, retained contact history, complete HTTP mutations/exports, persistence, routing and access boundaries. Schema tests use Python 3's standard library as an optional developer check; Python is not needed to run the website. `npm run test:schema` calls `python3`, which on Windows is often only a Microsoft Store alias; run `py -3 scripts/check_schema.py` instead.

## Structure

```text
src/App.tsx                         Shell, routes, dashboard, placeholders
src/FundingFeed.tsx                 Researched-company results page (/companies)
src/UpdateNotice.tsx                Update banner
src/Contacts.tsx, Outreach.tsx      Contacts and Outreach CRM pages
src/FollowUps.tsx, ColdEmail.tsx    Follow-up tracker and Cold Email Generator
src/crm.tsx                         Shared page helpers (loading, company picker)
src/lib/api.ts, database.ts         Typed HTTP clients
server/database.mjs                 Local storage, migrations, aggregate SQL
server/app.mjs                      HTTP API and built static website
server/index.mjs                    Server lifecycle and loopback binding
server/funding.mjs                  Report generation, eligibility, saving
server/funding-sources.mjs          RSS sources, parsing, classification
server/location-research.mjs        Article/official-page US evidence, safe fetch
server/company-research.mjs         Website, founders, socials, ATS job boards
server/companies.mjs                Company profile read/update service
server/crm.mjs                      Contacts, outreach and follow-up API
server/email.mjs                    Email template filling and drafts API
server/updates.mjs                  Update status/restart endpoint
database/migrations/                Versioned schema upgrades
scripts/dev.mjs                     Frontend + backend development runner
scripts/update-core.mjs / -cli.mjs  Automatic updater
scripts/make-release.mjs            Release ZIP/manifest (writes to ../downloads)
Start-Signal.cmd / .ps1             D-drive Windows setup/start
Open-Signal.cmd / .ps1              Separate D-drive Chrome profile
```

Not built yet: Resume / Project matching (its tables exist in migration 001) and resume upload.

## Automatic updates (v0.3)

Windows users on older versions run the one-time downloads/Install-Signal.zip bootstrap. It pins the installer script's SHA-256, downloads the HTTPS release manifest and ZIP, verifies ZIP/file hashes, stages dependencies on D:, and calls the same transactional Node updater used by normal startup. Existing files are backed up rather than blindly overwritten. All tools/caches/backups remain below D:\Signal. First bootstrap requires stopping the old server; subsequent managed restarts are automatic.

Start-Signal.ps1 holds an exclusive launch lock, ensures Node/dependencies, checks the channel, and restarts itself after an update so new startup instructions take effect. The website can request a managed restart via a JSON POST; the server closes SQLite and exits with code 75. The launcher then updates while the website is stopped, rebuilds, checks exact release version and DB health, confirms, and opens Chrome. Unmanaged npm start sessions show restart instructions instead of trying to terminate an unknown parent.

Update packages are limited to this GitHub repository and program-path allowlist. No archive entry can target data, tools, caches, parent paths, device names, or linked program paths. Installed file inventories permit removing obsolete managed files while retaining user-created unknown files. SQLite is snapshotted before migration; previous dependency directories are retained by rename. Interrupted/unconfirmed or failed startups restore program, dependencies, and the pre-update database. Once a release is healthy and confirmed, later user activity is not automatically rolled back. Keep two generated rollback directories; generated backups are private data and excluded from packages.

GitHub/network/checksum failure leaves current code in place. Failed releases are temporarily blocked until a newer version is published. A Git checkout is not automatically replaced: when `.git` exists, the update check fails before any file, dependency or database is touched, the launcher prints a warning and starts the local code. Pull upstream changes with Git instead. Updates rely on public/noninteractive HTTPS access to the configured repository; no credentials are embedded. TLS is always verified. Windows process coordination is syntax-checked but not fully Windows-tested; core upgrade/recovery and actual packaged-server startup were tested in an isolated Linux installation with a retained legacy DB.

To publish future iterations: bump package.json/package-lock.json version, run npm run release, then commit/push source, downloads/Signal.zip, SHA file, update.json and generated installer assets together to codex/signal-web. Never publish a ZIP and manifest from different builds. The release script creates release.json inside the ZIP with per-file hashes; it is ignored in the working checkout. Use a strictly newer semantic version so installed clients receive fixes. No further user file replacement is required after bootstrap.

Live HTML/publisher/ATS success remains unverified in this cloud instance because outbound source access is restricted. End-to-end automatic research, extraction, eligibility, legacy repair and unified UI are validated with explicit fictional fixtures. HTTPS/DNS/redirect checks reject private targets and preserve configured proxies.

## v0.3.3: core eligibility and optional data

Core gates are US location evidence, AI/Fintech industry, Pre-seed–Series B and a recent funding news event. A failed optional website/team/careers/contact fetch no longer excludes a company passing those gates; attempted-but-unavailable fields stay empty with explicit access/availability wording. RSS location evidence is retained when the full article omits it. Startup reruns research after this algorithm upgrade. Report diagnostics show read/candidate/included counts and omitted reasons; these are not manual review tasks. Retrieval is still bounded to the configured sources and is not a general web-search engine.

## v0.3.4 eligibility contract

Exactly four conditions apply: recent funding news within seven days, a US company, AI or Fintech, and Pre-seed/Seed/Series A/Series B. Country membership is independent of a detailed headquarters address. Explicit US/American company descriptions or matched company country metadata can establish country without a city. Headquarters, socials, founder/contact data and jobs are nullable enrichment fields. The hiring dropdown has been removed. Missing country extraction is diagnosed as a retrieval failure, never proof the company is not American. A public-article-only diagnostic export supports debugging without manual company verification.

## v0.3.5 reported-input regression

The uploaded October 31 retrieval diagnostics exposed a missed Avante Series A: the headline described rising insurance costs while the lead explicitly reported Seattle, AI and a $30m Series A. Funding detection now accepts the lead as well as the headline. VC fund closes remain excluded, and the current round is read before historical round mentions. Country diagnostics retain underlying fetch failures. Classification version 5 triggers a fresh retrieval after update. Regression coverage replays public article text from that diagnostic through SQLite and the visible results API, with optional pages blocked.

This fixes the demonstrated missed result. It does not resolve FinSMEs HTTP 403 or establish comprehensive market coverage.
