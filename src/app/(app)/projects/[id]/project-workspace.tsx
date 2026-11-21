"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import {
  AlertTriangle,
  BookOpen,
  Coins,
  Download,
  ExternalLink,
  FileText,
  LayoutDashboard,
  ListChecks,
  History,
  MessageSquareText,
  MessagesSquare,
  Users,
} from "lucide-react";
import { CommentThread } from "@/components/comment-thread";
import { RowActions } from "@/components/icon-button";
import type { ProjectActivity, ProjectDetail, RefOption, ResourceOption, StakeholderOption } from "@/lib/projects";
import { formatDateTime } from "@/lib/format";
import {
  ACTION_STATE_META,
  APPROVAL_META,
  formatDay,
  formatMoney,
  isActionState,
  type ApprovalState,
} from "@/lib/project-meta";
import { AddButton, Chip, EditIcon, FormModalButton, RemoveRecordButton } from "../project-ui";
import {
  formatBytes,
  ActionItemForm,
  ActionStateSelect,
  DocumentForm,
  FundingForm,
  LessonForm,
  PhaseStepper,
  StaffForm,
  StakeholderLinkForm,
  UpdateForm,
  type Person,
} from "./record-forms";

const TABS = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "people", label: "People", icon: Users },
  { key: "funding", label: "Funding", icon: Coins },
  { key: "updates", label: "Updates", icon: MessageSquareText },
  { key: "actions", label: "Actions", icon: ListChecks },
  { key: "documents", label: "Documents", icon: FileText },
  { key: "lessons", label: "Lessons", icon: BookOpen },
  { key: "discussion", label: "Discussion", icon: MessagesSquare },
  { key: "activity", label: "Activity", icon: History },
] as const;
type TabKey = (typeof TABS)[number]["key"];

function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-2.5 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          {description && <p className="text-xs text-ink/60">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-ink/15 px-4 py-6 text-center text-xs text-ink/60">{children}</p>
  );
}

const ACTIVITY_DOT: Record<string, string> = {
  CREATE: "bg-emerald-500",
  UPDATE: "bg-iica-600",
  DELETE: "bg-rose-500",
  COMMENT: "bg-gold-500",
};

const ACTIVITY_NOUN: Record<string, string> = {
  project: "the project",
  project_staff: "a staff assignment",
  project_stakeholder: "a stakeholder",
  project_funding: "a funding record",
  project_update: "a progress update",
  project_action: "a follow-up action",
  project_document: "a document",
  project_lesson: "a lesson",
};

function activityVerb(a: ProjectActivity): string {
  const noun = ACTIVITY_NOUN[a.entity] ?? a.entity.replace(/^project_/, "").replace(/_/g, " ");
  switch (a.action) {
    case "CREATE":
      return a.entity === "project" ? "created the project" : `added ${noun}`;
    case "UPDATE":
      return `updated ${noun}`;
    case "DELETE":
      return a.entity === "project" ? "deleted the project" : `removed ${noun}`;
    case "COMMENT":
      return "commented";
    default:
      return `${a.action.toLowerCase().replace(/_/g, " ")} on ${noun}`;
  }
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 text-xs">
      <span className="shrink-0 text-ink/60">{label}</span>
      <span className="min-w-0 text-right font-medium text-ink/85">{children}</span>
    </div>
  );
}

function formatAstTimestamp(raw: string): string {
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(raw)) {
    return formatDateTime(`${raw.replace(" ", "T")}:00-04:00`);
  }
  return formatDateTime(raw);
}

function safeHref(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function ProjectWorkspace({
  project: p,
  statusClass,
  phases,
  roles,
  fundingStatuses,
  people,
  directory,
  resources,
  canManage,
  canContribute,
  userId,
  todayKey,
  initialTab,
  activity = [],
}: {
  /** Audit-trail entries for this project, newest first. */
  activity?: ProjectActivity[];
  project: ProjectDetail;
  statusClass: string;
  phases: RefOption[];
  roles: RefOption[];
  fundingStatuses: RefOption[];
  people: Person[];
  directory: StakeholderOption[];
  resources: ResourceOption[];
  canManage: boolean;
  canContribute: boolean;
  userId: number;
  todayKey: string;
  initialTab?: string;
}) {
  const [tab, setTab] = useState<TabKey>(
    TABS.some((t) => t.key === initialTab) ? (initialTab as TabKey) : "overview",
  );

  const switchTab = (key: TabKey) => {
    setTab(key);
    const url = new URL(window.location.href);
    if (key === "overview") url.searchParams.delete("tab");
    else url.searchParams.set("tab", key);
    window.history.replaceState(window.history.state, "", url.toString());
  };

  const openActions = p.actions.filter((a) => a.state === "OPEN" || a.state === "IN_PROGRESS");
  const overdue = (due: string | null, state: string) =>
    Boolean(due && due < todayKey && (state === "OPEN" || state === "IN_PROGRESS"));

  const counts: Partial<Record<TabKey, number>> = {
    people: p.staff_rows.filter((s) => s.active).length + p.stakeholders.length,
    funding: p.funding_rows.length,
    updates: p.updates.length,
    actions: openActions.length,
    documents: p.documents.length,
    lessons: p.lessons.length,
  };

  // Funders count as stakeholders in reporting even without an involvement row (deduplicated).
  const linkedStakeholderIds = new Set(p.stakeholders.map((s) => s.stakeholder_id).filter(Boolean));
  const linkedNames = new Set(p.stakeholders.map((s) => s.name.toLowerCase()));
  const seenFunders = new Set<string>();
  const fundersOnly = p.funding_rows.filter((f) => {
    const alreadyLinked = f.funder_id
      ? linkedStakeholderIds.has(f.funder_id)
      : linkedNames.has(f.funder.toLowerCase());
    if (alreadyLinked) return false;
    const dedupeKey = f.funder_id ? `id:${f.funder_id}` : `name:${f.funder.trim().toLowerCase()}`;
    if (seenFunders.has(dedupeKey)) return false;
    seenFunders.add(dedupeKey);
    return true;
  });

  const targetLate = !p.is_closed && p.target_end_date && p.target_end_date < todayKey;

  const updateItem = (u: ProjectDetail["updates"][number], compact = false) => (
    <li key={u.id} className="relative pl-5">
      <span className="absolute top-1.5 left-0 h-2 w-2 rounded-full bg-iica-600" aria-hidden="true" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold text-ink">
          {formatDay(u.update_date)}
          <span className="font-normal text-ink/60">{u.recorded_by_name ? ` · ${u.recorded_by_name}` : ""}</span>
        </div>
        {!compact && (canManage || (canContribute && u.recorded_by === userId)) && (
          <RowActions>
            <FormModalButton
              title="Edit update"
              trigger={(open) => <EditIcon label="Edit update" onClick={open} />}
              render={(close) => <UpdateForm projectId={p.id} row={u} todayKey={todayKey} onDone={close} />}
            />
            <RemoveRecordButton kind="update" projectId={p.id} id={u.id} label="Remove update" what={formatDay(u.update_date)} />
          </RowActions>
        )}
      </div>
      <p className={`mt-1 whitespace-pre-line text-sm leading-relaxed text-ink/80 ${compact ? "line-clamp-3" : ""}`}>{u.body}</p>
      {!compact && <p className="mt-1 text-[11px] text-ink/60">Entered {formatAstTimestamp(u.entered_at)}</p>}
    </li>
  );

  const staffActions = (s: ProjectDetail["staff_rows"][number]) =>
    canManage ? (
      <RowActions>
        <FormModalButton
          title="Edit assignment"
          trigger={(open) => <EditIcon label="Edit assignment" onClick={open} />}
          render={(close) => <StaffForm projectId={p.id} row={s} people={people} roles={roles} onDone={close} />}
        />
        <RemoveRecordButton kind="staff" projectId={p.id} id={s.id} label="Remove assignment" what={`${s.name} · ${s.role_name}`} />
      </RowActions>
    ) : null;

  const fundingActions = (f: ProjectDetail["funding_rows"][number]) =>
    canManage ? (
      <RowActions>
        <FormModalButton
          title="Edit funding"
          trigger={(open) => <EditIcon label="Edit funding" onClick={open} />}
          render={(close) => (
            <FundingForm projectId={p.id} row={f} directory={directory} statuses={fundingStatuses} onDone={close} />
          )}
        />
        <RemoveRecordButton kind="funding" projectId={p.id} id={f.id} label="Remove funding record" what={f.funder} />
      </RowActions>
    ) : null;

  const actionStateControl = (a: ProjectDetail["actions"][number]) => {
    const canChange = canManage || a.assigned_user_id === userId;
    const meta = isActionState(a.state) ? ACTION_STATE_META[a.state] : null;
    return canChange ? <ActionStateSelect row={a} /> : meta ? <Chip className={meta.chip}>{meta.label}</Chip> : null;
  };

  const actionManage = (a: ProjectDetail["actions"][number]) =>
    canManage ? (
      <RowActions>
        <FormModalButton
          title="Edit action"
          trigger={(open) => <EditIcon label="Edit action" onClick={open} />}
          render={(close) => <ActionItemForm projectId={p.id} row={a} people={people} onDone={close} />}
        />
        <RemoveRecordButton kind="action" projectId={p.id} id={a.id} label="Remove action" what={a.description} />
      </RowActions>
    ) : null;

  const actionRow = (a: ProjectDetail["actions"][number]) => {
    const late = overdue(a.due_date, a.state);
    return (
      <tr key={a.id}>
        <td className="min-w-[16rem] text-sm text-ink/85">{a.description}</td>
        <td className="text-xs text-ink/70">{a.assigned_name ?? <span className="text-ink/60">Unassigned</span>}</td>
        <td className="whitespace-nowrap text-xs">
          <span className={late ? "font-semibold text-rose-700" : "text-ink/70"}>{a.due_date ? formatDay(a.due_date) : "-"}</span>
          {late && <div className="text-[11px] font-medium text-rose-700">Overdue</div>}
          {a.completed_on && <div className="text-[11px] text-emerald-700">Done {formatDay(a.completed_on)}</div>}
        </td>
        <td>{actionStateControl(a)}</td>
        <td>{actionManage(a)}</td>
      </tr>
    );
  };

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="panel min-w-0">
        <div className="flex flex-wrap items-center gap-1 border-b border-ink/8 px-3 py-3 sm:px-4" role="group" aria-label="Project sections">
          {TABS.map((t) => {
            const active = tab === t.key;
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                type="button"
                aria-pressed={active}
                onClick={() => switchTab(t.key)}
                className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-semibold transition ${
                  active
                    ? "border-iica-700 bg-iica-700 text-white shadow-xs"
                    : "border-ink/12 bg-white text-ink/70 hover:border-iica-300 hover:bg-iica-50 hover:text-iica-800"
                }`}
              >
                <Icon size={13} aria-hidden="true" />
                {t.label}
                {counts[t.key] !== undefined && (
                  <span className={`rounded-full px-1.5 text-[10px] tabular-nums ${active ? "bg-white/20" : "bg-ink/6 text-ink/60"}`}>
                    {counts[t.key]}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div key={tab} className="animate-fade space-y-6 p-4 sm:p-5">
          {tab === "overview" && (
            <>
              <Section
                title="IICA model phase"
                description={canManage ? "Click a phase to move the project there. This doesn't change its status." : "Where the project sits in IICA's eight-step model."}
              >
                <PhaseStepper projectId={p.id} phases={phases} currentId={p.model_phase_id} canEdit={canManage} />
              </Section>

              <div className="grid gap-5 xl:grid-cols-2">
                <Section
                  title="Latest updates"
                  action={
                    <div className="flex items-center gap-2">
                      {p.updates.length > 0 && (
                        <button
                          type="button"
                          onClick={() => switchTab("updates")}
                          className="text-xs font-medium text-iica-700 hover:underline"
                        >
                          View all ({p.updates.length})
                        </button>
                      )}
                      {canContribute && (
                        <FormModalButton
                          title="Post an update"
                          trigger={(open) => <AddButton label="Update" onClick={open} />}
                          render={(close) => <UpdateForm projectId={p.id} todayKey={todayKey} onDone={close} />}
                        />
                      )}
                    </div>
                  }
                >
                  {p.updates.length === 0 ? (
                    <Empty>No updates yet.</Empty>
                  ) : (
                    <ul className="space-y-3">{p.updates.slice(0, 3).map((u) => updateItem(u, true))}</ul>
                  )}
                </Section>

                <Section
                  title="Open actions"
                  action={
                    <div className="flex items-center gap-2">
                      {p.actions.length > 0 && (
                        <button
                          type="button"
                          onClick={() => switchTab("actions")}
                          className="text-xs font-medium text-iica-700 hover:underline"
                        >
                          View all ({p.actions.length})
                        </button>
                      )}
                      {canManage && (
                        <FormModalButton
                          title="Add action"
                          trigger={(open) => <AddButton label="Action" onClick={open} />}
                          render={(close) => <ActionItemForm projectId={p.id} people={people} onDone={close} />}
                        />
                      )}
                    </div>
                  }
                >
                  {openActions.length === 0 ? (
                    <Empty>Nothing outstanding.</Empty>
                  ) : (
                    <ul className="space-y-1.5">
                      {openActions.slice(0, 6).map((a) => (
                        <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ink/8 px-3 py-2">
                          <div className="min-w-0 flex-1">
                            <div className="text-xs text-ink/85">{a.description}</div>
                            <div className={`mt-0.5 text-[11px] ${overdue(a.due_date, a.state) ? "font-semibold text-rose-700" : "text-ink/60"}`}>
                              {a.due_date ? formatDay(a.due_date, false) : "No due date"}
                              {a.assigned_name ? ` · ${a.assigned_name}` : ""}
                            </div>
                          </div>
                          <div className="shrink-0">{actionStateControl(a)}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </Section>
              </div>

              <Section title="Outcome">
                {p.outcome_summary ? (
                  <p className="whitespace-pre-line text-sm leading-relaxed text-ink/80">{p.outcome_summary}</p>
                ) : (
                  <Empty>No outcome recorded yet. Add one with Edit once results are known.</Empty>
                )}
              </Section>
            </>
          )}

          {tab === "people" && (
            <>
              <Section
                title="IICA staff"
                description="Assignments and the role each person holds on this project."
                action={
                  canManage ? (
                    <FormModalButton
                      title="Assign staff"
                      trigger={(open) => <AddButton label="Assign" onClick={open} />}
                      render={(close) => <StaffForm projectId={p.id} people={people} roles={roles} onDone={close} />}
                    />
                  ) : undefined
                }
              >
                {p.staff_rows.length === 0 ? (
                  <Empty>No one is assigned yet.</Empty>
                ) : (
                  <>
                    <ul className="divide-y divide-ink/8 rounded-xl border border-ink/8 md:hidden">
                      {p.staff_rows.map((s) => (
                        <li key={s.id} className={`flex items-start justify-between gap-2 px-3 py-2.5 ${s.active ? "" : "bg-ink/[0.02]"}`}>
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-ink">
                              {s.name}
                              {!s.user_active && <span className="ml-1.5 text-[11px] text-ink/60">(inactive account)</span>}
                            </div>
                            <div className="text-xs text-ink/75">{s.role_name}</div>
                            <div className="mt-0.5 text-xs text-ink/60">
                              {s.start_date ? formatDay(s.start_date) : "-"} to {s.end_date ? formatDay(s.end_date) : "now"}
                              {!s.active && " · Ended"}
                            </div>
                          </div>
                          {staffActions(s)}
                        </li>
                      ))}
                    </ul>
                    <div className="hidden overflow-x-auto rounded-xl border border-ink/8 md:block">
                      <table className="table-shell w-full [&_th]:px-3 [&_th]:py-2.5 [&_td]:px-3 [&_td]:py-2.5">
                        <thead>
                          <tr>
                            <th>Person</th>
                            <th>Role</th>
                            <th>Period</th>
                            <th className="w-20">
                              <span className="sr-only">Actions</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {p.staff_rows.map((s) => (
                            <tr key={s.id} className={s.active ? "" : "bg-ink/[0.02]"}>
                              <td className="text-sm font-medium text-ink">
                                {s.name}
                                {!s.user_active && <span className="ml-1.5 text-[11px] text-ink/60">(inactive account)</span>}
                              </td>
                              <td className="text-xs text-ink/75">{s.role_name}</td>
                              <td className="whitespace-nowrap text-xs text-ink/65">
                                {s.start_date ? formatDay(s.start_date) : "-"} to {s.end_date ? formatDay(s.end_date) : "now"}
                                {!s.active && <div className="text-[11px] text-ink/60">Ended</div>}
                              </td>
                              <td>{staffActions(s)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </Section>

              <Section
                title="External stakeholders"
                description="Partners, counterparts, beneficiaries and funders. They have no access to this system."
                action={
                  canManage ? (
                    <FormModalButton
                      title="Add stakeholder"
                      trigger={(open) => <AddButton label="Stakeholder" onClick={open} />}
                      render={(close) => <StakeholderLinkForm projectId={p.id} directory={directory} onDone={close} />}
                    />
                  ) : undefined
                }
              >
                {p.stakeholders.length === 0 && fundersOnly.length === 0 ? (
                  <Empty>No stakeholders recorded.</Empty>
                ) : (
                  <ul className="divide-y divide-ink/8 rounded-xl border border-ink/8">
                    {p.stakeholders.map((s) => (
                      <li key={s.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {s.stakeholder_id ? (
                              <Link href={`/stakeholders/${s.stakeholder_id}`} className="text-sm font-medium text-ink hover:text-iica-700 hover:underline">
                                {s.name}
                              </Link>
                            ) : (
                              <span className="text-sm font-medium text-ink">{s.name}</span>
                            )}
                            {s.involvement_role && <Chip className="border-sky-200 bg-sky-50 text-sky-800">{s.involvement_role}</Chip>}
                          </div>
                          <div className="text-xs text-ink/60">
                            {[s.organisation, s.start_date || s.end_date ? `${formatDay(s.start_date)} to ${s.end_date ? formatDay(s.end_date) : "now"}` : null]
                              .filter(Boolean)
                              .join(" · ")}
                          </div>
                          {s.notes && <p className="mt-1 text-xs text-ink/70">{s.notes}</p>}
                        </div>
                        {canManage && (
                          <RowActions>
                            <FormModalButton
                              title="Edit stakeholder"
                              trigger={(open) => <EditIcon label="Edit stakeholder" onClick={open} />}
                              render={(close) => <StakeholderLinkForm projectId={p.id} row={s} directory={directory} onDone={close} />}
                            />
                            <RemoveRecordButton kind="stakeholder" projectId={p.id} id={s.id} label="Remove stakeholder" what={s.name} />
                          </RowActions>
                        )}
                      </li>
                    ))}
                    {fundersOnly.map((f) => (
                      <li key={`f-${f.funder_id ?? f.id}`} className="flex items-start justify-between gap-3 px-3 py-2.5">
                        <div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {f.funder_id ? (
                              <Link
                                href={`/stakeholders/${f.funder_id}`}
                                className="text-sm font-medium text-ink hover:text-iica-700 hover:underline"
                              >
                                {f.funder}
                              </Link>
                            ) : (
                              <span className="text-sm font-medium text-ink">{f.funder}</span>
                            )}
                            <Chip className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700">Funder</Chip>
                          </div>
                          <div className="text-xs text-ink/60">
                            {[f.funder_organisation, "From the funding records"].filter(Boolean).join(" · ")}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </>
          )}

          {tab === "funding" && (
            <Section
              title="Funding by funder"
              description="Requested, approved and received are kept separately, and totals never mix currencies."
              action={
                canManage ? (
                  <FormModalButton
                    title="Add funding"
                    trigger={(open) => <AddButton label="Funding" onClick={open} />}
                    render={(close) => <FundingForm projectId={p.id} directory={directory} statuses={fundingStatuses} onDone={close} />}
                  />
                ) : undefined
              }
            >
              {p.funding.length > 0 && (
                <div className="mb-3 grid gap-2.5 sm:grid-cols-2">
                  {p.funding.map((t) => {
                    const useApproved = t.has_approved;
                    const base = useApproved ? t.approved : t.requested;
                    const pct = base > 0 ? Math.min(100, Math.round((t.received / base) * 100)) : 0;
                    return (
                      <div key={t.currency} className="rounded-xl border border-ink/8 bg-iica-50/40 p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink/60">{t.currency} total</div>
                        <div className="mt-1.5 grid grid-cols-3 gap-2 text-xs">
                          <div>
                            <div className="text-ink/60">Requested</div>
                            <div className="font-semibold tabular-nums text-ink">{formatMoney(t.requested, null)}</div>
                          </div>
                          <div>
                            <div className="text-ink/60">Approved</div>
                            <div className="font-semibold tabular-nums text-ink">{formatMoney(t.approved, null)}</div>
                          </div>
                          <div>
                            <div className="text-ink/60">Received</div>
                            <div className="font-semibold tabular-nums text-emerald-700">{formatMoney(t.received, null)}</div>
                          </div>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink/10">
                          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                        </div>
                        <div className="mt-1 text-[11px] text-ink/60">{pct}% of {useApproved ? "approved" : "requested"} received</div>
                      </div>
                    );
                  })}
                </div>
              )}
              {p.funding_rows.length === 0 ? (
                <Empty>No funding recorded.</Empty>
              ) : (
                <>
                  <ul className="divide-y divide-ink/8 rounded-xl border border-ink/8 md:hidden">
                    {p.funding_rows.map((f) => (
                      <li key={f.id} className="px-3 py-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-ink">
                              {f.funder_id ? (
                                <Link href={`/stakeholders/${f.funder_id}`} className="hover:text-iica-700 hover:underline">
                                  {f.funder}
                                </Link>
                              ) : (
                                f.funder
                              )}
                            </div>
                            {f.funder_organisation && <div className="text-xs text-ink/60">{f.funder_organisation}</div>}
                            {f.funding_status_name && (
                              <div className="mt-0.5 text-xs text-ink/70">
                                {f.funding_status_name}
                                {f.status_date ? ` · since ${formatDay(f.status_date)}` : ""}
                              </div>
                            )}
                          </div>
                          {fundingActions(f)}
                        </div>
                        <div className="mt-2 grid grid-cols-3 gap-2 rounded-lg bg-iica-50/40 px-2.5 py-2 text-xs">
                          <div>
                            <div className="text-[11px] text-ink/60">Requested</div>
                            <div className="tabular-nums font-medium text-ink">{formatMoney(f.amount_requested, f.currency_code)}</div>
                          </div>
                          <div>
                            <div className="text-[11px] text-ink/60">Approved</div>
                            <div className="tabular-nums font-medium text-ink">{formatMoney(f.amount_approved, f.currency_code)}</div>
                          </div>
                          <div>
                            <div className="text-[11px] text-ink/60">Received</div>
                            <div className="tabular-nums font-semibold text-ink">{formatMoney(f.amount_received, f.currency_code)}</div>
                          </div>
                        </div>
                        {f.notes && <p className="mt-1.5 text-xs text-ink/65">{f.notes}</p>}
                      </li>
                    ))}
                  </ul>
                  <div className="hidden overflow-x-auto rounded-xl border border-ink/8 md:block">
                    <table className="table-shell w-full [&_th]:px-3 [&_th]:py-2.5 [&_td]:px-3 [&_td]:py-2.5">
                      <thead>
                        <tr>
                          <th>Funder</th>
                          <th>Status</th>
                          <th className="text-right">Requested</th>
                          <th className="text-right">Approved</th>
                          <th className="text-right">Received</th>
                          <th className="w-20">
                            <span className="sr-only">Actions</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.funding_rows.map((f) => (
                          <tr key={f.id}>
                            <td className="min-w-[10rem]">
                              <div className="text-sm font-medium text-ink">
                                {f.funder_id ? (
                                  <Link href={`/stakeholders/${f.funder_id}`} className="hover:text-iica-700 hover:underline">
                                    {f.funder}
                                  </Link>
                                ) : (
                                  f.funder
                                )}
                              </div>
                              {f.funder_organisation && <div className="text-xs text-ink/60">{f.funder_organisation}</div>}
                              {f.notes && <div className="mt-0.5 text-xs text-ink/60">{f.notes}</div>}
                            </td>
                            <td className="text-xs text-ink/70">
                              {f.funding_status_name ?? "-"}
                              {f.status_date && <div className="text-[11px] text-ink/60">since {formatDay(f.status_date)}</div>}
                            </td>
                            <td className="text-right text-xs whitespace-nowrap tabular-nums">{formatMoney(f.amount_requested, f.currency_code)}</td>
                            <td className="text-right text-xs whitespace-nowrap tabular-nums">{formatMoney(f.amount_approved, f.currency_code)}</td>
                            <td className="text-right text-xs font-semibold whitespace-nowrap tabular-nums">{formatMoney(f.amount_received, f.currency_code)}</td>
                            <td>{fundingActions(f)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </Section>
          )}

          {tab === "updates" && (
            <Section
              title="Progress updates"
              description="Dated record of progress, decisions and changes, newest first."
              action={
                canContribute ? (
                  <FormModalButton
                    title="Post an update"
                    trigger={(open) => <AddButton label="Update" onClick={open} />}
                    render={(close) => <UpdateForm projectId={p.id} todayKey={todayKey} onDone={close} />}
                  />
                ) : undefined
              }
            >
              {p.updates.length === 0 ? (
                <Empty>No updates yet.</Empty>
              ) : (
                <ul className="space-y-4 border-l border-ink/10 pl-1">{p.updates.map((u) => updateItem(u))}</ul>
              )}
            </Section>
          )}

          {tab === "actions" && (
            <Section
              title="Follow-up actions"
              description="Tasks arising from the project. The person responsible can move their own along."
              action={
                canManage ? (
                  <FormModalButton
                    title="Add action"
                    trigger={(open) => <AddButton label="Action" onClick={open} />}
                    render={(close) => <ActionItemForm projectId={p.id} people={people} onDone={close} />}
                  />
                ) : undefined
              }
            >
              {p.actions.length === 0 ? (
                <Empty>No follow-up actions.</Empty>
              ) : (
                <>
                  <ul className="divide-y divide-ink/8 rounded-xl border border-ink/8 md:hidden">
                    {p.actions.map((a) => {
                      const late = overdue(a.due_date, a.state);
                      return (
                        <li key={a.id} className="space-y-2 px-3 py-3">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm text-ink/85">{a.description}</p>
                            {actionManage(a)}
                          </div>
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                            <div className="space-y-0.5 text-ink/65">
                              <div>{a.assigned_name ?? <span className="text-ink/60">Unassigned</span>}</div>
                              <div>
                                {a.due_date ? (
                                  <span className={late ? "font-semibold text-rose-700" : undefined}>
                                    Due {formatDay(a.due_date)}
                                    {late ? " (Overdue)" : ""}
                                  </span>
                                ) : (
                                  <span>No due date</span>
                                )}
                                {a.completed_on && <span className="ml-2 text-emerald-700">Done {formatDay(a.completed_on)}</span>}
                              </div>
                            </div>
                            <div>{actionStateControl(a)}</div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="hidden overflow-x-auto rounded-xl border border-ink/8 md:block">
                    <table className="table-shell w-full [&_th]:px-3 [&_th]:py-2.5 [&_td]:px-3 [&_td]:py-2.5">
                      <thead>
                        <tr>
                          <th>Action</th>
                          <th>Responsible</th>
                          <th>Due</th>
                          <th>State</th>
                          <th className="w-20">
                            <span className="sr-only">Actions</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>{p.actions.map(actionRow)}</tbody>
                    </table>
                  </div>
                </>
              )}
            </Section>
          )}

          {tab === "documents" && (
            <Section
              title="Documents and resources"
              description="Links to files in approved storage, with version and approval state."
              action={
                canManage ? (
                  <FormModalButton
                    title="Add document"
                    trigger={(open) => <AddButton label="Document" onClick={open} />}
                    render={(close) => <DocumentForm projectId={p.id} existing={resources} onDone={close} />}
                  />
                ) : undefined
              }
            >
              {p.documents.length === 0 ? (
                <Empty>No documents linked.</Empty>
              ) : (
                <ul className="divide-y divide-ink/8 rounded-xl border border-ink/8">
                  {p.documents.map((d) => {
                    const href = safeHref(d.url);
                    const approval = APPROVAL_META[d.approval_state as ApprovalState];
                    return (
                      <li key={d.resource_id} className="flex items-start justify-between gap-3 px-3 py-2.5">
                        <div className="flex min-w-0 gap-2.5">
                          <FileText size={16} className="mt-0.5 shrink-0 text-iica-700" aria-hidden="true" />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {d.file_name ? (
                                <a
                                  href={`/api/files/${d.resource_id}`}
                                  target="_blank"
                                  rel="noopener"
                                  className="inline-flex items-center gap-1 text-sm font-medium text-ink hover:text-iica-700 hover:underline"
                                >
                                  {d.title} <Download size={11} aria-hidden="true" />
                                </a>
                              ) : href ? (
                                <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-ink hover:text-iica-700 hover:underline">
                                  {d.title} <ExternalLink size={11} aria-hidden="true" />
                                </a>
                              ) : (
                                <span className="text-sm font-medium text-ink">{d.title}</span>
                              )}
                              {approval && <Chip className={approval.chip}>{approval.label}</Chip>}
                            </div>
                            <div className="text-xs text-ink/60">
                              {[
                                d.file_name ? `${d.file_name} (${formatBytes(d.file_size ?? 0)})` : null,
                                d.resource_type,
                                d.version_label,
                                d.link_purpose,
                                `registered ${formatDay(d.registered_on)}`,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </div>
                            {d.other_projects > 0 && (
                              <div className="text-[11px] text-ink/60">
                                Also linked to {d.other_projects} other project{d.other_projects === 1 ? "" : "s"}
                              </div>
                            )}
                          </div>
                        </div>
                        {canManage && (
                          <RowActions>
                            <FormModalButton
                              title="Edit document"
                              trigger={(open) => <EditIcon label="Edit document" onClick={open} />}
                              render={(close) => <DocumentForm projectId={p.id} row={d} existing={[]} onDone={close} />}
                            />
                            <RemoveRecordButton kind="document" projectId={p.id} id={d.resource_id} label="Unlink document" what={d.title} />
                          </RowActions>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Section>
          )}

          {tab === "lessons" && (
            <Section
              title="Lessons learned"
              description="What worked, what didn't, and what to repeat or change. Collected under Projects → Lessons."
              action={
                canContribute ? (
                  <FormModalButton
                    title="Record a lesson"
                    trigger={(open) => <AddButton label="Lesson" onClick={open} />}
                    render={(close) => <LessonForm projectId={p.id} todayKey={todayKey} onDone={close} />}
                  />
                ) : undefined
              }
            >
              {p.lessons.length === 0 ? (
                <Empty>No lessons recorded yet.</Empty>
              ) : (
                <ul className="space-y-2">
                  {p.lessons.map((l) => (
                    <li key={l.id} className="rounded-xl border border-ink/8 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-ink/60">
                          {formatDay(l.recorded_on)}
                          {l.recorded_by_name ? ` · ${l.recorded_by_name}` : ""}
                        </span>
                        {(canManage || (canContribute && l.recorded_by === userId)) && (
                          <RowActions>
                            <FormModalButton
                              title="Edit lesson"
                              trigger={(open) => <EditIcon label="Edit lesson" onClick={open} />}
                              render={(close) => <LessonForm projectId={p.id} row={l} todayKey={todayKey} onDone={close} />}
                            />
                            <RemoveRecordButton kind="lesson" projectId={p.id} id={l.id} label="Remove lesson" what={formatDay(l.recorded_on)} />
                          </RowActions>
                        )}
                      </div>
                      <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-ink/80">{l.body}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          {tab === "discussion" && (
            <Section
              title="Discussion"
              description="Questions and decisions about this project. Mention someone with @ to notify them; assigned staff are told about new comments."
            >
              <CommentThread type="project" id={p.id} />
            </Section>
          )}

          {tab === "activity" && (
            <Section title="Activity" description="Every change to this project, from the audit trail.">
              {activity.length === 0 ? (
                <Empty>No recorded activity yet.</Empty>
              ) : (
                <ol className="relative space-y-3 border-l border-ink/10 pl-5">
                  {activity.map((a) => (
                    <li key={a.id} className="relative">
                      <span
                        className={`absolute top-1.5 -left-[25px] h-2.5 w-2.5 rounded-full ring-4 ring-white ${ACTIVITY_DOT[a.action] ?? "bg-ink/30"}`}
                        aria-hidden="true"
                      />
                      <div className="text-sm text-ink/85">
                        <span className="font-semibold text-ink">{a.who}</span> {activityVerb(a)}
                      </div>
                      {a.details && <div className="mt-0.5 line-clamp-2 text-xs text-ink/55">{a.details}</div>}
                      <div className="mt-0.5 text-[11px] text-ink/40">{formatDateTime(a.at)}</div>
                    </li>
                  ))}
                </ol>
              )}
            </Section>
          )}
        </div>
      </div>

      <aside className="panel overflow-hidden">
        <div className="border-b border-ink/8 p-5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip className={statusClass}>{p.status_name}</Chip>
            {p.phase_order && <Chip className="border-iica-500/30 bg-iica-600/10 text-iica-800">Phase {p.phase_order} of 8</Chip>}
          </div>
          <div className="mt-3 divide-y divide-ink/6">
            <Fact label="Model phase">{p.phase_name ?? "Not assigned"}</Fact>
            <Fact label="Funding status">{p.funding_status_name ?? "Not set"}</Fact>
            <Fact label="Start">{formatDay(p.start_date)}</Fact>
            <Fact label="Target end">
              <span className={targetLate ? "text-rose-700" : undefined}>
                {formatDay(p.target_end_date)}
                {targetLate && " (passed)"}
              </span>
            </Fact>
            <Fact label="Actual end">{formatDay(p.actual_end_date)}</Fact>
          </div>
        </div>

        {(p.areas.length > 0 || p.tags.length > 0) && (
          <div className="space-y-3 border-b border-ink/8 p-5">
            {p.areas.length > 0 && (
              <div>
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink/60">Programme areas</div>
                <div className="flex flex-wrap gap-1">
                  {p.areas.map((a) => (
                    <Chip key={a.id} className="border-ink/12 bg-iica-50/70 text-ink/75">
                      {a.name}
                    </Chip>
                  ))}
                </div>
              </div>
            )}
            {p.tags.length > 0 && (
              <div>
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink/60">Tags</div>
                <div className="flex flex-wrap gap-1">
                  {p.tags.map((t) => (
                    <Chip key={t.id} className="border-violet-200 bg-violet-50 text-violet-800">
                      {t.name}
                    </Chip>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="border-b border-ink/8 p-5">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink/60">At a glance</div>
          <div className="divide-y divide-ink/6">
            <Fact label="Staff assigned">{p.staff.length}</Fact>
            <Fact label="Open actions">
              {openActions.length}
              {p.overdue_actions > 0 && (
                <span className="ml-1 inline-flex items-center gap-0.5 text-rose-700">
                  <AlertTriangle size={11} aria-hidden="true" /> {p.overdue_actions} overdue
                </span>
              )}
            </Fact>
            <Fact label="Last update">{p.last_update_date ? formatDay(p.last_update_date) : "None yet"}</Fact>
            {p.funding.map((t) => (
              <Fact key={t.currency} label={`Received (${t.currency})`}>
                {formatMoney(t.received, null)} of {formatMoney(t.has_approved ? t.approved : t.requested, null)}
              </Fact>
            ))}
          </div>
        </div>

        <div className="p-5 text-[11px] text-ink/60">
          Created {formatDay(p.created_on)}
          {p.created_by_name ? ` by ${p.created_by_name}` : ""} · last changed {formatDay(p.updated_on)}
        </div>
      </aside>
    </div>
  );
}
