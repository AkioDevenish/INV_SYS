import Link from "next/link";
import { AlertTriangle, ArrowLeft, BookOpen, FolderKanban, ListChecks, Target } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getProjectReport, type CountRow } from "@/lib/project-reports";
import { formatDay, formatMoney } from "@/lib/project-meta";
import { PageHeader, StatCard } from "@/components/ui";
import { PrintButton } from "@/components/print-button";

export const metadata = { title: "Project reports" };

function Panel({
  title,
  description,
  children,
  flush = false,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  flush?: boolean;
}) {
  return (
    <section className="panel min-w-0">
      <div className="border-b border-ink/8 px-4 py-3.5 sm:px-5">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-ink/60">{description}</p>}
      </div>
      <div className={flush ? "" : "p-4 sm:p-5"}>{children}</div>
    </section>
  );
}

function Bars({
  rows,
  hrefFor,
  emptyText,
  numbered = false,
}: {
  rows: CountRow[];
  hrefFor: (row: CountRow) => string;
  emptyText: string;
  numbered?: boolean;
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  if (rows.every((r) => r.count === 0)) {
    return <p className="py-6 text-center text-xs text-ink/50">{emptyText}</p>;
  }
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={`${r.id ?? "none"}-${r.name}`}>
          <Link
            href={hrefFor(r)}
            className="group grid grid-cols-[minmax(0,1fr)_2.5rem] items-center gap-3 rounded-lg px-1.5 py-1 transition hover:bg-iica-50/60"
          >
            <span className="min-w-0">
              <span className="flex items-baseline gap-1.5 text-xs text-ink/80">
                {numbered && r.position < 99 && (
                  <span className="font-semibold tabular-nums text-ink/45">{r.position}.</span>
                )}
                <span className="truncate group-hover:text-iica-800">{r.name}</span>
              </span>
              <span className="mt-1 block h-2 overflow-hidden rounded-full bg-ink/[0.06]">
                <span
                  className={`block h-full rounded-full ${r.closed ? "bg-emerald-500/70" : r.id === null ? "bg-ink/25" : "bg-iica-600"}`}
                  style={{ width: `${r.count === 0 ? 0 : Math.max(3, (r.count / max) * 100)}%` }}
                />
              </span>
            </span>
            <span className="text-right text-sm font-semibold tabular-nums text-ink">{r.count}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default async function ProjectReportsPage() {
  const user = await requirePermission("projects.view");
  const [report, canSeeMoney] = await Promise.all([getProjectReport(), can(user.role, "reports.view")]);
  const { totals } = report;

  return (
    <>
      <Link
        href="/projects"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink/60 transition hover:text-ink"
      >
        <ArrowLeft size={15} /> Back to projects
      </Link>
      <PageHeader
        eyebrow="Project life cycle"
        title="Project reports"
        description="The portfolio at a glance: where projects sit, how funding stands in each currency, and who has actions outstanding."
        actions={<PrintButton />}
      />

      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Open projects"
            value={String(totals.open)}
            hint={`${totals.closed} finished · ${totals.total} in all`}
            icon={<FolderKanban size={15} />}
            tone="good"
          />
          <StatCard
            label="Past target end"
            value={String(totals.past_target)}
            hint="Open projects whose target date has passed"
            icon={<Target size={15} />}
            tone={totals.past_target ? "warn" : "default"}
          />
          <StatCard
            label="Overdue actions"
            value={String(totals.overdue_actions)}
            hint={`${totals.open_actions} follow-up actions open`}
            icon={<AlertTriangle size={15} />}
            tone={totals.overdue_actions ? "danger" : "default"}
          />
          <StatCard
            label="Lessons recorded"
            value={String(totals.lessons)}
            hint="Across every project"
            icon={<BookOpen size={15} />}
          />
        </div>

        {canSeeMoney && (
          <Panel
            title="Funding by currency"
            description="Requested, approved and received totals from every funding record. Currencies are never combined."
            flush
          >
            {report.funding.length === 0 ? (
              <p className="px-5 py-8 text-center text-xs text-ink/50">No funding recorded yet.</p>
            ) : (
              <div className="divide-y divide-ink/8">
                {report.funding.map((f) => {
                  const scale = Math.max(f.requested, f.approved, f.received, 1);
                  const pct = (n: number) => `${(n / scale) * 100}%`;
                  const share = f.approved ? Math.round((f.received / f.approved) * 100) : 0;
                  return (
                    <div key={f.currency} className="grid gap-3 px-4 py-4 sm:grid-cols-[7rem_minmax(0,1fr)] sm:px-5">
                      <div>
                        <div className="text-lg font-semibold tracking-tight text-ink">{f.currency}</div>
                        <div className="text-[11px] text-ink/55">
                          {f.projects} project{f.projects === 1 ? "" : "s"} · {f.arrangements} funder record
                          {f.arrangements === 1 ? "" : "s"}
                        </div>
                      </div>
                      <div className="space-y-2">
                        {(
                          [
                            ["Requested", f.requested, "bg-ink/20"],
                            ["Approved", f.approved, "bg-iica-600"],
                            ["Received", f.received, "bg-emerald-500"],
                          ] as const
                        ).map(([label, value, tone]) => (
                          <div key={label} className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-3 text-xs">
                            <span className="text-ink/60">{label}</span>
                            <span className="h-2.5 overflow-hidden rounded-full bg-ink/[0.06]">
                              <span className={`block h-full rounded-full ${tone}`} style={{ width: pct(value) }} />
                            </span>
                            <span className="min-w-[7rem] text-right font-semibold tabular-nums text-ink">
                              {formatMoney(value, f.currency)}
                            </span>
                          </div>
                        ))}
                        {f.approved > 0 && (
                          <p className="text-[11px] text-ink/55">{share}% of the approved amount has been received.</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>
        )}

        <div className="grid gap-4 xl:grid-cols-3">
          <Panel title="By IICA model phase" description="Open projects only">
            <Bars
              rows={report.byPhase}
              numbered
              hrefFor={(r) => (r.id ? `/projects?view=phases&phase=${r.id}` : "/projects?view=phases")}
              emptyText="No open projects yet."
            />
          </Panel>
          <Panel title="By status">
            <Bars
              rows={report.byStatus}
              hrefFor={(r) => `/projects?status=${r.id}`}
              emptyText="No projects yet."
            />
          </Panel>
          <Panel title="By programme area" description="A project can sit in more than one">
            <Bars
              rows={report.byArea}
              hrefFor={(r) => `/projects?area=${r.id}`}
              emptyText="No projects are classified by programme area yet."
            />
          </Panel>
        </div>

        <div className={`grid gap-4 ${canSeeMoney ? "xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]" : ""}`}>
          <Panel
            title="Open actions by person"
            description="Follow-up actions not yet done, most overdue first"
            flush
          >
            {report.actionsByPerson.length === 0 ? (
              <p className="px-5 py-8 text-center text-xs text-ink/50">No open follow-up actions.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="table-shell w-full [&_th]:px-4 [&_th]:py-3 [&_td]:px-4 [&_td]:py-3">
                  <thead>
                    <tr>
                      <th>Person</th>
                      <th className="text-right">Open</th>
                      <th className="text-right">Overdue</th>
                      <th className="text-right">Due in 14 days</th>
                      <th>Oldest overdue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.actionsByPerson.map((p) => (
                      <tr key={p.user_id ?? "none"}>
                        <td className="text-sm font-medium text-ink">
                          {p.user_id ? (
                            <Link
                              href={`/timelines?area=PROJECTS&lead=${encodeURIComponent(p.name)}`}
                              className="hover:text-iica-700 hover:underline"
                            >
                              {p.name}
                            </Link>
                          ) : (
                            <span className="text-ink/55">{p.name}</span>
                          )}
                        </td>
                        <td className="text-right text-sm tabular-nums">{p.open}</td>
                        <td className={`text-right text-sm font-semibold tabular-nums ${p.overdue ? "text-rose-700" : "text-ink/40"}`}>
                          {p.overdue}
                        </td>
                        <td className="text-right text-sm tabular-nums text-ink/70">{p.due_soon}</td>
                        <td className="text-xs text-ink/65">{p.oldest_overdue ? formatDay(p.oldest_overdue) : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          {canSeeMoney && (
            <Panel title="Largest funders" description="Approved amounts, per currency" flush>
              {report.funders.length === 0 ? (
                <p className="px-5 py-8 text-center text-xs text-ink/50">No funders recorded yet.</p>
              ) : (
                <ul className="divide-y divide-ink/8">
                  {report.funders.map((f) => (
                    <li key={`${f.funder}-${f.currency}`} className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-ink">{f.funder}</div>
                        <div className="text-[11px] text-ink/55">
                          {f.projects} project{f.projects === 1 ? "" : "s"} · {formatMoney(f.received, f.currency)} received
                        </div>
                      </div>
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">
                        {formatMoney(f.approved, f.currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
        </div>

        {!canSeeMoney && (
          <p className="flex items-center gap-1.5 text-xs text-ink/55">
            <ListChecks size={13} aria-hidden="true" /> Funding figures are hidden for your access level.
          </p>
        )}
      </div>
    </>
  );
}
