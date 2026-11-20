"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Eye,
  EyeOff,
  GripVertical,
  LayoutGrid,
  Loader2,
  RotateCcw,
  X,
} from "lucide-react";
import {
  PANELS,
  SPAN_CLASS,
  type DashboardFocus,
  type DashboardLayout,
  type PanelId,
} from "@/lib/dashboard";
import { resetLayoutAction, saveLayoutAction } from "./actions";

const FOCUS_OPTIONS: { key: DashboardFocus; label: string }[] = [
  { key: "all", label: "All panels" },
  { key: "inventory", label: "Inventory" },
  { key: "operations", label: "Schedule & tasks" },
  { key: "directory", label: "Directory & spend" },
];

/**
 * Lets somebody arrange their own dashboard.
 *
 * Dragging is native HTML5 drag and drop, which does not fire on touchscreens
 * and cannot be driven from a keyboard - so every panel also has explicit move
 * and hide buttons. Those are the accessible path, not a fallback nobody uses.
 *
 * Panels arrive already rendered from the server component; this only decides
 * what order they appear in.
 */
export function DashboardGrid({
  panels,
  initialLayout,
}: {
  /** Rendered panels, keyed by id. A missing key means no permission for it. */
  panels: Partial<Record<PanelId, ReactNode>>;
  initialLayout: DashboardLayout;
}) {
  const [focus, setFocus] = useState<DashboardFocus>("all");
  const [arranging, setArranging] = useState(false);
  const [order, setOrder] = useState<PanelId[]>(initialLayout.order);
  const [hidden, setHidden] = useState<PanelId[]>(initialLayout.hidden);
  const [dragging, setDragging] = useState<PanelId | null>(null);
  const [over, setOver] = useState<PanelId | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (arranging) return;
    setOrder(initialLayout.order);
    setHidden(initialLayout.hidden);
  }, [initialLayout, arranging]);

  // Only panels this person can actually see.
  const present = order.filter((id) => panels[id] !== undefined && id in PANELS);
  const visible = present.filter((id) => !hidden.includes(id));

  const availableFocuses = FOCUS_OPTIONS.filter(
    (opt) =>
      opt.key === "all" ||
      visible.some((id) => id !== "stats" && PANELS[id]?.focus === opt.key),
  );
  // If the user hid all panels belonging to the active focus tab, fall back to
  // "all" so the grid never renders completely blank.
  const effectiveFocus: DashboardFocus = availableFocuses.some((opt) => opt.key === focus)
    ? focus
    : "all";

  const focusedVisible =
    effectiveFocus === "all"
      ? visible
      : visible.filter(
          (id) => id === "stats" || PANELS[id]?.focus === effectiveFocus,
        );
  const shown = arranging ? present : focusedVisible;

  const dirty =
    present.join() !== initialLayout.order.filter((id) => panels[id] !== undefined).join() ||
    [...hidden].sort().join() !== [...initialLayout.hidden].sort().join();

  const move = (id: PanelId, delta: number) => {
    setOrder((current) => {
      // Step within the visible/permitted panels so unauthorized slots never swallow a move.
      const visibleOrder = current.filter((pid) => panels[pid] !== undefined);
      const fromVisible = visibleOrder.indexOf(id);
      const toVisible = fromVisible + delta;
      if (fromVisible < 0 || toVisible < 0 || toVisible >= visibleOrder.length) return current;

      const targetId = visibleOrder[toVisible];
      const next = [...current];
      const from = next.indexOf(id);
      const to = next.indexOf(targetId);
      if (from < 0 || to < 0) return current;
      next.splice(to, 0, next.splice(from, 1)[0]);
      return next;
    });
  };

  const dropOn = (target: PanelId) => {
    if (!dragging || dragging === target) {
      setDragging(null);
      setOver(null);
      return;
    }
    setOrder((current) => {
      if (panels[dragging] === undefined || panels[target] === undefined) return current;
      const next = [...current];
      const from = next.indexOf(dragging);
      const to = next.indexOf(target);
      if (from < 0 || to < 0) return current;
      next.splice(to, 0, next.splice(from, 1)[0]);
      return next;
    });
    setDragging(null);
    setOver(null);
  };

  const toggleHidden = (id: PanelId) =>
    setHidden((current) =>
      current.includes(id) ? current.filter((h) => h !== id) : [...current, id],
    );

  const save = async () => {
    setSaving(true);
    setError(undefined);
    const result = await saveLayoutAction({ order, hidden });
    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setDragging(null);
    setOver(null);
    setArranging(false);
  };

  const reset = async () => {
    setSaving(true);
    setError(undefined);
    const result = await resetLayoutAction();
    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setDragging(null);
    setOver(null);
    setArranging(false);
  };

  const cancel = () => {
    setOrder(initialLayout.order);
    setHidden(initialLayout.hidden);
    setError(undefined);
    setDragging(null);
    setOver(null);
    setArranging(false);
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        {arranging ? (
          <>
            <p className="text-xs text-ink/65">
              Drag a panel, or use the arrows. The eye hides a panel from your dashboard - it
              stays available to everyone else.
            </p>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {error && (
                <span role="alert" className="text-xs text-rose-700">
                  {error}
                </span>
              )}
              <button type="button" className="btn btn-ghost" onClick={reset} disabled={saving}>
                <RotateCcw size={15} /> Reset
              </button>
              <button type="button" className="btn btn-ghost" onClick={cancel} disabled={saving}>
                <X size={15} /> Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={save}
                disabled={saving || !dirty}
              >
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                Save layout
              </button>
            </div>
          </>
        ) : (
          <>
            {availableFocuses.length > 2 ? (
              <div
                role="group"
                aria-label="Dashboard view focus"
                className="flex flex-wrap items-center gap-1 rounded-xl border border-ink/10 bg-white/80 p-1"
              >
                {availableFocuses.map((opt) => {
                  const active = opt.key === effectiveFocus;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setFocus(opt.key)}
                      className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                        active
                          ? "bg-iica-700 text-white shadow-xs"
                          : "text-ink/70 hover:bg-iica-50 hover:text-iica-800"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            ) : (
              <span />
            )}
            {present.length > 0 && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setError(undefined);
                  setArranging(true);
                }}
              >
                <LayoutGrid size={15} /> Arrange dashboard
              </button>
            )}
          </>
        )}
      </div>

      {!arranging && present.length === 0 ? (
        <div className="panel flex flex-col items-center justify-center px-6 py-14 text-center">
          <p className="text-sm font-semibold text-ink/85">
            No dashboard panels are available for your role
          </p>
          <p className="mt-1.5 max-w-sm text-sm text-ink/60">
            Use the sidebar navigation to open the workspaces you have access to.
          </p>
        </div>
      ) : !arranging && (visible.length === 0 || focusedVisible.length === 0) && present.length > 0 ? (
        <div className="panel flex flex-col items-center justify-center px-6 py-14 text-center">
          <p className="text-sm font-semibold text-ink/85">
            {visible.length === 0
              ? "All dashboard panels are hidden"
              : "No visible panels in this view"}
          </p>
          <p className="mt-1.5 max-w-sm text-sm text-ink/65">
            {visible.length === 0
              ? "Restore panels to bring figures and charts back to your view."
              : "Switch back to all panels or restore hidden panels to populate this view."}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {visible.length > 0 && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setFocus("all")}
              >
                Show all panels
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setError(undefined);
                setArranging(true);
              }}
            >
              <LayoutGrid size={15} /> Show panels
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-12">
          {shown.map((id) => {
            const panel = PANELS[id];
            if (!panel) return null;
            const isHidden = hidden.includes(id);
            const index = present.indexOf(id);

            return (
              <div
                key={id}
                className={`${SPAN_CLASS[panel.span] ?? "lg:col-span-12"} ${
                  arranging ? "relative rounded-[1.3rem] ring-1 ring-dashed ring-iica-300" : ""
                } ${dragging === id ? "opacity-40" : ""} ${
                  over === id && dragging !== id ? "ring-2 ring-iica-600" : ""
                } ${isHidden ? "opacity-45" : ""}`}
                draggable={arranging}
                onDragStart={() => setDragging(id)}
                onDragEnd={() => {
                  setDragging(null);
                  setOver(null);
                }}
                onDragOver={(e) => {
                  if (!arranging) return;
                  e.preventDefault();
                  if (over !== id) setOver(id);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    setOver((cur) => (cur === id ? null : cur));
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  dropOn(id);
                }}
              >
                {arranging && (
                  <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-iica-50 px-2.5 py-1.5">
                    <GripVertical
                      size={15}
                      className="shrink-0 cursor-grab text-ink/40 active:cursor-grabbing"
                    />
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink/75">
                      {panel.title}
                    </span>
                    <button
                      type="button"
                      onClick={() => move(id, -1)}
                      disabled={index === 0}
                      className="rounded p-1 text-ink/55 transition hover:bg-white hover:text-ink disabled:opacity-30"
                      aria-label={`Move ${panel.title} earlier`}
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(id, 1)}
                      disabled={index === present.length - 1}
                      className="rounded p-1 text-ink/55 transition hover:bg-white hover:text-ink disabled:opacity-30"
                      aria-label={`Move ${panel.title} later`}
                    >
                      <ArrowDown size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleHidden(id)}
                      className="rounded p-1 text-ink/55 transition hover:bg-white hover:text-ink"
                      aria-label={isHidden ? `Show ${panel.title}` : `Hide ${panel.title}`}
                    >
                      {isHidden ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                )}

                <div className={arranging ? "pointer-events-none" : ""}>{panels[id]}</div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
