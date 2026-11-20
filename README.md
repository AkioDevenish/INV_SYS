# IICA-TT Internal System

A self-hosted internal operations and registry system for the **IICA Delegation in Trinidad and Tobago**. It brings together asset **inventory & stock control**, **project life-cycle tracking**, a shared **delegation calendar**, **staff timelines**, and directories for **stakeholders** and **vendors**, backed by server-enforced role permissions and an append-only audit trail.

The system name and organisation strings live in one file, `src/lib/brand.ts`; changing `APP_NAME` or `ORG_SHORT` updates the sidebar, page titles, sign-in screen, and export filenames.

Built on free, open-source tooling (Next.js 16, React 19, TypeScript, Tailwind CSS v4, PostgreSQL via `postgres.js`), it runs locally, in GitHub Codespaces, on any Node host, or on Vercel with Neon/Supabase Postgres.

---

## Features

**Dashboard** (`/dashboard`)
- Per-user customisable panel layout saved in `dashboard_layouts` (reorder or hide panels without affecting anyone else; newly added panels appear automatically for existing users)
- Live stock snapshot, upcoming calendar events, and quick export dialog

**Projects** (`/projects`, `/projects/[id]`, `/projects/lists`)
- Full project life-cycle records: status, model phase, funding status, programme areas, tags, assigned staff and roles, stakeholders, funding lines, progress updates, action items, documents, and lessons learned
- Reference lists (statuses, phases, funding statuses, programme areas, roles, tags) are editable in `/projects/lists` by users with `projects.manage`
- Assigned project members can add updates/lessons and close their own actions even without `projects.manage`

**Calendar** (`/calendar`)
- Shared delegation calendar for meetings, missions, leave & vacation, public holidays, deadlines, and general events in Trinidad time (`America/Port_of_Spain`, AST / UTC-4)
- Import from Excel workbooks, CSV, or `.ics`; export to `.xlsx`, `.csv`, `.ics`, or `.json`
- Supports automated SharePoint pulls and webhook pushes via `/api/calendar/sync` (configured for hourly Vercel Cron in `vercel.json`)

**Staff Timelines** (`/timelines`)
- Targets and tasks organised by office area with lead, priority, status, target dates, progress percentage, and notes
- Task owners can update progress on their own tasks; managers can add/edit tasks and import timeline workbooks

**Inventory & Stock Control** (`/inventory`, `/inventory/[id]`, `/movements`)
- Item catalogue with SKU / asset code, category, storage location, unit of measure, minimum stock level, unit cost, supplier, physical condition, and condition notes
- Tabbed views for the main catalogue, IT items, flagged condition status, Filling Cabinet, CABI, and stock movements
- Search, filters (category, location, stock level, condition, location group), sorting, bulk spreadsheet import, and filtered exports
- **Movements** (`/movements`): Atomic **Receive** (`IN`), **Issue** (`OUT`), and **Correct** (`ADJUST`) stock movements inside a PostgreSQL transaction (`SELECT ... FOR UPDATE`), rejecting over-issues and storing running balances in an append-only log

**Reporting** (`/reports`)
- Live valuation and inventory totals (total value, units held, low-stock and out-of-stock counts, average item value)
- 30-day inbound/outbound movement SVG chart, category and location value breakdowns, and highest-value items

**Stakeholder Directory** (`/stakeholders`, `/stakeholders/[id]`)
- Contact records with organisation, job title, primary and alternate emails/phones, location, website, social media, gender, age group, and notes, organised by stakeholder group
- Search across contact fields; filter by group or contact completeness (`email`, `phone`, `nocontact`); paginated 50 per page
- Filtered exports (`.xlsx`, `.csv`, `.json`) covering the full matching result set, plus bulk Excel workbook import (`scripts/import-stakeholders.mjs`)

**Vendors** (`/vendors`)
- Supplier and service-provider directory with category grouping, status, rating, price tier, turnaround, contact/tax/payment details, contract & billing schedules, and service/spend engagement logs
- Financial/spend fields and export columns are gated on `reports.view`
- Workbook import and multi-sheet `.xlsx` / `.csv` / `.json` exports via `/api/export/vendors`

**Taxonomy** (`/taxonomy`)
- Manage built-in **Inventory categories**, **Storage locations**, and **Stakeholder groups** in one place (`/categories` and `/locations` redirect here)

**Administration & Auth** (`/users`, `/audit`, `/profile`, `/setup`, `/change-password`)
- **First-run setup** (`/setup`): When the database has no user accounts, the app creates its tables automatically and walks you through creating the first Administrator in the browser, then permanently locks `/setup`
- **Mandatory password rotation** (`/change-password`): Any user created or reset with a temporary password (`must_change_password = true`) is redirected here on sign-in and blocked from all app routes and exports until they choose their own password
- **Users & Access Matrix** (`/users`): Manage accounts, roles, disabling/deletion (protected against removing the last active administrator), and edit the live role-permission matrix
- **Audit trail** (`/audit`): Paginated, filterable append-only log of sign-ins, stock movements, imports, permission changes, and record mutations

---

## Access levels & permissions

Permissions are checked on the server in every page, server action, and API route. Four roles exist (`ADMIN`, `MANAGER`, `STAFF`, `VIEWER`), and the live matrix is stored in PostgreSQL (`role_permissions`) and edited in **Users & access -> Access levels** without a redeploy.

**ADMIN** is permanently locked with `users.manage` on both read and write so the system can never be made unadministrable. **Reset to defaults** restores the 15 permissions below (`src/lib/roles.ts`):

| Permission            | What it grants                                                | Admin | Manager | Staff | Viewer |
| --------------------- | ------------------------------------------------------------- | :---: | :-----: | :---: | :----: |
| `inventory.view`      | View Dashboard, Inventory and item records                    |   ●   |    ●    |   ●   |   ●    |
| `inventory.manage`    | Create, edit and delete inventory items                       |   ●   |    ●    |   -   |   -    |
| `movement.record`     | Record stock receipts, issues and corrections                 |   ●   |    ●    |   ●   |   -    |
| `taxonomy.manage`     | Manage inventory categories & storage locations               |   ●   |    ●    |   -   |   -    |
| `reports.view`        | View valuation reports, vendor costs and download exports     |   ●   |    ●    |   ●   |   ●    |
| `stakeholders.view`   | View Stakeholders and Vendors directories                     |   ●   |    ●    |   ●   |   ●    |
| `stakeholders.manage` | Create, edit and delete stakeholders, vendors and groups      |   ●   |    ●    |   -   |   -    |
| `calendar.view`       | View the shared delegation calendar                           |   ●   |    ●    |   ●   |   ●    |
| `calendar.manage`     | Create, edit, delete and sync calendar events                 |   ●   |    ●    |   -   |   -    |
| `timelines.view`      | View staff timelines and targets                              |   ●   |    ●    |   ●   |   ●    |
| `timelines.manage`    | Create/edit timeline tasks and import workbooks               |   ●   |    ●    |   -   |   -    |
| `projects.view`       | View project records, funding, documents and lessons          |   ●   |    ●    |   ●   |   ●    |
| `projects.manage`     | Create/edit projects and manage project reference lists       |   ●   |    ●    |   -   |   -    |
| `users.manage`        | Manage user accounts and edit the permission matrix           |   ●   |    -    |   -   |   -    |
| `audit.view`          | View the append-only audit trail                              |   ●   |    -    |   -   |   -    |

---

## Export & Sync API

All `/api/export/*` routes require an authenticated session, reject accounts with `mustChangePassword`, enforce per-dataset permissions, neutralize spreadsheet formula injection, and return `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`:

- `GET /api/export` - Combined multi-dataset export (`datasets=stakeholders,inventory,movements,users,audit`, `format=xlsx|csv|json`, plus item/stakeholder/group filters)
- `GET /api/export/inventory` - Filtered inventory export (`csv`, `xlsx`, `json`)
- `GET /api/export/stakeholders` - Filtered stakeholder directory export (`csv`, `xlsx`, `json`)
- `GET /api/export/vendors` - Vendors, contracts & utilities, and engagement history (`xlsx`, `csv`, `json`; `dataset`/`datasets`, `group`, `status`)
- `GET /api/export/calendar` - Calendar export (`xlsx`, `csv`, `ics`, `json`; `scope=all|day|week|month|year|custom`, `type`)
- `GET|POST /api/calendar/sync` - Read-only sync status (browser session) or SharePoint/webhook `.xlsx` sync (authenticated session with `calendar.manage` or `CRON_SECRET` / `CALENDAR_SYNC_SECRET`)

---

## Run it in your browser (Codespaces)

The repository includes a `.devcontainer/` setup for **GitHub Codespaces**, which starts PostgreSQL alongside the Next.js app, installs dependencies, runs `npm run seed`, and forwards port `3000`.

1. On the repository page, choose **Code -> Codespaces -> Create codespace on main**.
2. Wait for setup to complete and open the forwarded port `3000`.
3. Sign in with the seeded administrator credentials (default `admin@iica.org` / `ChangeMe123`, prompting for an immediate password change on `/change-password`).

---

## Getting started locally

Requires **Node.js >= 20.9.0** (Node 22 recommended; enforced in CI and `package.json` `engines`) and a PostgreSQL database.

On macOS with Homebrew:

```bash
brew install postgresql@17 && brew services start postgresql@17 && createdb iica_inventory
```

Install dependencies and configure `.env.local`:

```bash
npm install
cp .env.example .env.local
```

Set your database connection string and session secret in `.env.local`:

```bash
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require
AUTH_SECRET=<output of: openssl rand -hex 32>
```

Create the schema, default permissions, and first administrator, then start the dev server:

```bash
npm run db:setup   # alias for `npm run seed`
npm run dev
```

Or specify custom initial administrator credentials when seeding:

```bash
ADMIN_EMAIL=you@iica.org ADMIN_PASSWORD='a strong password' npm run db:setup
```

If `ADMIN_PASSWORD` is omitted, `npm run db:setup` / `npm run seed` creates the default password `ChangeMe123` with `must_change_password = true` so the user must choose a new password on first sign-in.

To drop all tables and rebuild from scratch (permanently deletes all data):

```bash
npm run seed -- --reset
```

Open <http://localhost:3000>. If you skip `npm run db:setup` on an empty database, the app automatically creates the schema and redirects to `/setup` so you can create the first administrator in the browser.

---

## NPM scripts & tooling

| Script              | Command                            | Purpose                                                        |
| ------------------- | ---------------------------------- | -------------------------------------------------------------- |
| `npm run dev`       | `next dev`                         | Start the local development server                             |
| `npm run build`     | `next build`                       | Build the production bundle                                    |
| `npm run start`     | `next start`                       | Serve the production build                                     |
| `npm run typecheck` | `next typegen && tsc --noEmit`     | Generate Next.js route types and run TypeScript type checking  |
| `npm test`          | `node --test tests/*.test.mjs`     | Run automated regression tests using Node's built-in test runner |
| `npm run db:setup`  | `node scripts/seed.mjs`            | Create schema, permission defaults, and initial administrator  |
| `npm run seed`      | `node scripts/seed.mjs`            | Same as `db:setup` (supports `-- --reset`)                     |

> **Note on `npm run lint`:** `package.json` keeps `"lint": "next lint"` for compatibility, but `next lint` was removed in Next.js 16 and ESLint is not configured in this repository. Use `npm run typecheck` and `npm test` (also run on every push/PR in `.github/workflows/ci.yml`).

### CLI utility scripts (`scripts/`)

- `node scripts/add-users.mjs [--role ADMIN|MANAGER|STAFF|VIEWER] [--file roster.txt] <emails...>` - Bulk-create accounts in one transaction with generated one-time temporary passwords
- `node scripts/reset-passwords.mjs "<connection-string>" <output-file> [--yes]` - Rotate all account passwords transactionally and write credentials to a `0600` file
- `node scripts/migrate-to-remote.mjs "<connection-string>" <dump.sql>` - Apply schema, restore a `pg_dump` file into a fresh database, reset `SERIAL` sequences, and flag accounts for password rotation
- `node scripts/import-stakeholders.mjs [--replace] [--dry-run] [--skipped-file path] <workbook.xlsx>` - Import the stakeholder workbook (writes unnameable contact rows to `skipped-stakeholder-rows.txt`)
- `node scripts/import-vendors.mjs <vendors.xlsx>` - Import vendors from an Excel workbook
- `node scripts/import-calendar.mjs <calendar.xlsx | --repair>` - Import the monthly calendar workbook or repair existing calendar records
- `node scripts/link-task-owners.mjs ["<connection-string | --env>"] [--yes]` - Match timeline task leads/initials to active user accounts
- `node scripts/export-timelines-for-lists.mjs "<connection-string | --env>" <out.xlsx>` - Export staff timelines shaped for Microsoft Lists

---

## Configuration (Environment variables)

All environment variables below match `.env.example`, `src/lib/db.ts`, `next.config.ts`, `src/lib/calendar-*.ts`, and `scripts/`:

| Variable                   | Required      | Purpose                                                                                             |
| -------------------------- | ------------- | --------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`             | yes*          | PostgreSQL connection string                                                                        |
| `DATABASE_URL_UNPOOLED`    | no            | Direct/unpooled Postgres URL; preferred by `src/lib/db.ts` and scripts ahead of `DATABASE_URL`      |
| `POSTGRES_URL_NON_POOLING` | no            | Alias for `DATABASE_URL_UNPOOLED` (set by Vercel Postgres / Neon integrations)                      |
| `POSTGRES_URL`             | no            | Fallback alias for `DATABASE_URL` (set by Vercel Postgres / Neon integrations)                      |
| `AUTH_SECRET`              | in production | Signs the session cookie (`openssl rand -hex 32`, min 32 chars in production; fallback used in dev) |
| `NEXT_PUBLIC_CURRENCY`     | no            | ISO 4217 currency code used for inventory valuations (defaults to `USD`)                            |
| `ALLOWED_DEV_ORIGINS`      | no            | Comma-separated origins allowed for Next.js dev HMR requests (`next.config.ts`)                     |
| `CALENDAR_SYNC_SECRET`     | no            | Webhook bearer / `x-sync-key` secret for `/api/calendar/sync` (min 32 chars in production)          |
| `CRON_SECRET`              | no            | Bearer token used by Vercel Cron to authorize `GET /api/calendar/sync`                              |
| `SHAREPOINT_CALENDAR_URL`  | no            | SharePoint calendar workbook URL stored when seeding or importing calendar sync config              |
| `MS_TENANT_ID`             | no            | Microsoft Entra tenant ID for Graph API SharePoint sync                                             |
| `MS_CLIENT_ID`             | no            | Microsoft Entra app client ID for Graph API SharePoint sync                                         |
| `MS_CLIENT_SECRET`         | no            | Microsoft Entra app client secret for Graph API SharePoint sync                                     |
| `MS_GRAPH_ACCESS_TOKEN`    | no            | Optional pre-acquired Microsoft Graph bearer token                                                  |
| `SHAREPOINT_COOKIE`        | no            | Optional SharePoint session cookie fallback                                                         |
| `ADMIN_NAME`               | no            | Initial administrator display name for `npm run seed` / `db:setup` (default: `IICA Administrator`)  |
| `ADMIN_EMAIL`              | no            | Initial administrator email for `npm run seed` / `db:setup` (default: `admin@iica.org`)             |
| `ADMIN_PASSWORD`           | no            | Initial administrator password for `npm run seed` / `db:setup` (default: `ChangeMe123` + forced rotation) |

\* At least one of `DATABASE_URL_UNPOOLED`, `POSTGRES_URL_NON_POOLING`, `DATABASE_URL`, or `POSTGRES_URL` must be set at runtime. Connecting is deferred until the first query, so `next build` does not require a live database.

`src/lib/db.ts` prefers direct/unpooled connection strings (`DATABASE_URL_UNPOOLED` / `POSTGRES_URL_NON_POOLING`) when present because transaction-mode poolers (such as Neon `-pooler`) strip startup `search_path=public`, `statement_timeout`, and `idle_in_transaction_session_timeout` parameters. In serverless deployments (`VERCEL` set), `max` is capped at `1` per instance and `prepare: false` is enabled for pooler compatibility; SSL is enforced in production for non-local hosts.

---

## Deploying to Vercel

1. Push this repository to GitHub and import it at [vercel.com/new](https://vercel.com/new).
2. Connect a PostgreSQL database (for example Neon or Supabase) so `DATABASE_URL` (and optionally `DATABASE_URL_UNPOOLED`) is populated.
3. Set `AUTH_SECRET` (`openssl rand -hex 32`) and any optional sync variables (`CRON_SECRET`, `CALENDAR_SYNC_SECRET`, `MS_*`) under **Settings -> Environment Variables**.
4. Deploy. Open the deployed URL to complete `/setup` in the browser, or run `npm run db:setup` against the same database beforehand.

---

## Project structure

```text
src/
  app/
    (auth)/
      login/                 Sign-in page and actions
      setup/                 First-run administrator setup (auto-locks once a user exists)
      change-password/       Forced password rotation for temporary passwords
    (app)/                   Authenticated workspace
      dashboard/             Customisable overview panels
      projects/              Project life cycle, detail views, and reference lists
      calendar/              Shared delegation calendar and sync modal
      timelines/             Staff tasks, leads, progress, and target dates
      inventory/             Catalogue, condition views, item detail, and import
      movements/             Receive, issue, and correct stock movements
      stakeholders/          Stakeholder directory and detail pages
      vendors/               Vendors, contracts, and service/spend history
      taxonomy/              Categories, storage locations, and stakeholder groups
      reports/               Valuation and movement analytics
      users/                 User accounts and live permission matrix
      audit/                 Append-only activity log
      profile/               Current user details and password change
      denied/                Permission denied page
    api/
      calendar/sync/         Scheduled & webhook SharePoint calendar sync
      export/                Multi-dataset and per-module export endpoints
  components/                Shared UI, navigation, modals, export dialog, badges
  lib/                       DB client, schema, auth/session, permissions, queries, exports
scripts/                     Seeding, user onboarding, migration, and workbook import/export CLI tools
tests/                       Automated regression tests (`node --test`)
.github/workflows/ci.yml     CI workflow (Node 22, typecheck, tests, build)
.devcontainer/               GitHub Codespaces configuration
```

---

## Security & conventions

- **Passwords**: Hashed with `scrypt` (`N=32768, r=8, p=1`, per-user 16-byte random salt) and constant-time comparison (`timingSafeEqual`).
- **Sessions**: HS256-signed JWTs (`jose`) in an `httpOnly`, `sameSite=lax` cookie (`Secure` in production) valid for 8 hours, checked against the user's live `status`, `role`, `must_change_password`, and `token_version` on every request.
- **HTTP security headers**: Configured in `next.config.ts` (`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, CSP `frame-ancestors 'none'`, and HSTS in production).
- **Spreadsheet safety**: CSV and `.xlsx` exports neutralize leading formula characters (`=`, `+`, `-`, `@`, `\t`, `\r`) and include UTF-8 BOM + CRLF line endings for CSVs.
- **Interface conventions**: Empty values render as `-`; dates format in `America/Port_of_Spain` (AST).
