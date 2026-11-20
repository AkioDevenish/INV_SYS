import { Suspense } from "react";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { listStaffTasks, listUsers } from "@/lib/queries";
import { PageHeader } from "@/components/ui";
import { ImportTimelinesButton, NewTaskButton, type OwnerOption } from "./task-forms";
import { TimelinesView, type TimelineTask } from "./timelines-view";

export const metadata = { title: "Timelines" };

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** Today in Trinidad (AST, UTC-4 year round), so "overdue" matches the office clock. */
function astTodayKey(): string {
  return new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10);
}

export default async function TimelinesPage({ searchParams }: { searchParams: Search }) {
  const user = await requirePermission("timelines.view");
  const [canManage, tasks, params] = await Promise.all([
    can(user.role, "timelines.manage"),
    listStaffTasks(),
    searchParams,
  ]);
  const staff = canManage ? await listUsers() : [];

  const activeOwners: OwnerOption[] = staff
    .filter((u) => u.status === "ACTIVE")
    .map((u) => ({ id: u.id, name: u.name }));
  const inactiveOwners: OwnerOption[] = staff
    .filter((u) => u.status !== "ACTIVE")
    .map((u) => ({ id: u.id, name: u.name, disabled: true }));

  const areaNames = [...new Set(tasks.map((t) => t.area))].sort();
  const requestedArea = one(params.area);
  const activeArea = requestedArea && areaNames.includes(requestedArea) ? requestedArea : undefined;

  const serialized: TimelineTask[] = tasks.map((t) => ({
    id: t.id,
    area: t.area,
    title: t.title,
    lead: t.lead,
    origin: t.origin,
    priority: t.priority,
    status: t.status,
    progress: t.progress,
    starts_on: iso(t.starts_on),
    ends_on: iso(t.ends_on),
    schedule_note: t.schedule_note,
    comments: t.comments,
    owner_id: t.owner_id,
    owner_name: t.owner_name,
    progress_note: t.progress_note,
    progress_updated_at: t.progress_updated_at
      ? t.progress_updated_at.toLocaleDateString("en-CA", { timeZone: "America/Port_of_Spain" })
      : null,
    progress_updated_by_name: t.progress_updated_by_name,
  }));

  return (
    <>
      <PageHeader
        eyebrow="Planning"
        title="TT Delegation Timelines"
        description="Targets, leads and dates every area of the office is working to."
        actions={
          <>
            {canManage && <ImportTimelinesButton />}
            {canManage && (
              <NewTaskButton areas={areaNames} owners={activeOwners} area={activeArea} />
            )}
          </>
        }
      />

      <Suspense fallback={<div className="panel h-96 animate-pulse" />}>
        <TimelinesView
          tasks={serialized}
          areaNames={areaNames}
          canManage={canManage}
          userId={user.userId}
          owners={activeOwners}
          inactiveOwners={inactiveOwners}
          todayKey={astTodayKey()}
        />
      </Suspense>
    </>
  );
}
