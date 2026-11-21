import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getProject } from "@/lib/projects";
import { ACTION_STATE_META, APPROVAL_META, formatDay, formatMoney, isActionState, type ApprovalState } from "@/lib/project-meta";
import { APP_NAME } from "@/lib/brand";
import { PrintButton } from "@/components/print-button";

export const metadata = { title: "Project summary" };

function H({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-7 mb-2 border-b border-ink/15 pb-1 text-[11px] font-bold tracking-[0.14em] text-iica-800 uppercase">
      {children}
    </h2>
  );
}

/**
 * A one-page summary of a project, laid out for paper: print it, or choose
 * "Save as PDF" in the print dialog, for meetings and funders.
 */
export default async function ProjectPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("projects.view");
  const raw = (await params).id;
  const id = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(id) || id < 1) notFound();
  const [p, canSeeMoney] = await Promise.all([getProject(id), can(user.role, "reports.view")]);
  if (!p) notFound();

  const openActions = p.actions.filter((a) => a.state === "OPEN" || a.state === "IN_PROGRESS");
  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="mx-auto max-w-[820px]">
      <div className="no-print mb-5 flex flex-wrap items-center justify-between gap-2">
        <Link href={`/projects/${p.id}`} className="inline-flex items-center gap-1.5 text-sm text-ink/60 hover:text-ink">
          <ArrowLeft size={15} /> Back to project
        </Link>
        <PrintButton />
      </div>

      <article className="panel px-8 py-9 text-ink print:border-0 print:p-0">
        <header className="flex items-start justify-between gap-6 border-b-2 border-iica-700 pb-4">
          <div>
            <div className="text-[11px] font-semibold text-iica-700">
              {APP_NAME} · Project summary
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">{p.title}</h1>
            {p.code && <div className="mt-0.5 text-sm text-ink/60">{p.code}</div>}
          </div>
          <div className="shrink-0 text-right text-xs text-ink/60">
            Prepared {today}
            <div className="mt-1 font-semibold text-ink">{p.status_name}</div>
          </div>
        </header>

        <dl className="mt-5 grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
          {[
            ["Model phase", p.phase_order ? `${p.phase_order}. ${p.phase_name}` : "Not assigned"],
            ["Funding status", p.funding_status_name ?? "Not set"],
            ["Start", formatDay(p.start_date)],
            ["Target end", formatDay(p.target_end_date)],
            ["Actual end", formatDay(p.actual_end_date)],
            ["Programme areas", p.areas.map((a) => a.name).join(", ") || "-"],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-[11px] text-ink/50 uppercase tracking-[0.08em]">{k}</dt>
              <dd className="font-medium">{v}</dd>
            </div>
          ))}
        </dl>

        {p.purpose && (
          <>
            <H>Purpose</H>
            <p className="text-sm leading-relaxed whitespace-pre-line">{p.purpose}</p>
          </>
        )}

        {p.outcome_summary && (
          <>
            <H>Outcome</H>
            <p className="text-sm leading-relaxed whitespace-pre-line">{p.outcome_summary}</p>
          </>
        )}

        <H>People</H>
        <div className="grid gap-6 text-sm sm:grid-cols-2">
          <div>
            <div className="mb-1 text-xs font-semibold text-ink/60">IICA staff</div>
            {p.staff_rows.filter((s) => s.active).length === 0 ? (
              <p className="text-ink/50">None assigned.</p>
            ) : (
              <ul className="space-y-0.5">
                {p.staff_rows
                  .filter((s) => s.active)
                  .map((s) => (
                    <li key={s.id}>
                      {s.name} <span className="text-ink/55">· {s.role_name}</span>
                    </li>
                  ))}
              </ul>
            )}
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold text-ink/60">Stakeholders</div>
            {p.stakeholders.length === 0 ? (
              <p className="text-ink/50">None recorded.</p>
            ) : (
              <ul className="space-y-0.5">
                {p.stakeholders.map((s) => (
                  <li key={s.id}>
                    {s.name}
                    {s.involvement_role ? <span className="text-ink/55"> · {s.involvement_role}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {canSeeMoney && p.funding_rows.length > 0 && (
          <>
            <H>Funding</H>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-ink/50 uppercase tracking-[0.08em]">
                  <th className="py-1 font-semibold">Funder</th>
                  <th className="py-1 font-semibold">Status</th>
                  <th className="py-1 text-right font-semibold">Requested</th>
                  <th className="py-1 text-right font-semibold">Approved</th>
                  <th className="py-1 text-right font-semibold">Received</th>
                </tr>
              </thead>
              <tbody>
                {p.funding_rows.map((f) => (
                  <tr key={f.id} className="border-t border-ink/10">
                    <td className="py-1.5">{f.funder}</td>
                    <td className="py-1.5 text-ink/70">{f.funding_status_name ?? "-"}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatMoney(f.amount_requested, f.currency_code)}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatMoney(f.amount_approved, f.currency_code)}</td>
                    <td className="py-1.5 text-right font-semibold tabular-nums">{formatMoney(f.amount_received, f.currency_code)}</td>
                  </tr>
                ))}
                {p.funding.map((t) => (
                  <tr key={t.currency} className="border-t-2 border-ink/20 font-semibold">
                    <td className="py-1.5">Total {t.currency}</td>
                    <td />
                    <td className="py-1.5 text-right tabular-nums">{formatMoney(t.requested, null)}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatMoney(t.approved, null)}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatMoney(t.received, null)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <H>Recent progress</H>
        {p.updates.length === 0 ? (
          <p className="text-sm text-ink/50">No updates recorded.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {p.updates.slice(0, 6).map((u) => (
              <li key={u.id} className="grid grid-cols-[6.5rem_1fr] gap-3">
                <span className="text-ink/55">{formatDay(u.update_date)}</span>
                <span className="leading-relaxed whitespace-pre-line">{u.body}</span>
              </li>
            ))}
          </ul>
        )}

        <H>Open follow-up actions</H>
        {openActions.length === 0 ? (
          <p className="text-sm text-ink/50">Nothing outstanding.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {openActions.map((a) => (
              <li key={a.id} className="grid grid-cols-[1fr_auto] gap-3">
                <span>
                  {a.description}
                  {a.assigned_name ? <span className="text-ink/55"> · {a.assigned_name}</span> : null}
                </span>
                <span className="text-ink/60">
                  {a.due_date ? formatDay(a.due_date) : ""}
                  {isActionState(a.state) ? ` · ${ACTION_STATE_META[a.state].label}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}

        {p.documents.length > 0 && (
          <>
            <H>Documents</H>
            <ul className="space-y-0.5 text-sm">
              {p.documents.map((d) => (
                <li key={d.resource_id}>
                  {d.title}
                  <span className="text-ink/55">
                    {[d.resource_type, d.version_label, APPROVAL_META[d.approval_state as ApprovalState]?.label]
                      .filter(Boolean)
                      .map((x) => ` · ${x}`)
                      .join("")}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        {p.lessons.length > 0 && (
          <>
            <H>Lessons learned</H>
            <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed">
              {p.lessons.map((l) => (
                <li key={l.id} className="whitespace-pre-line">
                  {l.body}
                </li>
              ))}
            </ul>
          </>
        )}
      </article>
    </div>
  );
}
