/**
 * The single source of truth for the database shape (PostgreSQL).
 * Plain JavaScript so both the app (TypeScript) and `npm run seed` (Node) can use it.
 */
export const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id                   SERIAL PRIMARY KEY,
    name                 TEXT NOT NULL,
    email                TEXT NOT NULL UNIQUE,
    password_hash        TEXT NOT NULL,
    role                 TEXT NOT NULL DEFAULT 'VIEWER',
    status               TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at        TIMESTAMPTZ,
    /* Set whenever an administrator issues a password. The holder is sent to
       /change-password on their next sign-in and cannot go anywhere else until
       they have chosen their own. */
    must_change_password BOOLEAN NOT NULL DEFAULT false,
    token_version        INTEGER NOT NULL DEFAULT 1
  );

  /* Added after the fact so existing databases pick the columns up. */
  ALTER TABLE users
    ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;
  ALTER TABLE users
    ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 1;

  /* Weekly reminder emails are on unless the person turns them off. */
  ALTER TABLE users ADD COLUMN IF NOT EXISTS reminders_enabled BOOLEAN NOT NULL DEFAULT true;
  /* Entra ID object id, recorded the first time someone signs in with
     Microsoft, so a later email change in the directory can't hand the
     account to somebody else. */
  ALTER TABLE users ADD COLUMN IF NOT EXISTS microsoft_oid TEXT;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_microsoft_oid ON users (microsoft_oid) WHERE microsoft_oid IS NOT NULL;

  /* One row per reminder email attempt. A successful send in the last six
     days stops a second one, so a retried or doubled cron run is harmless. */
  CREATE TABLE IF NOT EXISTS reminder_log (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
    sent_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    item_count INTEGER NOT NULL DEFAULT 0,
    status     TEXT NOT NULL,
    error      TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_reminder_log_user ON reminder_log (user_id, sent_at DESC);

  /* In-app notifications. dedupe_key stops the same alert (for example
     "task 12 is overdue as of 2026-11-30") being raised twice. */
  CREATE TABLE IF NOT EXISTS notifications (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL,
    title      TEXT NOT NULL,
    body       TEXT,
    href       TEXT,
    actor_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    dedupe_key TEXT,
    read_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, created_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe ON notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

  /* Discussion threads on projects and timeline tasks. */
  CREATE TABLE IF NOT EXISTS comments (
    id          SERIAL PRIMARY KEY,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('project', 'task')),
    entity_id   INTEGER NOT NULL,
    author_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    body        TEXT NOT NULL,
    edited_at   TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_comments_entity ON comments (entity_type, entity_id, created_at);

  /* A person's saved filter combinations for a list page. */
  CREATE TABLE IF NOT EXISTS saved_views (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    page       TEXT NOT NULL,
    name       TEXT NOT NULL,
    query      TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_views_name ON saved_views (user_id, page, lower(name));

  /*
   * Which role may do what. Seeded from the defaults in roles.ts by
   * getPermissionMatrix() / seed.mjs, and editable from Users & access after
   * that - so the matrix is data, not a deploy.
   */
  CREATE TABLE IF NOT EXISTS role_permissions (
    role       TEXT NOT NULL,
    permission TEXT NOT NULL,
    PRIMARY KEY (role, permission)
  );

  CREATE TABLE IF NOT EXISTS categories (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS locations (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS items (
    id             SERIAL PRIMARY KEY,
    sku            TEXT UNIQUE,
    name           TEXT NOT NULL,
    description    TEXT,
    category_id    INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    location_id    INTEGER REFERENCES locations(id) ON DELETE SET NULL,
    unit           TEXT NOT NULL DEFAULT 'unit',
    quantity       INTEGER NOT NULL DEFAULT 0,
    min_quantity   INTEGER NOT NULL DEFAULT 0,
    unit_cost      NUMERIC(14, 2) NOT NULL DEFAULT 0,
    supplier       TEXT,
    /* Physical condition, which is separate from stock level: a chair can be
       one-of-one in stock and still be due for decommissioning. */
    condition      TEXT NOT NULL DEFAULT 'IN_SERVICE',
    condition_note TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  /* An asset code is not always known. NULL records that honestly, and a
     unique index still permits any number of NULLs. Guarded so existing
     databases avoid an unnecessary ACCESS EXCLUSIVE lock. */
  DO $$
  BEGIN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'items'
        AND column_name = 'sku' AND is_nullable = 'NO'
    ) THEN
      ALTER TABLE items ALTER COLUMN sku DROP NOT NULL;
    END IF;
  END $$;

  ALTER TABLE items ADD COLUMN IF NOT EXISTS condition TEXT NOT NULL DEFAULT 'IN_SERVICE';
  ALTER TABLE items ADD COLUMN IF NOT EXISTS condition_note TEXT;

  CREATE TABLE IF NOT EXISTS movements (
    id            SERIAL PRIMARY KEY,
    item_id       INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
    user_label    TEXT,
    type          TEXT NOT NULL,
    quantity      INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    note          TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  ALTER TABLE movements ADD COLUMN IF NOT EXISTS user_label TEXT;

  CREATE TABLE IF NOT EXISTS stakeholder_groups (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  /*
   * One row per contactable person. The source spreadsheet keeps a different
   * column layout per group, so the columns here are the union of what those
   * layouts actually carry - everything that does not fit lands in notes
   * rather than being dropped on import.
   */
  CREATE TABLE IF NOT EXISTS stakeholders (
    id           SERIAL PRIMARY KEY,
    name         TEXT NOT NULL,
    organisation TEXT,
    job_title    TEXT,
    email        TEXT,
    alt_email    TEXT,
    phone        TEXT,
    alt_phone    TEXT,
    location     TEXT,
    gender       TEXT,
    age_group    TEXT,
    website      TEXT,
    social       TEXT,
    notes        TEXT,
    group_id     INTEGER REFERENCES stakeholder_groups(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS vendors (
    id              SERIAL PRIMARY KEY,
    category        TEXT NOT NULL DEFAULT 'Other',
    service         TEXT,
    name            TEXT NOT NULL,
    phone           TEXT,
    contact_person  TEXT,
    email           TEXT,
    notes           TEXT,
    status          TEXT NOT NULL DEFAULT 'APPROVED',
    rating          INTEGER,
    price_tier      TEXT,
    turnaround      TEXT,
    address         TEXT,
    website         TEXT,
    tax_id          TEXT,
    payment_terms   TEXT,
    contract_status TEXT NOT NULL DEFAULT 'NONE',
    billing_cycle   TEXT,
    next_due_date   DATE,
    estimated_cost  NUMERIC(12,2),
    standard_cost   NUMERIC(12,2),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  ALTER TABLE vendors ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'APPROVED';
  ALTER TABLE vendors ADD COLUMN IF NOT EXISTS rating INTEGER;
  ALTER TABLE vendors ADD COLUMN IF NOT EXISTS price_tier TEXT;
  ALTER TABLE vendors ADD COLUMN IF NOT EXISTS turnaround TEXT;
  ALTER TABLE vendors ADD COLUMN IF NOT EXISTS address TEXT;
  ALTER TABLE vendors ADD COLUMN IF NOT EXISTS website TEXT;
  ALTER TABLE vendors ADD COLUMN IF NOT EXISTS tax_id TEXT;
  ALTER TABLE vendors ADD COLUMN IF NOT EXISTS payment_terms TEXT;
  ALTER TABLE vendors ADD COLUMN IF NOT EXISTS contract_status TEXT NOT NULL DEFAULT 'NONE';
  ALTER TABLE vendors ADD COLUMN IF NOT EXISTS billing_cycle TEXT;
  ALTER TABLE vendors ADD COLUMN IF NOT EXISTS next_due_date DATE;
  ALTER TABLE vendors ADD COLUMN IF NOT EXISTS estimated_cost NUMERIC(12,2);
  ALTER TABLE vendors ADD COLUMN IF NOT EXISTS standard_cost NUMERIC(12,2);
  CREATE INDEX IF NOT EXISTS idx_vendors_name ON vendors(lower(name));
  CREATE INDEX IF NOT EXISTS idx_vendors_category ON vendors(lower(category));
  CREATE INDEX IF NOT EXISTS idx_vendors_status ON vendors(status);

  CREATE TABLE IF NOT EXISTS vendor_engagements (
    id                 SERIAL PRIMARY KEY,
    vendor_id          INTEGER NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
    kind               TEXT NOT NULL DEFAULT 'SERVICE',
    title              TEXT NOT NULL,
    reference_no       TEXT,
    engaged_on         DATE NOT NULL DEFAULT CURRENT_DATE,
    due_on             DATE,
    estimated_cost_ttd NUMERIC(12,2),
    amount_ttd         NUMERIC(12,2),
    status             TEXT NOT NULL DEFAULT 'PAID',
    handled_by         TEXT,
    notes              TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  ALTER TABLE vendor_engagements ADD COLUMN IF NOT EXISTS estimated_cost_ttd NUMERIC(12,2);
  CREATE INDEX IF NOT EXISTS idx_vendor_engagements_vendor ON vendor_engagements(vendor_id);
  CREATE INDEX IF NOT EXISTS idx_vendor_engagements_date ON vendor_engagements(engaged_on DESC);

  /*
   * How one person has arranged their dashboard: an ordered list of panel ids
   * plus which ones they have hidden, as JSON. Per user, so one person tidying
   * their own view never changes anybody else's.
   */
  CREATE TABLE IF NOT EXISTS dashboard_layouts (
    user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    layout     TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS calendar_events (
    id           SERIAL PRIMARY KEY,
    title        TEXT NOT NULL,
    description  TEXT,
    event_type   TEXT NOT NULL DEFAULT 'MEETING',
    starts_at    TIMESTAMPTZ NOT NULL,
    ends_at      TIMESTAMPTZ NOT NULL,
    all_day      BOOLEAN NOT NULL DEFAULT false,
    location     TEXT,
    organiser_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    source       TEXT NOT NULL DEFAULT 'MANUAL',
    source_key   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT calendar_event_times CHECK (ends_at > starts_at)
  );

  ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'MANUAL';
  ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS source_key TEXT;

  CREATE INDEX IF NOT EXISTS idx_calendar_events_start ON calendar_events(starts_at);
  CREATE INDEX IF NOT EXISTS idx_calendar_events_end ON calendar_events(ends_at);
  CREATE INDEX IF NOT EXISTS idx_calendar_events_organiser ON calendar_events(organiser_id);
  CREATE INDEX IF NOT EXISTS idx_calendar_events_source ON calendar_events(source);
  CREATE INDEX IF NOT EXISTS idx_calendar_events_source_lookup ON calendar_events(source, source_key);

  /* Stores live auto-sync configuration and status for the SharePoint workbook
     so random hourly/daily/weekly edits are reconciled automatically. */
  CREATE TABLE IF NOT EXISTS calendar_sync_config (
    id                    INTEGER PRIMARY KEY DEFAULT 1,
    sharepoint_url        TEXT NOT NULL,
    auto_sync_enabled     BOOLEAN NOT NULL DEFAULT true,
    sync_interval_minutes INTEGER NOT NULL DEFAULT 15,
    prune_deleted         BOOLEAN NOT NULL DEFAULT true,
    last_attempted_at     TIMESTAMPTZ,
    last_synced_at        TIMESTAMPTZ,
    last_file_hash        TEXT,
    last_status           TEXT NOT NULL DEFAULT 'READY',
    last_message          TEXT,
    last_added            INTEGER NOT NULL DEFAULT 0,
    last_updated          INTEGER NOT NULL DEFAULT 0,
    last_removed          INTEGER NOT NULL DEFAULT 0,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  /* The delegation's targets-and-timelines tracker. One row type carries all
     three shapes the source workbook uses: dated technical activities, tasks
     that repeat on a day of each month, and a person's own list with a due
     date and a progress figure. Fields a given row does not use stay null. */
  CREATE TABLE IF NOT EXISTS staff_tasks (
    id            SERIAL PRIMARY KEY,
    area          TEXT NOT NULL,
    position      INTEGER,
    title         TEXT NOT NULL,
    lead          TEXT,
    origin        TEXT,
    priority      TEXT NOT NULL DEFAULT 'M',
    status        TEXT NOT NULL DEFAULT 'NOT_STARTED',
    progress      INTEGER,
    starts_on     DATE,
    ends_on       DATE,
    schedule_note TEXT,
    comments      TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  /* Who is accountable for the task. The lead column keeps the sheet's raw
     initials, which cover teams and people who have no account; owner_id is
     the actual link, and it is what lets someone update their own progress
     without being given rights over everybody else's. */
  ALTER TABLE staff_tasks ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
  ALTER TABLE staff_tasks ADD COLUMN IF NOT EXISTS progress_note TEXT;
  ALTER TABLE staff_tasks ADD COLUMN IF NOT EXISTS progress_updated_at TIMESTAMPTZ;
  ALTER TABLE staff_tasks ADD COLUMN IF NOT EXISTS progress_updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
  /* Tasks that repeat: completing one creates the next occurrence. */
  ALTER TABLE staff_tasks ADD COLUMN IF NOT EXISTS recurrence TEXT;
  ALTER TABLE staff_tasks ADD COLUMN IF NOT EXISTS recurrence_next_id INTEGER;

  CREATE TABLE IF NOT EXISTS audit_logs (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    user_label TEXT,
    action     TEXT NOT NULL,
    entity     TEXT NOT NULL,
    entity_id  TEXT,
    details    TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS idx_items_category        ON items(category_id);
  CREATE INDEX IF NOT EXISTS idx_items_location        ON items(location_id);
  CREATE INDEX IF NOT EXISTS idx_items_condition       ON items(condition);
  CREATE INDEX IF NOT EXISTS idx_items_sort_name       ON items(lower(name), id);
  CREATE INDEX IF NOT EXISTS idx_items_updated_desc    ON items(updated_at DESC, id);
  CREATE INDEX IF NOT EXISTS idx_movements_item        ON movements(item_id);
  CREATE INDEX IF NOT EXISTS idx_movements_item_created ON movements(item_id, created_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS idx_movements_user        ON movements(user_id);
  CREATE INDEX IF NOT EXISTS idx_movements_date        ON movements(created_at);
  CREATE INDEX IF NOT EXISTS idx_movements_created_desc ON movements(created_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS idx_tasks_area            ON staff_tasks(area);
  CREATE INDEX IF NOT EXISTS idx_tasks_status          ON staff_tasks(status);
  CREATE INDEX IF NOT EXISTS idx_tasks_owner           ON staff_tasks(owner_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_progress_user   ON staff_tasks(progress_updated_by);
  CREATE INDEX IF NOT EXISTS idx_audit_date            ON audit_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_audit_created_desc    ON audit_logs(created_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS idx_audit_action          ON audit_logs(action);
  CREATE INDEX IF NOT EXISTS idx_audit_user            ON audit_logs(user_id);
  CREATE INDEX IF NOT EXISTS idx_audit_entity          ON audit_logs(lower(entity), entity_id);
  CREATE INDEX IF NOT EXISTS idx_stake_group           ON stakeholders(group_id);
  CREATE INDEX IF NOT EXISTS idx_stake_name            ON stakeholders(lower(name));
  CREATE INDEX IF NOT EXISTS idx_stake_email           ON stakeholders(lower(email));
  /* Match the ORDER BY clauses in listStakeholders so paging never sorts the
     whole table. The id tiebreaker is part of the index for the same reason. */
  CREATE INDEX IF NOT EXISTS idx_stake_sort_name       ON stakeholders(lower(name), id);
  CREATE INDEX IF NOT EXISTS idx_stake_sort_org        ON stakeholders(lower(organisation), lower(name));
  CREATE INDEX IF NOT EXISTS idx_stake_updated         ON stakeholders(updated_at DESC, id);

  /* Functional unique indexes & CHECK constraints guarded against legacy duplicates
     or out-of-range rows so cold-start DDL never crashes an existing database. */
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_users_email_lower') THEN
      BEGIN
        CREATE UNIQUE INDEX idx_users_email_lower ON users (lower(email));
      EXCEPTION WHEN unique_violation THEN
        CREATE INDEX IF NOT EXISTS idx_users_email_lower_nonuniq ON users (lower(email));
      END;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_categories_name_lower') THEN
      BEGIN
        CREATE UNIQUE INDEX idx_categories_name_lower ON categories (lower(name));
      EXCEPTION WHEN unique_violation THEN NULL;
      END;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_locations_name_lower') THEN
      BEGIN
        CREATE UNIQUE INDEX idx_locations_name_lower ON locations (lower(name));
      EXCEPTION WHEN unique_violation THEN NULL;
      END;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_stakeholder_groups_name_lower') THEN
      BEGIN
        CREATE UNIQUE INDEX idx_stakeholder_groups_name_lower ON stakeholder_groups (lower(name));
      EXCEPTION WHEN unique_violation THEN NULL;
      END;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_items_sku_upper') THEN
      BEGIN
        CREATE UNIQUE INDEX idx_items_sku_upper ON items (upper(sku)) WHERE sku IS NOT NULL;
      EXCEPTION WHEN unique_violation THEN NULL;
      END;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_vendors_name_category_lower') THEN
      BEGIN
        CREATE UNIQUE INDEX idx_vendors_name_category_lower ON vendors (lower(name), lower(category));
      EXCEPTION WHEN unique_violation THEN NULL;
      END;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_calendar_events_source_key') THEN
      BEGIN
        CREATE UNIQUE INDEX idx_calendar_events_source_key ON calendar_events (source_key) WHERE source_key IS NOT NULL;
      EXCEPTION WHEN unique_violation THEN NULL;
      END;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_users_role') THEN
      BEGIN
        ALTER TABLE users ADD CONSTRAINT chk_users_role CHECK (role IN ('ADMIN', 'MANAGER', 'STAFF', 'VIEWER'));
      EXCEPTION WHEN others THEN NULL;
      END;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_users_status') THEN
      BEGIN
        ALTER TABLE users ADD CONSTRAINT chk_users_status CHECK (status IN ('ACTIVE', 'DISABLED'));
      EXCEPTION WHEN others THEN NULL;
      END;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_items_non_negative') THEN
      BEGIN
        ALTER TABLE items ADD CONSTRAINT chk_items_non_negative CHECK (quantity >= 0 AND min_quantity >= 0 AND unit_cost >= 0);
      EXCEPTION WHEN others THEN NULL;
      END;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_movements_balance') THEN
      BEGIN
        ALTER TABLE movements ADD CONSTRAINT chk_movements_balance CHECK (balance_after >= 0);
      EXCEPTION WHEN others THEN NULL;
      END;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_vendors_rating') THEN
      BEGIN
        ALTER TABLE vendors ADD CONSTRAINT chk_vendors_rating CHECK (rating IS NULL OR (rating BETWEEN 1 AND 5));
      EXCEPTION WHEN others THEN NULL;
      END;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_calendar_sync_singleton') THEN
      BEGIN
        ALTER TABLE calendar_sync_config ADD CONSTRAINT chk_calendar_sync_singleton CHECK (id = 1);
      EXCEPTION WHEN others THEN NULL;
      END;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_staff_tasks_progress') THEN
      BEGIN
        ALTER TABLE staff_tasks ADD CONSTRAINT chk_staff_tasks_progress CHECK (progress IS NULL OR (progress BETWEEN 0 AND 100));
      EXCEPTION WHEN others THEN NULL;
      END;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_staff_tasks_dates') THEN
      BEGIN
        ALTER TABLE staff_tasks ADD CONSTRAINT chk_staff_tasks_dates CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on);
      EXCEPTION WHEN others THEN NULL;
      END;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_staff_tasks_priority') THEN
      BEGIN
        ALTER TABLE staff_tasks ADD CONSTRAINT chk_staff_tasks_priority CHECK (priority IN ('H', 'M', 'L'));
      EXCEPTION WHEN others THEN NULL;
      END;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_staff_tasks_status') THEN
      BEGIN
        ALTER TABLE staff_tasks ADD CONSTRAINT chk_staff_tasks_status CHECK (status IN ('NOT_STARTED', 'ONGOING', 'DELAYED', 'COMPLETE'));
      EXCEPTION WHEN others THEN NULL;
      END;
    END IF;
  END $$;

  /* =====================================================================
   * Project life cycle system
   *
   * Follows the IICA-TT Database Design Technical Document: one project
   * record linked to its status, IICA model phase, programme areas, tags,
   * staff, stakeholders, funding, updates, actions, documents and lessons.
   * Staff members are this system's user accounts; stakeholders are the
   * existing directory. Reference lists are seeded with working values and
   * stay editable, because IICA has still to approve the final names.
   * ===================================================================== */

  /* One-off data changes that must not repeat (re-seeding a list somebody
     has since emptied, or re-granting a permission an admin revoked). */
  CREATE TABLE IF NOT EXISTS app_migrations (
    key        TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS project_statuses (
    id         SERIAL PRIMARY KEY,
    name       TEXT NOT NULL,
    definition TEXT,
    position   INTEGER NOT NULL DEFAULT 0,
    is_closed  BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS project_model_phases (
    id          SERIAL PRIMARY KEY,
    phase_order INTEGER NOT NULL UNIQUE CHECK (phase_order BETWEEN 1 AND 8),
    name        TEXT NOT NULL,
    definition  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS project_funding_statuses (
    id         SERIAL PRIMARY KEY,
    name       TEXT NOT NULL,
    definition TEXT,
    position   INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS project_roles (
    id         SERIAL PRIMARY KEY,
    name       TEXT NOT NULL,
    definition TEXT,
    position   INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS programme_areas (
    id         SERIAL PRIMARY KEY,
    name       TEXT NOT NULL,
    definition TEXT,
    position   INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS project_tag_list (
    id         SERIAL PRIMARY KEY,
    name       TEXT NOT NULL,
    category   TEXT,
    definition TEXT,
    position   INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  /* Reference rows are referenced with ON DELETE RESTRICT throughout, so a
     status or role in use can be renamed but never silently removed. */
  CREATE TABLE IF NOT EXISTS projects (
    id                 SERIAL PRIMARY KEY,
    code               TEXT,
    title              TEXT NOT NULL,
    purpose            TEXT,
    status_id          INTEGER NOT NULL REFERENCES project_statuses(id) ON DELETE RESTRICT,
    model_phase_id     INTEGER REFERENCES project_model_phases(id) ON DELETE RESTRICT,
    funding_status_id  INTEGER REFERENCES project_funding_statuses(id) ON DELETE RESTRICT,
    start_date         DATE,
    target_end_date    DATE,
    actual_end_date    DATE,
    outcome_summary    TEXT,
    created_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_projects_target CHECK (target_end_date IS NULL OR start_date IS NULL OR target_end_date >= start_date),
    CONSTRAINT chk_projects_actual CHECK (actual_end_date IS NULL OR start_date IS NULL OR actual_end_date >= start_date)
  );

  CREATE TABLE IF NOT EXISTS project_programme_areas (
    project_id        INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    programme_area_id INTEGER NOT NULL REFERENCES programme_areas(id) ON DELETE RESTRICT,
    PRIMARY KEY (project_id, programme_area_id)
  );

  CREATE TABLE IF NOT EXISTS project_tags (
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    tag_id     INTEGER NOT NULL REFERENCES project_tag_list(id) ON DELETE RESTRICT,
    PRIMARY KEY (project_id, tag_id)
  );

  /* No uniqueness on project + person: one person may hold several roles
     on the same project (BR-05, BR-06), and BR-07 is still open. */
  CREATE TABLE IF NOT EXISTS project_staff (
    id         SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    role_id    INTEGER NOT NULL REFERENCES project_roles(id) ON DELETE RESTRICT,
    start_date DATE,
    end_date   DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_project_staff_dates CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
  );

  /* A stakeholder is either a directory contact or, for an organisation
     that has no contact on file, a name typed in. One of the two is set. */
  CREATE TABLE IF NOT EXISTS project_stakeholders (
    id               SERIAL PRIMARY KEY,
    project_id       INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    stakeholder_id   INTEGER REFERENCES stakeholders(id) ON DELETE RESTRICT,
    stakeholder_name TEXT,
    involvement_role TEXT,
    start_date       DATE,
    end_date         DATE,
    notes            TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_project_stakeholder_who CHECK (stakeholder_id IS NOT NULL OR stakeholder_name IS NOT NULL),
    CONSTRAINT chk_project_stakeholder_dates CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
  );

  /* One row per funder arrangement (BR-09). Amounts are separate and never
     negative (BR-10); totals are calculated per currency, never stored. */
  CREATE TABLE IF NOT EXISTS project_funding (
    id                SERIAL PRIMARY KEY,
    project_id        INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    funder_id         INTEGER REFERENCES stakeholders(id) ON DELETE RESTRICT,
    funder_name       TEXT,
    funding_status_id INTEGER REFERENCES project_funding_statuses(id) ON DELETE RESTRICT,
    status_date       DATE,
    amount_requested  NUMERIC(14,2),
    amount_approved   NUMERIC(14,2),
    amount_received   NUMERIC(14,2),
    currency_code     CHAR(3),
    notes             TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_project_funding_who CHECK (funder_id IS NOT NULL OR funder_name IS NOT NULL),
    CONSTRAINT chk_project_funding_amounts CHECK (
      COALESCE(amount_requested, 0) >= 0 AND COALESCE(amount_approved, 0) >= 0 AND COALESCE(amount_received, 0) >= 0
    ),
    CONSTRAINT chk_project_funding_currency CHECK (
      currency_code IS NOT NULL OR (amount_requested IS NULL AND amount_approved IS NULL AND amount_received IS NULL)
    )
  );

  CREATE TABLE IF NOT EXISTS project_updates (
    id          SERIAL PRIMARY KEY,
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    update_date DATE NOT NULL DEFAULT CURRENT_DATE,
    body        TEXT NOT NULL,
    recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS project_actions (
    id               SERIAL PRIMARY KEY,
    project_id       INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    description      TEXT NOT NULL,
    assigned_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    due_date         DATE,
    state            TEXT NOT NULL DEFAULT 'OPEN',
    completed_on     DATE,
    created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_project_actions_state CHECK (state IN ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED')),
    CONSTRAINT chk_project_actions_done CHECK ((state = 'DONE') = (completed_on IS NOT NULL))
  );

  /* A resource can serve several projects (BR-15), so it is its own row
     and project_documents links it with the reason for the link. */
  CREATE TABLE IF NOT EXISTS document_resources (
    id             SERIAL PRIMARY KEY,
    title          TEXT NOT NULL,
    resource_type  TEXT,
    url            TEXT,
    version_label  TEXT,
    approval_state TEXT NOT NULL DEFAULT 'DRAFT',
    registered_on  DATE NOT NULL DEFAULT CURRENT_DATE,
    created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_document_resources_state CHECK (approval_state IN ('DRAFT', 'FINAL'))
  );

  /* Files uploaded straight into the app, kept with their document record.
     Size is capped in the upload action (hosting limits request bodies). */
  CREATE TABLE IF NOT EXISTS project_files (
    resource_id INTEGER PRIMARY KEY REFERENCES document_resources(id) ON DELETE CASCADE,
    filename    TEXT NOT NULL,
    mime_type   TEXT NOT NULL,
    size_bytes  INTEGER NOT NULL,
    data        BYTEA NOT NULL,
    uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS project_documents (
    project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    resource_id  INTEGER NOT NULL REFERENCES document_resources(id) ON DELETE CASCADE,
    link_purpose TEXT,
    PRIMARY KEY (project_id, resource_id)
  );

  CREATE TABLE IF NOT EXISTS project_lessons (
    id          SERIAL PRIMARY KEY,
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    body        TEXT NOT NULL,
    recorded_on DATE NOT NULL DEFAULT CURRENT_DATE,
    recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS idx_projects_status         ON projects(status_id);
  CREATE INDEX IF NOT EXISTS idx_projects_phase          ON projects(model_phase_id);
  CREATE INDEX IF NOT EXISTS idx_projects_funding_status ON projects(funding_status_id);
  CREATE INDEX IF NOT EXISTS idx_projects_title          ON projects(lower(title));
  CREATE INDEX IF NOT EXISTS idx_project_staff_project   ON project_staff(project_id);
  CREATE INDEX IF NOT EXISTS idx_project_staff_user      ON project_staff(user_id);
  CREATE INDEX IF NOT EXISTS idx_project_stake_project   ON project_stakeholders(project_id);
  CREATE INDEX IF NOT EXISTS idx_project_stake_contact   ON project_stakeholders(stakeholder_id);
  CREATE INDEX IF NOT EXISTS idx_project_funding_proj    ON project_funding(project_id);
  CREATE INDEX IF NOT EXISTS idx_project_updates_proj    ON project_updates(project_id, update_date DESC);
  CREATE INDEX IF NOT EXISTS idx_project_actions_proj    ON project_actions(project_id);
  CREATE INDEX IF NOT EXISTS idx_project_actions_proj_state ON project_actions(project_id, state);
  CREATE INDEX IF NOT EXISTS idx_project_actions_user    ON project_actions(assigned_user_id);
  CREATE INDEX IF NOT EXISTS idx_project_lessons_proj    ON project_lessons(project_id);
  CREATE INDEX IF NOT EXISTS idx_project_docs_resource   ON project_documents(resource_id);

  DO $$
  BEGIN
    PERFORM pg_advisory_xact_lock(884202);

    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_projects_code_upper') THEN
      BEGIN
        CREATE UNIQUE INDEX idx_projects_code_upper ON projects (upper(code)) WHERE code IS NOT NULL;
      EXCEPTION WHEN unique_violation THEN NULL;
      END;
    END IF;

    /* Working reference values, seeded once. IICA approval may rename them. */
    IF NOT EXISTS (SELECT 1 FROM app_migrations WHERE key = 'project_reference_seed_v1') THEN
      IF NOT EXISTS (SELECT 1 FROM project_statuses) THEN
        INSERT INTO project_statuses (name, definition, position, is_closed) VALUES
          ('Drafting', 'Idea or concept note being written; not yet approved.', 1, false),
          ('Planning', 'Approved in principle; design, partners and funding being arranged.', 2, false),
          ('In implementation', 'Activities under way.', 3, false),
          ('On hold', 'Paused, waiting on funding, a partner or a decision.', 4, false),
          ('Completed', 'Activities finished; final reporting and lessons may remain.', 5, true),
          ('Closed', 'Formally closed with final documents filed.', 6, true),
          ('Cancelled', 'Stopped before completion.', 7, true);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM project_model_phases) THEN
        INSERT INTO project_model_phases (phase_order, name) VALUES
          (1, 'Country Need / Opportunity'),
          (2, 'Evidence + Technical Expertise'),
          (3, 'Collaboration + Joint Problem-Solving'),
          (4, 'Integrated Technical Solutions'),
          (5, 'Policy + Capacity + Technology + Partnerships'),
          (6, 'Projects + Investment'),
          (7, 'Implementation + Knowledge Exchange'),
          (8, 'Measurable Results');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM project_funding_statuses) THEN
        INSERT INTO project_funding_statuses (name, definition, position) VALUES
          ('Not yet sought', 'No funding request has been made.', 1),
          ('Identified', 'A possible funder has been identified.', 2),
          ('Requested', 'A proposal or request has been submitted.', 3),
          ('Approved', 'The funder has approved an amount.', 4),
          ('Partly received', 'Some of the approved amount has been received.', 5),
          ('Fully received', 'All of the approved amount has been received.', 6),
          ('Declined', 'The funder declined the request.', 7);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM project_roles) THEN
        INSERT INTO project_roles (name, definition, position) VALUES
          ('Project lead', 'Accountable for delivery and reporting.', 1),
          ('Technical specialist', 'Provides subject expertise.', 2),
          ('Administrative support', 'Logistics, procurement and records.', 3),
          ('Finance', 'Budgets, funder reporting and payments.', 4),
          ('Monitoring & evaluation', 'Tracks results and lessons.', 5);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM programme_areas) THEN
        INSERT INTO programme_areas (name, position) VALUES
          ('Bioeconomy and Production Development', 1),
          ('Territorial Development and Family Farming', 2),
          ('International Trade and Regional Integration', 3),
          ('Climate Change, Natural Resources and Production Risks', 4),
          ('Agricultural Health, Safety and Food Quality', 5),
          ('Gender and Youth', 6),
          ('Innovation and Technology', 7);
      END IF;
      INSERT INTO app_migrations (key) VALUES ('project_reference_seed_v1') ON CONFLICT DO NOTHING;
    END IF;

    /* Existing databases already have a permission matrix, so the new project
       permissions are granted to it once; fresh ones get them from defaults. */
    IF NOT EXISTS (SELECT 1 FROM app_migrations WHERE key = 'projects_permissions_v1') THEN
      IF EXISTS (SELECT 1 FROM role_permissions) THEN
        INSERT INTO role_permissions (role, permission) VALUES
          ('ADMIN', 'projects.view'), ('ADMIN', 'projects.manage'),
          ('MANAGER', 'projects.view'), ('MANAGER', 'projects.manage'),
          ('STAFF', 'projects.view'), ('VIEWER', 'projects.view')
        ON CONFLICT DO NOTHING;
      END IF;
      INSERT INTO app_migrations (key) VALUES ('projects_permissions_v1') ON CONFLICT DO NOTHING;
    END IF;

    /* Copy existing stakeholder access into the dedicated vendor permissions
       so no existing role loses Vendors access on upgrade. */
    IF NOT EXISTS (SELECT 1 FROM app_migrations WHERE key = 'vendors_permissions_v1') THEN
      IF EXISTS (SELECT 1 FROM role_permissions) THEN
        INSERT INTO role_permissions (role, permission)
        SELECT role,
               CASE permission
                 WHEN 'stakeholders.view' THEN 'vendors.view'
                 WHEN 'stakeholders.manage' THEN 'vendors.manage'
               END
          FROM role_permissions
         WHERE permission IN ('stakeholders.view', 'stakeholders.manage')
        ON CONFLICT DO NOTHING;
      END IF;
      INSERT INTO app_migrations (key) VALUES ('vendors_permissions_v1') ON CONFLICT DO NOTHING;
    END IF;
  END $$;
`;
