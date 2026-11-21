"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, AtSign, Bell, CheckCheck, FolderKanban, ListChecks, MessageSquare, UserPlus } from "lucide-react";
import type { NotificationKind, NotificationRow } from "@/lib/notifications";

const ICONS: Record<NotificationKind, React.ComponentType<{ size?: number; className?: string }>> = {
  task_assigned: ListChecks,
  action_assigned: UserPlus,
  project_added: FolderKanban,
  mention: AtSign,
  comment: MessageSquare,
  overdue: AlertTriangle,
};

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/**
 * The bell: unread count, and a panel of recent notifications. Polls every
 * minute and whenever the window regains focus.
 */
export function NotificationBell({ align = "left" }: { align?: "left" | "right" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unread, setUnread] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (init?: RequestInit) => {
    try {
      const res = await fetch("/api/notifications", { cache: "no-store", ...init });
      if (!res.ok) return;
      const data = (await res.json()) as { items: NotificationRow[]; unread: number };
      setItems(data.items);
      setUnread(data.unread);
    } catch {
      /* offline: keep what we have */
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const markRead = (id?: number) =>
    load({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(id ? { id } : {}) });

  const openItem = (n: NotificationRow) => {
    setOpen(false);
    if (!n.read) void markRead(n.id);
    if (n.href) router.push(n.href);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          if (!open) void load();
        }}
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        className="relative rounded-lg p-2 text-ink/70 transition hover:bg-ink/5 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-iica-600"
      >
        <Bell size={18} aria-hidden="true" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white tabular-nums">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className={`animate-popover absolute z-[60] mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-ink/10 bg-white shadow-[0_18px_48px_-18px_rgba(11,40,72,0.45)] ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          <div className="flex items-center justify-between gap-2 border-b border-ink/8 px-4 py-3">
            <span className="text-sm font-semibold text-ink">Notifications</span>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => void markRead()}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-iica-700 hover:bg-iica-50"
              >
                <CheckCheck size={13} aria-hidden="true" /> Mark all read
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <Bell size={20} className="mx-auto text-ink/25" aria-hidden="true" />
              <p className="mt-2 text-xs text-ink/55">You&apos;re all caught up.</p>
            </div>
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto">
              {items.map((n) => {
                const Icon = ICONS[n.kind] ?? Bell;
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => openItem(n)}
                      className={`flex w-full gap-3 border-b border-ink/6 px-4 py-3 text-left transition last:border-b-0 hover:bg-iica-50/60 ${
                        n.read ? "" : "bg-iica-50/40"
                      }`}
                    >
                      <span
                        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                          n.kind === "overdue" ? "bg-rose-50 text-rose-700" : "bg-iica-50 text-iica-700"
                        }`}
                      >
                        <Icon size={14} aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block text-[13px] leading-snug ${n.read ? "text-ink/75" : "font-semibold text-ink"}`}>
                          {n.title}
                        </span>
                        {n.body && <span className="mt-0.5 line-clamp-2 block text-xs text-ink/55">{n.body}</span>}
                        <span className="mt-1 block text-[11px] text-ink/40">
                          {n.actor_name ? `${n.actor_name} · ` : ""}
                          {ago(n.created_at)}
                        </span>
                      </span>
                      {!n.read && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-iica-600" aria-label="Unread" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
