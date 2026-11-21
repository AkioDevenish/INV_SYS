"use client";

import { useState, useTransition } from "react";
import { BellRing, Eye, Loader2, Send } from "lucide-react";
import type { DigestItem } from "@/lib/reminders";
import { sendAllRemindersAction, sendTestReminderAction, setRemindersEnabledAction } from "./reminder-actions";

function day(key: string): string {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function RemindersCard({
  enabled,
  overdue,
  upcoming,
  mailReady,
  lastSent,
  isAdmin,
}: {
  enabled: boolean;
  overdue: DigestItem[];
  upcoming: DigestItem[];
  mailReady: boolean;
  lastSent: string | null;
  isAdmin: boolean;
}) {
  const [on, setOn] = useState(enabled);
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<"test" | "all" | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const toggle = () => {
    const next = !on;
    setOn(next);
    setNote(null);
    start(async () => {
      const res = await setRemindersEnabledAction(next);
      if (res.error) {
        setOn(!next);
        setNote({ tone: "error", text: res.error });
      }
    });
  };

  const run = (which: "test" | "all") => {
    setBusy(which);
    setNote(null);
    start(async () => {
      const res = which === "test" ? await sendTestReminderAction() : await sendAllRemindersAction();
      setBusy(null);
      setNote(res.error ? { tone: "error", text: res.error } : { tone: "ok", text: res.message ?? "Done." });
    });
  };

  const items = [...overdue, ...upcoming];

  return (
    <section className="panel">
      <div className="flex items-start justify-between gap-4 border-b border-ink/8 px-5 py-4">
        <div className="flex gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-iica-50 text-iica-700">
            <BellRing size={17} aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-ink">Weekly reminder email</h2>
            <p className="mt-0.5 text-xs leading-relaxed text-ink/60">
              Every Monday morning: your overdue timeline tasks and project actions, and anything due in the next 7
              days. Nothing is sent in a week with nothing due.
            </p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Weekly reminder email"
          disabled={pending && busy === null}
          onClick={toggle}
          className={`relative mt-1 h-6 w-11 shrink-0 rounded-full transition ${on ? "bg-iica-700" : "bg-ink/20"}`}
        >
          <span
            className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : ""}`}
          />
        </button>
      </div>

      <div className="px-5 py-4">
        <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.1em] text-ink/50">
          <span>This week&apos;s email would include</span>
          {lastSent && <span className="normal-case tracking-normal font-normal">Last sent {day(lastSent)}</span>}
        </div>
        {items.length === 0 ? (
          <p className="rounded-xl border border-dashed border-ink/15 px-4 py-5 text-center text-xs text-ink/55">
            Nothing overdue or due in the next 7 days.
          </p>
        ) : (
          <ul className="divide-y divide-ink/8 rounded-xl border border-ink/8">
            {items.slice(0, 8).map((i, n) => (
              <li key={n} className="flex items-start justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-ink">{i.title}</div>
                  <div className="truncate text-[11px] text-ink/55">{i.context}</div>
                </div>
                <span className={`shrink-0 text-xs font-semibold ${i.overdue ? "text-rose-700" : "text-iica-700"}`}>
                  {i.overdue ? "Overdue · " : ""}
                  {day(i.due)}
                </span>
              </li>
            ))}
            {items.length > 8 && (
              <li className="px-3 py-2 text-center text-[11px] text-ink/55">and {items.length - 8} more</li>
            )}
          </ul>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {items.length > 0 && (
            <a
              href="/api/reminders/preview"
              target="_blank"
              rel="noopener"
              className="btn btn-ghost px-3 py-1.5 text-xs"
            >
              <Eye size={13} /> Preview email
            </a>
          )}
          <button
            type="button"
            className="btn btn-ghost px-3 py-1.5 text-xs"
            disabled={!mailReady || pending}
            onClick={() => run("test")}
          >
            {busy === "test" ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Send me a test
          </button>
          {isAdmin && (
            <button
              type="button"
              className="btn btn-ghost px-3 py-1.5 text-xs"
              disabled={!mailReady || pending}
              onClick={() => run("all")}
            >
              {busy === "all" ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Send this week&apos;s
              to everyone
            </button>
          )}
          {!mailReady && (
            <span className="text-[11px] text-ink/55">Email isn&apos;t set up on the server yet.</span>
          )}
        </div>
        {note && (
          <p role="status" className={`mt-2 text-xs ${note.tone === "error" ? "text-rose-700" : "text-emerald-700"}`}>
            {note.text}
          </p>
        )}
      </div>
    </section>
  );
}
