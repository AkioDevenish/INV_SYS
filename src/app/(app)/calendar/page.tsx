import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { listCalendarEvents, listUsers } from "@/lib/queries";
import { listProjectCalendarItems } from "@/lib/projects";
import { getCalendarSyncConfig, getCalendarWebhookSecret } from "@/lib/calendar-sync";
import { PageHeader } from "@/components/ui";
import {
  CalendarHeaderProvider,
  ExportCalendarButton,
  ImportCalendarButton,
  NewEventButton,
  type StaffOption,
  type SyncConfigClientProps,
} from "./event-form";
import { CalendarView, type CalendarSyncMeta } from "./calendar-view";

export const metadata = { title: "Calendar" };

function parseValidMonthParam(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  const match = raw.trim().match(/^(\d{4})-(\d{2})$/);
  if (!match) return fallback;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 2000 || year > 2100 || month < 1 || month > 12) {
    return fallback;
  }
  return `${match[1]}-${match[2]}`;
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string | string[] }>;
}) {
  const user = await requirePermission("calendar.view");
  const [canManage, canSeeProjects] = await Promise.all([
    can(user.role, "calendar.manage"),
    can(user.role, "projects.view"),
  ]);
  const params = await searchParams;
  const rawMonth = Array.isArray(params.month) ? params.month[0] : params.month;

  const astNow = new Date(Date.now() - 4 * 3600 * 1000);
  const todayKey = astNow.toISOString().slice(0, 10);
  const currentMonth = todayKey.slice(0, 7);
  const initialMonth = parseValidMonthParam(rawMonth, currentMonth);

  const [events, users, rawSyncConfig] = await Promise.all([
    listCalendarEvents(new Date("2000-01-01T00:00:00Z"), new Date("2100-01-01T00:00:00Z")),
    listUsers(),
    getCalendarSyncConfig(),
  ]);

  const lastSyncedAtIso = rawSyncConfig.last_synced_at
    ? rawSyncConfig.last_synced_at.toISOString()
    : null;

  const syncMeta: CalendarSyncMeta = {
    autoSyncEnabled: rawSyncConfig.auto_sync_enabled,
    syncIntervalMinutes: rawSyncConfig.sync_interval_minutes,
    lastSyncedAt: lastSyncedAtIso,
  };

  const syncConfig: SyncConfigClientProps = {
    sharepointUrl: rawSyncConfig.sharepoint_url,
    autoSyncEnabled: rawSyncConfig.auto_sync_enabled,
    syncIntervalMinutes: rawSyncConfig.sync_interval_minutes,
    pruneDeleted: rawSyncConfig.prune_deleted,
    lastSyncedAt: lastSyncedAtIso,
    lastAttemptedAt: rawSyncConfig.last_attempted_at
      ? rawSyncConfig.last_attempted_at.toISOString()
      : null,
    lastStatus: rawSyncConfig.last_status,
    lastMessage: rawSyncConfig.last_message,
    webhookSecret: canManage ? (getCalendarWebhookSecret() ?? undefined) : undefined,
  };

  const referencedOrganiserIds = new Set(
    events.map((e) => e.organiser_id).filter((id): id is number => id !== null),
  );

  const staff: StaffOption[] = users
    .filter((u) => u.status === "ACTIVE" || referencedOrganiserIds.has(u.id))
    .map((u) => ({
      id: u.id,
      name: u.name,
      inactive: u.status !== "ACTIVE",
    }));

  const yearSet = new Set<number>([Number(initialMonth.slice(0, 4))]);
  const serializedEvents = events.map((event) => {
    const startYear = Number(
      new Date(event.starts_at.getTime() - 4 * 3600 * 1000).toISOString().slice(0, 4),
    );
    const endYear = Number(
      new Date(event.ends_at.getTime() - 4 * 3600 * 1000).toISOString().slice(0, 4),
    );
    if (Number.isFinite(startYear)) yearSet.add(startYear);
    if (Number.isFinite(endYear)) yearSet.add(endYear);
    return {
      id: event.id,
      title: event.title,
      description: event.description,
      event_type: event.event_type,
      starts_at: event.starts_at.toISOString(),
      ends_at: event.ends_at.toISOString(),
      all_day: event.all_day,
      location: event.location,
      organiser_id: event.organiser_id,
      organiser_name: event.organiser_name,
    };
  });

  // Project milestones are read live from Projects, never stored as events, so
  // they can't drift. Negative ids keep them apart from real events.
  const projectItems = canSeeProjects ? await listProjectCalendarItems() : [];
  const projectLinks: Record<number, number> = {};
  const projectEvents = projectItems.map((item, i) => {
    const id = -(i + 1);
    projectLinks[id] = item.project_id;
    yearSet.add(Number(item.date.slice(0, 4)));
    return {
      id,
      title: item.title,
      description: item.description,
      event_type: "PROJECT",
      // All-day events are stored 09:00–17:00 Trinidad time (UTC-4).
      starts_at: `${item.date}T13:00:00.000Z`,
      ends_at: `${item.date}T21:00:00.000Z`,
      all_day: true,
      location: null,
      organiser_id: null,
      organiser_name: null,
    };
  });

  const availableYears = [...yearSet].sort((a, b) => a - b);

  return (
    <CalendarHeaderProvider initialMonth={initialMonth}>
      <PageHeader
        eyebrow="Planning"
        title="TT Delegation Calendar"
        description="Meetings, field visits, staff leave, holidays and deadlines for the Trinidad and Tobago office."
        actions={
          <>
            <ExportCalendarButton
              initialMonth={initialMonth}
              todayKey={todayKey}
              availableYears={availableYears}
            />
            {canManage && <ImportCalendarButton syncConfig={syncConfig} />}
            {canManage && <NewEventButton staff={staff} />}
          </>
        }
      />

      <CalendarView
        events={[...serializedEvents, ...projectEvents]}
        projectLinks={projectLinks}
        canManage={canManage}
        initialMonth={initialMonth}
        todayKey={todayKey}
        staff={staff}
        syncMeta={syncMeta}
      />
    </CalendarHeaderProvider>
  );
}
