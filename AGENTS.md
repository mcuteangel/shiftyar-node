# AGENTS.md — Contributor & AI Agent Guide for Shiftyar

This document provides system standards, architecture overview, conventions, and operational workflows for AI agents and human contributors working on **Shiftyar (شیفت‌یار)**.

---

## 1. Project Overview & Architecture

Shiftyar is a production-ready medical and administrative personnel shift planner built on a Solar Hijri (Jalali) calendar.
It features zero external npm dependencies, running natively on Node.js 22.13+ using built-in SQLite (`node:sqlite`).

### Directory Layout
```text
.
├── server/               # Backend HTTP server and database layer
│   ├── app.js            # Core HTTP router, API handlers, CSRF & RBAC policies
│   ├── auth.js           # Password hashing (scrypt), tokens, rate limiter
│   ├── db.js             # SQLite schema, migrations, connection, seeds
│   └── index.js          # Server bootstrap & process lifecycle entry point
├── web/                  # Vanilla frontend assets (SPA)
│   ├── core.js           # Shared calculation engine (Jalali, shifts, duty, overtime)
│   ├── export.js         # Pure JS XLSX file generator (ZIP & CRC32 builder)
│   ├── ui.js             # UI view rendering, event loop, client state
│   ├── style.css         # Responsive styling (RTL-first, light/dark, print styles)
│   ├── shell.html        # Shell template for single-file artifact bundle
│   └── index.html        # Direct web entry point
├── test/                 # Test suites using node:test
│   ├── core.test.js      # Computational engine, Jalali logic, office patterns
│   ├── server.test.js    # Auth, RBAC, CRUD API endpoints, concurrency
│   ├── requests.test.js  # Leave requests, shift swaps, staff preferences
│   └── export.test.js    # XLSX binary file generation integrity
├── build.py              # Single-file packager (merges web/* into shiftyar.html)
└── data/                 # SQLite database storage (shiftyar.db, WAL files)
```

---

## 2. Core Domain Models & Rules

### Work Types (نوع خدمت)
1. **Rotating / Hospital (`rotating` - شیفت در گردش):**
   - Standard clinical shifts: Morning (`M`), Afternoon (`A`), Night (`N`), and Combos (`MA`, `AN`, `NM`, `MN`).
   - Default duty calculation: `(Month days - Fridays - Official Holidays) * standard daily duty (default 440 mins / 7h 20m)`.
   - Holiday factor: Multiplier (default 1.4 for company/contractual `company` and `t4`, 1.0 for permanent `official`).
   - Crossing midnight shifts: Automatically partitioned and attributed across the two respective days.
   - Shift intervals are calculated as a mathematical union of intervals (intervals overlapping by 30 mins are counted once).

2. **Administrative / Office (`office` - اداری):**
   - Configurable flexible patterns (`officePatterns`) defining active working days and exact working hours for each day of the week (Saturday `0` to Friday `6`).
   - Dynamic monthly duty calculation: Automatically calculated as the sum of scheduled working hours across all non-holiday workdays of that specific month.
   - Daily work calculation: Respects the employee's assigned office pattern hours.
   - Leave credit: Leaves taken on working days credit the employee with the exact scheduled hours of that specific day.

### Special Status Codes (`SPECIAL`)
- `LV`: Paid leave (مرخصی استحقاقی) - counts towards duty credit on non-holiday work days.
- `SK`: Sick leave (استعلاجی) - counts towards duty credit on non-holiday work days.
- `LU`: Unpaid leave (مرخصی بدون حقوق) - 0 credit.
- `RS`: Rest / Off day (استراحت) - 0 credit.
- `AB`: Unexcused absence (غیبت) - 0 credit.

---

## 3. Engineering & Code Standards (STD 100)

1. **Zero External Dependencies Policy:**
   - Never add dependencies to `package.json` for server, crypto, or file processing.
   - Use standard Node.js APIs (`node:http`, `node:crypto`, `node:sqlite`, `node:fs`, `node:path`).
   - The XLSX exporter is custom pure JavaScript (`web/export.js`). Keep it standalone.

2. **Shared Isomorphic Core (`web/core.js`):**
   - `web/core.js` runs both in Node.js (via `require('./web/core.js')`) and in the browser (attached to `window.Core`).
   - Do not use browser-only globals (`window`, `document`) or Node-only globals (`process`, `Buffer`) inside `web/core.js`.

3. **Frontend Bundle Synchronization:**
   - Any modification to files in `web/` (`core.js`, `ui.js`, `style.css`, `export.js`) **must** be followed by running `python build.py` to regenerate the single-file distribution bundle `shiftyar.html`.

4. **Security & RBAC Enforcement:**
   - All state-mutating HTTP requests require:
     - Header: `X-Requested-With: shiftyar`
     - Valid session cookie (`SameSite=Strict`, `HttpOnly`, `Secure` when behind HTTPS)
     - Content-Type: `application/json`
   - Role permissions:
     - `admin`: Full access to all departments, config, people, system settings, and audit logs.
     - `manager`: Restricted strictly to people and schedules within their assigned department(s).
     - `staff`: Read-only access to their own shifts and personal reports.

5. **A4 Landscape Print / PDF Layout:**
   - The roster print view (`table.roster`) must always fit within standard A4 Landscape boundaries (1-page width).
   - In print mode:
     - Personal metadata tags (`contract`, `code`, `workType`) are removed (`th.nm small`).
     - Calculation summary columns (`.sum`) are omitted in calendar printing.
     - Colspan for department headers (`tr.grp td`) must match the actual printed column count.

6. **Git Workflow: Branching, Commit, and PR Requirements:**
   - **Never push directly to `main`**: The `main` branch is strictly protected (including for admins). All changes must go through a dedicated feature or fix branch and be merged exclusively via a **Pull Request (PR)**.
   - For any new task:
     1. Create and switch to a descriptive branch (e.g. `git checkout -b feat/office-shifts` or `git checkout -b fix/time-direction`).
     2. Implement changes, run tests, and regenerate `shiftyar.html` with `python build.py`.
     3. Commit changes with a conventional commit message (e.g. `git commit -m "feat(scope): description"`).
     4. Push the branch to remote: `git push -u origin <branch-name>`.
     5. Open a Pull Request using `gh pr create --base main --head <branch-name> --title "..." --body "..."` (and merge via `gh pr merge --merge` or web interface).

---

## 4. Verification & Testing Protocol

Before creating a PR or completing any feature or bugfix, run and verify the test suites:

```bash
# Run core calculation tests
node test/core.test.js

# Run backend API, RBAC, and auth tests
node test/server.test.js

# Run leave requests and shift swap tests
node test/requests.test.js

# Run Excel export generation tests
node test/export.test.js

# Rebuild single-file artifact
python build.py

# Commit verified changes to git branch
git checkout -b feat/your-feature-name
git add .
git commit -m "feat(scope): concise description of verified change"
git push -u origin feat/your-feature-name

# Create Pull Request into main
gh pr create --base main --head feat/your-feature-name --title "feat(scope): description" --body "Details of changes"
```

All tests must pass cleanly with 0 failures before creating a PR and concluding work.
