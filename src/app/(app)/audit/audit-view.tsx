"use client";

import { useMemo, useState, type ReactNode } from "react";
import { CalendarClock, FileText, ShieldCheck, User } from "lucide-react";
import { Modal } from "@/components/modal";
import { initials } from "@/lib/format";

export type SerializedAuditLog = {
  id: number;
  user_label: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  details: string | null;
  created_at: string;
};

const ACTION_STYLES: Record<string, string> = {
  CREATE: "border-iica-500/35 bg-iica-50 text-iica-800",
  UPDATE: "border-sky-600/35 bg-sky-50 text-sky-800",
  DELETE: "border-rose-500/35 bg-rose-50 text-rose-700",
  IMPORT: "border-indigo-500/35 bg-indigo-50 text-indigo-800",
  EXPORT: "border-indigo-500/35 bg-indigo-50 text-indigo-800",
  SETUP: "border-emerald-600/35 bg-emerald-50 text-emerald-800",
  SIGN_IN: "border-ink/15 bg-ink/5 text-ink/70",
  SIGN_IN_FAILED: "border-rose-500/35 bg-rose-50 text-rose-700",
  SIGN_OUT: "border-ink/15 bg-ink/5 text-ink/70",
  RESET_PASSWORD: "border-gold-600/40 bg-gold-400/20 text-gold-700",
  CHANGE_PASSWORD: "border-gold-600/40 bg-gold-400/20 text-gold-700",
  SEED: "border-ink/15 bg-ink/5 text-ink/65",
  CONDITION_CHANGE: "border-orange-600/35 bg-orange-50 text-orange-800",
};

function styleForAction(action: string) {
  if (action.startsWith("MOVEMENT_")) return "border-gold-600/40 bg-gold-400/20 text-gold-700";
  return ACTION_STYLES[action] ?? "border-ink/15 bg-ink/5 text-ink/70";
}

function moduleInfo(entity: string): { label: string; badgeClass: string } {
  const e = entity.trim().toLowerCase();
  if (["vendor", "vendor_engagement"].includes(e)) {
    return { label: "Vendors", badgeClass: "border-indigo-200 bg-indigo-50 text-indigo-800" };
  }
  if (e === "calendar_event") {
    return { label: "Calendar", badgeClass: "border-emerald-200 bg-emerald-50 text-emerald-800" };
  }
  if (["stakeholder", "stakeholder_group", "stakeholdergroup"].includes(e)) {
    return { label: "Stakeholders", badgeClass: "border-amber-200 bg-amber-50 text-amber-800" };
  }
  if (e === "project" || e.startsWith("project_")) {
    return { label: "Projects", badgeClass: "border-teal-200 bg-teal-50 text-teal-800" };
  }
  if (["task", "timeline", "staff_task"].includes(e)) {
    return { label: "Timelines", badgeClass: "border-sky-200 bg-sky-50 text-sky-800" };
  }
  if (["user", "session", "permissions", "profile", "system"].includes(e)) {
    return { label: "Users & access", badgeClass: "border-rose-200 bg-rose-50 text-rose-800" };
  }
  return { label: "Inventory & stock", badgeClass: "border-iica-200 bg-iica-50 text-iica-800" };
}

function splitLabel(label: string | null): { name: string; detail: string | null } {
  if (!label) return { name: "System", detail: null };
  const match = label.match(/^(.*?)\s*[<(]([^>)]+)[>)]\s*$/);
  return match ? { name: match[1] || label, detail: match[2] } : { name: label, detail: null };
}

function formatDetails(details: string | null): { text: string; isJson: boolean } {
  if (!details) return { text: "No additional details logged for this entry.", isJson: false };
  const trimmed = details.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      return { text: JSON.stringify(parsed, null, 2), isJson: true };
    } catch {
      // Plain text that happens to start with bracket/brace.
    }
  }
  return { text: details, isJson: false };
}

function formatTtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/Port_of_Spain",
  });
}

function formatTtFullDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZone: "America/Port_of_Spain",
  });
}

function formatTtDayHeading(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "America/Port_of_Spain",
  });
}

export function AuditView({
  logs,
  total,
  filterKey,
  pagination,
}: {
  logs: SerializedAuditLog[];
  total: number;
  filterKey: string;
  pagination?: ReactNode;
}) {
  const [selectedLogId, setSelectedLogId] = useState<number | null>(null);

  const selectedLog = useMemo(
    () => (selectedLogId !== null ? logs.find((l) => l.id === selectedLogId) ?? null : null),
    [logs, selectedLogId],
  );

  const byDay = useMemo(() => {
    const map = new Map<string, SerializedAuditLog[]>();
    for (const log of logs) {
      const day = formatTtDayHeading(log.created_at);
      const bucket = map.get(day);
      if (bucket) bucket.push(log);
      else map.set(day, [log]);
    }
    return [...map.entries()];
  }, [logs]);

  return (
    <>
      <section key={filterKey} className="animate-fade panel">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink/8 px-4 py-3.5 sm:px-5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-ink">
              {total.toLocaleString()} entr{total === 1 ? "y" : "ies"}
            </h2>
            <span className="text-xs text-ink/55">Append-only activity history</span>
          </div>
          <span className="text-xs text-ink/55">Newest first · Click any entry to inspect</span>
        </header>

        {/* Column strip on md+ */}
        <div className="hidden grid-cols-[5.5rem_12rem_8.5rem_9.5rem_1fr] gap-x-3 border-b border-ink/8 bg-iica-50 px-5 py-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink/60 md:grid">
          <span>Time (AST)</span>
          <span>Person</span>
          <span>Module</span>
          <span>Action</span>
          <span>Details</span>
        </div>

        {byDay.map(([day, entries]) => (
          <div key={day}>
            <div className="sticky top-0 z-10 border-b border-ink/8 bg-iica-50/95 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/60 backdrop-blur sm:px-5">
              {day}
            </div>
            <ul className="divide-y divide-ink/6">
              {entries.map((log) => {
                const who = splitLabel(log.user_label);
                const mod = moduleInfo(log.entity);
                return (
                  <li key={log.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedLogId(log.id)}
                      className="flex w-full flex-col gap-1.5 px-4 py-3 text-left transition hover:bg-iica-50/60 md:grid md:grid-cols-[5.5rem_12rem_8.5rem_9.5rem_1fr] md:items-center md:gap-x-3 md:gap-y-0 md:px-5"
                    >
                      <div className="flex items-center justify-between gap-3 md:contents">
                        <time className="text-xs font-medium text-ink/60 tabular-nums">
                          {formatTtTime(log.created_at)}
                        </time>

                        <span className="flex min-w-0 flex-1 items-center gap-2 md:flex-initial">
                          <span className="hidden h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-iica-700/10 text-[10px] font-bold text-iica-800 sm:flex">
                            {initials(who.name)}
                          </span>
                          <span className="truncate text-sm font-medium text-ink">{who.name}</span>
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 md:contents">
                        <span
                          className={`inline-flex w-fit rounded-full border px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${mod.badgeClass}`}
                        >
                          {mod.label}
                        </span>

                        <span className={`chip w-fit whitespace-nowrap ${styleForAction(log.action)}`}>
                          {log.action.toLowerCase().replace(/_/g, " ")}
                        </span>
                      </div>

                      <span className="min-w-0 truncate text-xs text-ink/70 md:text-sm">
                        <span className="text-ink/55">
                          {log.entity}
                          {log.entity_id ? ` #${log.entity_id}` : ""}
                        </span>
                        {log.details && <span className="ml-2 text-ink/80">{log.details}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        {pagination}
      </section>

      {/* Audit Entry Details Modal */}
      <Modal
        open={Boolean(selectedLog)}
        onClose={() => setSelectedLogId(null)}
        title="Audit entry details"
        description={selectedLog ? formatTtFullDateTime(selectedLog.created_at) + " AST" : undefined}
        width="max-w-lg"
      >
        {selectedLog && (() => {
          const who = splitLabel(selectedLog.user_label);
          const mod = moduleInfo(selectedLog.entity);
          const formatted = formatDetails(selectedLog.details);
          return (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${mod.badgeClass}`}
                >
                  {mod.label}
                </span>
                <span className={`chip ${styleForAction(selectedLog.action)}`}>
                  {selectedLog.action.toLowerCase().replace(/_/g, " ")}
                </span>
              </div>

              <div className="space-y-2.5 rounded-xl border border-ink/8 bg-iica-50/45 p-3.5 text-xs">
                <div className="flex items-center gap-2">
                  <User size={14} className="shrink-0 text-iica-700" />
                  <span className="font-semibold text-ink">{who.name}</span>
                  {who.detail && <span className="text-ink/60">({who.detail})</span>}
                </div>
                <div className="flex items-center gap-2">
                  <ShieldCheck size={14} className="shrink-0 text-iica-700" />
                  <span className="text-ink/75">
                    Target:{" "}
                    <strong className="font-semibold text-ink">
                      {selectedLog.entity}
                      {selectedLog.entity_id ? ` #${selectedLog.entity_id}` : ""}
                    </strong>
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <CalendarClock size={14} className="shrink-0 text-iica-700" />
                  <span className="text-ink/75">
                    {formatTtFullDateTime(selectedLog.created_at)} (AST)
                  </span>
                </div>
              </div>

              <div>
                <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-ink/70">
                  <FileText size={13} /> Recorded details
                </div>
                {formatted.isJson ? (
                  <pre className="max-h-72 overflow-auto rounded-xl border border-ink/10 bg-iica-50/40 p-3.5 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-ink">
                    {formatted.text}
                  </pre>
                ) : (
                  <div className="rounded-xl border border-ink/10 bg-white p-3.5 text-sm leading-relaxed whitespace-pre-wrap break-words text-ink">
                    {formatted.text}
                  </div>
                )}
              </div>

              <div className="flex justify-end border-t border-ink/8 pt-3.5">
                <button
                  type="button"
                  onClick={() => setSelectedLogId(null)}
                  className="btn btn-ghost px-4 py-2 text-xs"
                >
                  Close
                </button>
              </div>
            </div>
          );
        })()}
      </Modal>
    </>
  );
}
