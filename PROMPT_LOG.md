# Prompt Log

A chronological record of how Signal was built: what was asked, what was done, what went wrong, the feedback given, and what was decided.

**About the early entries:** entries before 2026-11-11 were reconstructed from commit messages and saved notes, because the original conversations were not kept. Requests in those entries are summaries, not exact wording. Later entries are written as the work happens.

Each entry uses the same headings: **Request**, **Implementation**, **Problems**, **Feedback**, **Decision**.

---

## 2026-11-07 — Put the existing Signal v0.3.5 under version control

**Request:** Start developing Signal from the copy already installed on `D:\Signal`.

**Implementation:** Made `D:\Signal` a Git repository and committed v0.3.5 as-is: React/Vite UI, Node 24 server with built-in `node:sqlite`, migrations 001–004, tests and the Windows launchers (`bfb2beb`).

**Problems:** The installed copy contained private data, caches, a portable Node runtime and build output.

**Feedback:** —

**Decision:** Exclude `data/`, SQLite files, `.cache/`, `.tools/`, `node_modules/`, `dist/` and `release.json` through `.gitignore`, so the repository holds only code.

---

## 2026-11-07 — Make the schema test pass on Windows; update the README

**Request:** Get the project's checks running on Windows and document local development.

**Implementation:** `scripts/check_schema.py` now closes SQLite connections explicitly and reads migrations as UTF-8. The README now covers `D:\Signal` as a Git checkout, the portable Node runtime, port 1421, `py -3` for the schema check and the list of unbuilt modules (`6649988`).

**Problems:** Python's `sqlite3` context manager commits but does not close the connection, so Windows could not delete the temporary folder. Reading migrations used the system locale instead of UTF-8.

**Feedback:** —

**Decision:** Close connections explicitly and always read as UTF-8.

---

## 2026-11-07 — More US funding sources and better lead extraction

**Request:** Find more relevant startups. Early runs surfaced only one qualifying US company.

**Implementation:** Added AlleyWatch, GeekWire, Crunchbase News, TechCrunch Fundraising and PR Newswire VC as sources, and raised the research limit from 30 to 60 candidates per run. Extraction now:
- recognises US locations from phrasing like "<place> startup <Name>", AP state abbreviations ("Kirkland, Wash.") and press-release datelines
- excludes funding roundups, market statistics, investor announcements and acquisitions
- reads company names from correction notices, and from the article's lead paragraph when the headline names people
- ignores publisher subdomains when guessing the company's website

Classification version 6 re-checks stored candidates (`00e0e4b`).

**Problems:**
- FinSMEs returns HTTP 403 to automated readers.
- Captured locations included publisher navigation text.
- A lowercase "us" was being read as the country.
- Investors were sometimes mistaken for the funded company.

**Feedback:** —

**Decision:** Disable FinSMEs and respect its block rather than work around it. A live dry run read 132 articles and found 5 qualifying US companies (up from 1) with no investor false positives. This is the "1 to 5 qualified leads per run" figure used on the résumé.

---

## 2026-11-07 — Code formatting with Prettier

**Request:** Make the code readable.

**Implementation:** Added Prettier 3.3.3 (pinned) with `npm run format` and `npm run format:check`, and formatted `src`, `server` and `scripts`. Captured fixtures and Markdown are excluded (`8fc1e82`).

**Problems:** Much of the code was dense one-line functions.

**Feedback:** —

**Decision:** No change in behaviour, verified by the build, 41 server tests, 8 UI tests and the schema check all passing, and an unchanged CSS bundle hash.

---

## 2026-11-07 — English throughout the interface

**Request:** Use English everywhere in the app.

**Implementation:** Translated every Chinese string in the UI, API errors, research and exclusion reasons, and the Markdown report export. Renamed the "company" section to "Companies" (`e5345fd`).

**Problems:** Database rows already stored keep their Chinese reasons.

**Feedback:** —

**Decision:** Leave stored rows as they are, so only new runs record English reasons. Keep `START_HERE.zh-CN.md` as the Chinese setup guide.

---

## 2026-11-07 — Contacts, Outreach CRM and Follow-up tracker

**Request:** Build the contact, outreach-pipeline and follow-up pages.

**Implementation:**
- **Server (`server/crm.mjs`):** contacts, where an email is unique per company and a contact linked to outreach cannot be deleted. Outreach records with a 7-stage status, where moving to "contacted" records today's date. Follow-ups can be scheduled, completed, dismissed, reopened or snoozed. The dashboard shows real counts per stage.
- **UI:** three new pages, plus "Add to outreach" / "In outreach" on company cards.
- **Tests:** 46 server tests and 11 UI tests pass.

All of this landed in `285f2ea`.

**Problems:** The same change also included things that were not requested: the Companies page's 3-second polling was changed to poll only during a search, and a missing space in a label was fixed.

**Feedback:** "If I didn't say to change it, don't change any of my features."

**Decision:** From now on, only what is explicitly requested gets changed. Anything else that looks worth changing is suggested first and done only after a yes.

---

## 2026-11-07 — Cold Email Generator

**Request:** Generate cold emails from the company, funding and contact data.

**Implementation:**
- **Templates:** migration 005 adds an editable `email_templates` table with one default template. Personal background lines are `[bracketed]` placeholders and are not stored in code.
- **Placeholders:** `server/email.mjs` fills `{{company}}`, `{{first_name}}`, `{{funding}}`, `{{role}}` and the other placeholders, leading with PM, GTM or Data. Unknown placeholders stay visible.
- **Drafts:** saved per outreach record.
- **The page:** lets you generate, edit, save, copy or open a draft in your email app, and edit the template.
- **Tests:** 50 server tests and 12 UI tests pass.

This shipped in `825fc52`, and the README was updated in `95ade1c`.

**Problems:** —

**Feedback:** —

**Decision:** Signal never sends email itself. "I sent it" records a manual send and moves the outreach record to "contacted".

---

## 2026-11-07 — Simplify the company card

**Request:** Six specific changes to the company card:
1. Show one email: the CEO's, otherwise the recruiting email, otherwise another public email, otherwise "Not found".
2. Remove phone numbers.
3. Show an "HQ" label and remove offices.
4. List founders by name, each linking to LinkedIn.
5. Show the website as a clickable domain.
6. Show the business as a short phrase.

**Implementation:** Did exactly those six. Founders link to the LinkedIn profile research found, otherwise to a LinkedIn people search. When research found no founders, they are read from the funding article, but only when the text ties them to this company (`3d0d0a4`).

**Problems:** Funding articles sometimes name investors who founded other companies.

**Feedback:** Applied the "only change what is asked" rule from the previous feedback.

**Decision:** Display-only change; stored data is not modified. Hiring roles, evidence, X/LinkedIn links and "Add to outreach" are unchanged.

---

## 2026-11-11 — Save résumé PDFs through Signal's server

**Request:** Let the "Print / Save as PDF" button on the recruiting site save résumés as PDF files.

**Implementation:** `server/resume-pdf.mjs` adds `POST /api/resume-pdf`. It accepts the page only from a local origin (the site opened from disk, or localhost), renders it to PDF with locally installed Chrome or Edge, and saves it to `resumes/`. It has its own test, and `resumes/` was added to `.gitignore` (`1a00fc3`).

**Problems:** The recruiting site is opened from disk, so its requests arrive with origin `null` and as plain-text posts.

**Feedback:** —

**Decision:** Allow only a `null` origin (a page opened from disk) or a local origin, cap requests at 512 KB, and keep saved résumés out of Git because they contain personal details.

---

## 2026-11-11 — Publish Signal on GitHub

**Request:** "Why is Signal not on GitHub?" Then: "Check .gitignore, then push to GitHub."

**Implementation:**
- **Privacy check:** reviewed `.gitignore` and scanned every commit for emails, phone numbers, API keys, tokens and local paths. No private data had ever been committed.
- **Commit:** committed the pending changes.
- **Remote:** connected the repository to https://github.com/Scarlett2025Lee/Signal.
- **Push:** merged GitHub's starter commit and pushed `main` (`48bde8f`).

**Problems:**
- The private `recruiting-assistant` repo looked like Signal because its `site/index.html` is Signal's single-page prototype, but the real app had never been pushed anywhere.
- The new GitHub repo was created with a 2-line README, so the first push was rejected.

**Feedback:** —

**Decision:**
- Keep `recruiting-assistant` private, since it holds résumés, contacts and application materials.
- Publish Signal in its own repository.
- Merge GitHub's starter commit, keeping the project's full README, instead of force-pushing over it.
- Exclude `data/` (contacts, CRM, drafts) and `resumes/` from GitHub.

---

## 2026-11-11 — Start this prompt log

**Request:** "Create a PROMPT_LOG.md file in the project root. After each significant feature implementation or design decision, record the original request, implementation summary, problems encountered, my feedback, and the final decision. Keep entries chronological."

**Implementation:** Created this file. Entries for earlier work were rebuilt from commit history. Added `CLAUDE.md`, which tells future sessions to append an entry after each significant feature or design decision.

**Problems:** The original wording of earlier requests was not saved, so those entries summarise the request instead of quoting it.

**Feedback:** —

**Decision:** New entries are added at the bottom and quote the request where possible.
