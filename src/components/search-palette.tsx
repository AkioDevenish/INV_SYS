"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight,
  BookOpen,
  Boxes,
  BriefcaseBusiness,
  CalendarDays,
  Contact,
  CornerDownLeft,
  FolderKanban,
  ListChecks,
  Loader2,
  Search,
  SquareCheckBig,
  UserRound,
} from "lucide-react";
import { lockBodyScroll } from "./modal";
import type { NavSection } from "./nav-config";
import type { SearchGroup, SearchKind } from "@/lib/search";

const KIND_ICON: Record<SearchKind, React.ComponentType<{ size?: number; className?: string }>> = {
  project: FolderKanban,
  action: SquareCheckBig,
  lesson: BookOpen,
  task: ListChecks,
  event: CalendarDays,
  stakeholder: Contact,
  vendor: BriefcaseBusiness,
  item: Boxes,
  user: UserRound,
};

type Entry = { key: string; title: string; subtitle: string | null; href: string; kind: SearchKind | "page" };

/** The trigger shown in the sidebar and mobile header. */
export function SearchTrigger({ variant }: { variant: "sidebar" | "icon" }) {
  const open = () => window.dispatchEvent(new Event("app-search:open"));
  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={open}
        aria-label="Search"
        className="rounded-lg p-2 text-ink/70 transition hover:bg-ink/5 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-iica-600"
      >
        <Search size={18} aria-hidden="true" />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={open}
      className="group flex w-full items-center gap-2 rounded-xl border border-ink/10 bg-iica-50/40 px-3 py-2 text-left text-[13px] text-ink/55 transition hover:border-iica-300 hover:bg-white hover:text-ink/75 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-iica-600"
    >
      <Search size={15} aria-hidden="true" className="shrink-0" />
      <span className="flex-1">Search…</span>
      <kbd className="rounded-md border border-ink/12 bg-white px-1.5 py-0.5 font-sans text-[10px] font-semibold text-ink/50">
        ⌘K
      </kbd>
    </button>
  );
}

/**
 * Search everything the signed-in person can see: projects, actions, tasks,
 * events, stakeholders, vendors, inventory and (for admins) people.
 * Opens with ⌘K / Ctrl+K, "/" or the trigger buttons.
 */
export function SearchPalette({ sections }: { sections: NavSection[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLElement &&
        (e.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName));
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setOpen(true);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("app-search:open", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("app-search:open", onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const release = lockBodyScroll();
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      release();
      prev?.focus({ preventScroll: true });
    };
  }, [open]);

  // Debounced fetch; an abort stops a slow earlier search overwriting a newer one.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setGroups([]);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        const data = res.ok ? ((await res.json()) as { groups: SearchGroup[] }) : { groups: [] };
        setGroups(data.groups);
        setActive(0);
      } catch {
        /* aborted */
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 160);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [query, open]);

  const pages: Entry[] = useMemo(
    () =>
      sections.flatMap((s) =>
        s.items.map((i) => ({
          key: `page-${i.href}`,
          title: i.label,
          subtitle: i.description,
          href: i.href,
          kind: "page" as const,
        })),
      ),
    [sections],
  );

  const q = query.trim();
  const matchingPages = q
    ? pages.filter((p) => `${p.title} ${p.subtitle ?? ""}`.toLowerCase().includes(q.toLowerCase())).slice(0, 4)
    : pages;

  const sectionsToShow: { label: string; entries: Entry[] }[] = [
    ...(matchingPages.length ? [{ label: q ? "Pages" : "Go to", entries: matchingPages }] : []),
    ...groups.map((g) => ({
      label: g.label,
      entries: g.hits.map((h) => ({ key: `${h.kind}-${h.id}`, title: h.title, subtitle: h.subtitle, href: h.href, kind: h.kind })),
    })),
  ];
  const flat = sectionsToShow.flatMap((s) => s.entries);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setGroups([]);
    setActive(0);
  }, []);

  const go = (entry: Entry | undefined) => {
    if (!entry) return;
    close();
    router.push(entry.href);
  };

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(flat.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(flat[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  if (!mounted || !open) return null;

  let index = -1;
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-start justify-center px-4 pt-[12vh]" role="presentation">
      <div className="animate-backdrop absolute inset-0 bg-ink-950/30 backdrop-blur-sm" onClick={close} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className="animate-popover relative w-full max-w-xl overflow-hidden rounded-2xl border border-ink/10 bg-white shadow-[0_24px_64px_-24px_rgba(11,40,72,0.45)]"
      >
        <div className="flex items-center gap-3 border-b border-ink/8 px-4">
          {loading ? (
            <Loader2 size={18} className="shrink-0 animate-spin text-iica-700" aria-hidden="true" />
          ) : (
            <Search size={18} className="shrink-0 text-ink/45" aria-hidden="true" />
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search projects, tasks, people, vendors…"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={flat[active] ? `${listId}-${active}` : undefined}
            aria-autocomplete="list"
            className="h-14 min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink/40"
          />
          <kbd className="hidden rounded-md border border-ink/12 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-ink/45 sm:block">
            Esc
          </kbd>
        </div>

        <div ref={listRef} id={listId} role="listbox" aria-label="Results" className="max-h-[56vh] overflow-y-auto p-2">
          {sectionsToShow.map((section) => (
            <div key={section.label} className="mb-1.5 last:mb-0">
              <div className="px-2.5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink/45">
                {section.label}
              </div>
              {section.entries.map((entry) => {
                index += 1;
                const i = index;
                const Icon = entry.kind === "page" ? ArrowRight : KIND_ICON[entry.kind];
                const isActive = i === active;
                return (
                  <div
                    key={entry.key}
                    id={`${listId}-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={isActive}
                    onMouseMove={() => active !== i && setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => go(entry)}
                    className={`flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 ${isActive ? "bg-iica-50" : ""}`}
                  >
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                        isActive ? "bg-iica-700 text-white" : "bg-ink/[0.05] text-ink/55"
                      }`}
                    >
                      <Icon size={15} aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{entry.title}</span>
                      {entry.subtitle && <span className="block truncate text-xs text-ink/55">{entry.subtitle}</span>}
                    </span>
                    {isActive && <CornerDownLeft size={14} className="shrink-0 text-ink/40" aria-hidden="true" />}
                  </div>
                );
              })}
            </div>
          ))}

          {q.length >= 2 && !loading && groups.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-ink/55">
              Nothing found for “{q}”.
            </p>
          )}
          {q.length === 1 && <p className="px-3 py-3 text-center text-xs text-ink/45">Keep typing…</p>}
        </div>

        <div className="flex items-center gap-4 border-t border-ink/8 bg-iica-50/40 px-4 py-2 text-[11px] text-ink/50">
          <span>
            <kbd className="font-sans font-semibold">↑↓</kbd> to move
          </span>
          <span>
            <kbd className="font-sans font-semibold">Enter</kbd> to open
          </span>
          <span className="ml-auto hidden sm:inline">
            <kbd className="font-sans font-semibold">⌘K</kbd> anywhere
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
