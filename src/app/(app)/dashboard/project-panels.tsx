import Link from "next/link";
import { AlertTriangle, CalendarClock, CheckCircle2 } from "lucide-react";
import { SectionCard } from "@/components/ui";
import type { Digest } from "@/lib/reminders";
import type { CurrencyFunding, ProjectAtRisk } from "@/lib/project-reports";
import { formatDay, formatMoney } from "@/lib/project-meta";

/** Your own overdue and upcoming timeline tasks and project actions. */
export function MyWeekPanel({ digest }: { digest: Digest | null }) {
  const items = digest ? [...digest.overdue, ...digest.upcoming] : [];
  return (
    <SectionCard
      title="My week"
      description="Your tasks and actions overdue or due in the next 7 days"
      action={
        <Link href="/timelines?mine=1" className="text-xs text-iica-700 hover:underline">
          My timelines
        </Link>
      }
      bodyClassName="px-4 py-3"
    >
      {items.length === 0 ? (
        <div className="flex items-center gap-2.5 py-6 text-sm text-ink/60">
          <CheckCircle2 size={18} className="text-emerald-600" aria-hidden="true" />
          Nothing overdue or due this week.
        </div>
      ) : (
        <ul className="divide-y divide-ink/6">
          {items.slice(0, 7).map((i, n) => (
            <li key={n}>
              <Link href={i.path} className="flex items-center gap-3 rounded-lg px-1 py-2 transition hover:bg-iica-50/60">
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                    i.overdue ? "bg-rose-50 text-rose-700" : "bg-iica-50 text-iica-700"
                  }`}
                >
                  {i.overdue ? <AlertTriangle size={14} /> : <CalendarClock size={14} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{i.title}</span>
                  <span className="block truncate text-[11px] text-ink/55">{i.context}</span>
                </span>
                <span className={`shrink-0 text-xs font-semibold ${i.overdue ? "text-rose-700" : "text-ink/60"}`}>
                  {formatDay(i.due, false)}
                </span>
              </Link>
            </li>
          ))}
          {items.length > 7 && (
            <li className="pt-2 text-center text-[11px] text-ink/50">and {items.length - 7} more</li>
          )}
        </ul>
      )}
    </SectionCard>
  );
}

export function ProjectRiskPanel({ projects }: { projects: ProjectAtRisk[] }) {
  return (
    <SectionCard
      title="Projects needing attention"
      description="Past their target end, or with overdue actions"
      action={
        <Link href="/projects/reports" className="text-xs text-iica-700 hover:underline">
          Reports
        </Link>
      }
      bodyClassName="px-4 py-3"
    >
      {projects.length === 0 ? (
        <div className="flex items-center gap-2.5 py-6 text-sm text-ink/60">
          <CheckCircle2 size={18} className="text-emerald-600" aria-hidden="true" />
          Every open project is on schedule.
        </div>
      ) : (
        <ul className="divide-y divide-ink/6">
          {projects.map((p) => (
            <li key={p.id}>
              <Link href={`/projects/${p.id}`} className="flex items-center gap-3 rounded-lg px-1 py-2 transition hover:bg-iica-50/60">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{p.title}</span>
                  <span className="block truncate text-[11px] text-ink/55">
                    {[p.code, p.target_end_date ? `Target ${formatDay(p.target_end_date)}` : null].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-0.5 text-[11px] font-semibold">
                  {p.days_late !== null && <span className="text-rose-700">{p.days_late}d late</span>}
                  {p.overdue_actions > 0 && (
                    <span className="text-gold-700">
                      {p.overdue_actions} overdue action{p.overdue_actions === 1 ? "" : "s"}
                    </span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

/**
 * Received against approved, per currency. Funding records keep a running
 * received total rather than dated payments, so this is to date, not per quarter.
 */
export function ProjectFundingPanel({ funding }: { funding: CurrencyFunding[] }) {
  return (
    <SectionCard
      title="Project funding"
      description="Received to date against approved, per currency"
      action={
        <Link href="/projects/reports" className="text-xs text-iica-700 hover:underline">
          Full report
        </Link>
      }
      bodyClassName="px-4 py-3.5"
    >
      {funding.length === 0 ? (
        <p className="py-6 text-sm text-ink/55">No project funding recorded yet.</p>
      ) : (
        <ul className="space-y-4">
          {funding.map((f) => {
            const base = f.approved || f.requested;
            const pct = base > 0 ? Math.min(100, Math.round((f.received / base) * 100)) : 0;
            return (
              <li key={f.currency}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-ink">{f.currency}</span>
                  <span className="text-xs tabular-nums text-ink/65">
                    <span className="font-semibold text-emerald-700">{formatMoney(f.received, null)}</span> of{" "}
                    {formatMoney(base, null)}
                  </span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-ink/[0.06]">
                  <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-1 text-[11px] text-ink/50">
                  {pct}% received · {f.projects} project{f.projects === 1 ? "" : "s"}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
