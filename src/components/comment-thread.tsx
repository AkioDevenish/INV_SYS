"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, MessageSquare, Send, Trash2 } from "lucide-react";
import { initials } from "@/lib/format";
import type { CommentRow, Mentionable } from "@/lib/comments";

type Payload = { comments: CommentRow[]; people: Mentionable[]; currentUserId: number; canModerate: boolean };

function when(iso: string): string {
  const d = new Date(iso);
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

/** Highlights "@Full Name" for people who exist, leaves everything else as typed. */
function renderBody(body: string, people: Mentionable[]) {
  if (!people.length) return body;
  const names = [...people].map((p) => p.name).sort((a, b) => b.length - a.length);
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`@(${escaped.join("|")})(?![\\p{L}\\p{N}])`, "giu");
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of body.matchAll(re)) {
    if (m.index! > last) parts.push(body.slice(last, m.index));
    parts.push(
      <span key={m.index} className="rounded bg-iica-50 px-1 font-medium text-iica-800">
        {m[0]}
      </span>,
    );
    last = m.index! + m[0].length;
  }
  parts.push(body.slice(last));
  return parts;
}

/**
 * A discussion thread on a project or timeline task. Type "@" to mention a
 * colleague; they get a notification, as do the people responsible.
 */
export function CommentThread({ type, id, compact = false }: { type: "project" | "task"; id: number; compact?: boolean }) {
  const [data, setData] = useState<Payload | null>(null);
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string>();
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/comments?type=${type}&id=${id}`, { cache: "no-store" });
    if (res.ok) setData((await res.json()) as Payload);
  }, [type, id]);

  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  const suggestions = useMemo(() => {
    if (!mention || !data) return [];
    const q = mention.query.toLowerCase();
    return data.people.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 6);
  }, [mention, data]);

  const onChange = (value: string) => {
    setText(value);
    const caret = boxRef.current?.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    const m = before.match(/(^|\s)@([\p{L}\p{N} .'-]{0,30})$/u);
    if (m) {
      setMention({ start: caret - m[2].length - 1, query: m[2] });
      setActive(0);
    } else {
      setMention(null);
    }
  };

  const pick = (p: Mentionable) => {
    if (!mention) return;
    const caret = boxRef.current?.selectionStart ?? text.length;
    const next = `${text.slice(0, mention.start)}@${p.name} ${text.slice(caret)}`;
    setText(next);
    setMention(null);
    requestAnimationFrame(() => {
      const pos = mention.start + p.name.length + 2;
      boxRef.current?.focus();
      boxRef.current?.setSelectionRange(pos, pos);
    });
  };

  const post = async () => {
    const body = text.trim();
    if (!body || posting) return;
    setPosting(true);
    setError(undefined);
    const res = await fetch("/api/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, id, body }),
    });
    const out = (await res.json().catch(() => ({}))) as { comments?: CommentRow[]; error?: string };
    setPosting(false);
    if (!res.ok || !out.comments) {
      setError(out.error ?? "Your comment couldn't be posted.");
      return;
    }
    setText("");
    setData((d) => (d ? { ...d, comments: out.comments! } : d));
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  };

  const remove = async (commentId: number) => {
    const res = await fetch(`/api/comments?comment=${commentId}`, { method: "DELETE" });
    const out = (await res.json().catch(() => ({}))) as { comments?: CommentRow[]; error?: string };
    if (res.ok && out.comments) setData((d) => (d ? { ...d, comments: out.comments! } : d));
    else setError(out.error ?? "That comment couldn't be removed.");
  };

  if (!data) {
    return (
      <div className="flex items-center justify-center py-6 text-ink/40">
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }

  return (
    <div>
      {data.comments.length === 0 ? (
        <p className={`flex items-center gap-2 text-xs text-ink/50 ${compact ? "pb-2" : "pb-3"}`}>
          <MessageSquare size={13} aria-hidden="true" /> No comments yet. Start the conversation below.
        </p>
      ) : (
        <ul className={`space-y-3 ${compact ? "max-h-72 overflow-y-auto pr-1" : ""} pb-3`}>
          {data.comments.map((c) => (
            <li key={c.id} className="group flex gap-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-iica-700 text-[10px] font-bold text-white">
                {initials(c.author_name ?? "?")}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-semibold text-ink">{c.author_name ?? "Former user"}</span>
                  <span className="text-[11px] text-ink/40">{when(c.created_at)}</span>
                  {(c.author_id === data.currentUserId || data.canModerate) && (
                    <button
                      type="button"
                      onClick={() => void remove(c.id)}
                      aria-label="Remove comment"
                      className="ml-auto rounded p-1 text-ink/30 opacity-0 transition group-hover:opacity-100 hover:bg-rose-50 hover:text-rose-700 focus:opacity-100"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
                <p className="mt-0.5 whitespace-pre-line break-words text-sm leading-relaxed text-ink/80">
                  {renderBody(c.body, data.people)}
                </p>
              </div>
            </li>
          ))}
          <div ref={endRef} />
        </ul>
      )}

      <div className="relative">
        <textarea
          ref={boxRef}
          value={text}
          rows={compact ? 2 : 3}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (mention && suggestions.length) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => (a + 1) % suggestions.length);
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => (a - 1 + suggestions.length) % suggestions.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                pick(suggestions[active]);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setMention(null);
                return;
              }
            }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void post();
            }
          }}
          placeholder="Add a comment. Type @ to mention someone."
          aria-label="Add a comment"
          className="field resize-none pr-12 text-sm"
        />
        <button
          type="button"
          onClick={() => void post()}
          disabled={!text.trim() || posting}
          aria-label="Post comment"
          className="absolute right-2 bottom-2 flex h-8 w-8 items-center justify-center rounded-lg bg-iica-700 text-white transition hover:bg-iica-800 disabled:opacity-35"
        >
          {posting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
        </button>
        {mention && suggestions.length > 0 && (
          <ul
            role="listbox"
            aria-label="Mention someone"
            className="animate-popover absolute bottom-full left-0 z-30 mb-1.5 w-64 overflow-hidden rounded-xl border border-ink/10 bg-white p-1 shadow-lg"
          >
            {suggestions.map((p, i) => (
              <li
                key={p.id}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(p);
                }}
                onMouseEnter={() => setActive(i)}
                className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${i === active ? "bg-iica-50 text-iica-900" : "text-ink/80"}`}
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-iica-700 text-[9px] font-bold text-white">
                  {initials(p.name)}
                </span>
                {p.name}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-ink/40">
        <span>{error ? <span className="text-rose-700">{error}</span> : "⌘/Ctrl + Enter to post"}</span>
      </div>
    </div>
  );
}
