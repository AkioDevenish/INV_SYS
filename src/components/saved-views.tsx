"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Bookmark, BookmarkPlus, Check, Loader2, X } from "lucide-react";
import {
  deleteViewAction,
  listSavedViewsAction,
  saveViewAction,
  type SavedView,
} from "@/app/(app)/_actions/saved-views";

/**
 * "Views" for a list page: save the current filters under a name and reopen
 * them in one click. Each person's views are their own.
 */
export function SavedViews({ page }: { page: "timelines" | "projects" | "vendors" }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState<SavedView[] | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);

  const current = (() => {
    const p = new URLSearchParams(params.toString());
    p.delete("page");
    return p.toString();
  })();
  const activeView = views?.find((v) => v.query === current);

  useEffect(() => {
    if (open && views === null) start(async () => setViews(await listSavedViewsAction(page)));
  }, [open, views, page]);

  useEffect(() => {
    // Load once quietly so the button can show which saved view is active.
    start(async () => setViews(await listSavedViewsAction(page)));
  }, [page]);

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

  const save = () =>
    start(async () => {
      setError(undefined);
      const res = await saveViewAction(page, name, current);
      if (res.error) setError(res.error);
      else {
        setViews(res.views ?? []);
        setName("");
      }
    });

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
          activeView
            ? "border-iica-700 bg-iica-700 text-white"
            : "border-ink/12 bg-white text-ink/75 hover:border-iica-300 hover:bg-iica-50 hover:text-iica-800"
        }`}
      >
        <Bookmark size={13} aria-hidden="true" />
        {activeView ? activeView.name : "Views"}
      </button>

      {open && (
        <div className="animate-popover absolute right-0 z-50 mt-1.5 w-72 overflow-hidden rounded-xl border border-ink/10 bg-white shadow-[0_12px_32px_-12px_rgba(11,40,72,0.35)]">
          <div className="max-h-64 overflow-y-auto p-1">
            {views === null ? (
              <div className="flex justify-center py-4 text-ink/40">
                <Loader2 size={15} className="animate-spin" />
              </div>
            ) : views.length === 0 ? (
              <p className="px-3 py-3 text-xs text-ink/55">
                No saved views yet. Set the filters you use often, then save them below.
              </p>
            ) : (
              views.map((v) => (
                <div key={v.id} className="group flex items-center gap-1 rounded-lg hover:bg-iica-50">
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      router.replace(`${pathname}?${v.query}`, { scroll: false });
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left text-sm text-ink/85"
                  >
                    <Check size={13} className={v.query === current ? "text-iica-700" : "invisible"} aria-hidden="true" />
                    <span className="truncate">{v.name}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove view ${v.name}`}
                    onClick={() => start(async () => setViews(await deleteViewAction(page, v.id)))}
                    className="mr-1 rounded p-1 text-ink/30 opacity-0 transition group-hover:opacity-100 hover:bg-rose-50 hover:text-rose-700 focus:opacity-100"
                  >
                    <X size={13} />
                  </button>
                </div>
              ))
            )}
          </div>
          <div className="border-t border-ink/8 p-2">
            <div className="flex gap-1.5">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && save()}
                placeholder={current ? "Name these filters…" : "Set some filters first"}
                disabled={!current}
                maxLength={60}
                aria-label="Name for this view"
                className="field py-1.5 text-xs"
              />
              <button
                type="button"
                onClick={save}
                disabled={!current || !name.trim() || pending}
                className="btn btn-primary shrink-0 px-2.5 py-1.5 text-xs"
              >
                {pending ? <Loader2 size={13} className="animate-spin" /> : <BookmarkPlus size={13} />} Save
              </button>
            </div>
            {error && <p className="mt-1.5 text-xs text-rose-700">{error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
