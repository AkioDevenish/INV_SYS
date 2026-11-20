"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export type FilterOption = {
  value: string;
  label: string;
  count?: number;
  disabled?: boolean;
};

/**
 * A dropdown for filter bars that looks like the rest of the app. The native
 * <select> menu is drawn by the operating system (dark on a dark-mode Mac),
 * so filters use this instead. Form fields keep native selects, which suit
 * forms and phones better.
 */
export function FilterSelect({
  value: controlled,
  defaultValue = "",
  onChange,
  options,
  ariaLabel,
  className = "",
  name,
  id,
  size = "sm",
}: {
  /** Controlled value; leave out and use defaultValue inside forms. */
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  options: FilterOption[];
  ariaLabel: string;
  className?: string;
  /** When set, a hidden input carries the value so the menu submits with a form. */
  name?: string;
  /** Lets a <label htmlFor> point at the menu. */
  id?: string;
  /** "md" matches the height and text size of form fields. */
  size?: "sm" | "md";
}) {
  const [internal, setInternal] = useState(defaultValue);
  const value = controlled ?? internal;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typeaheadRef = useRef<{ buffer: string; timer: ReturnType<typeof setTimeout> | null }>({
    buffer: "",
    timer: null,
  });
  const listId = useId();
  const optionId = (index: number) => `${listId}-option-${index}`;

  useEffect(() => {
    const state = typeaheadRef.current;
    return () => {
      if (state.timer) clearTimeout(state.timer);
    };
  }, []);

  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const selected = options[selectedIndex];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (open) {
      listRef.current
        ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
        ?.scrollIntoView({ block: "nearest" });
    }
  }, [open, active]);

  const [alignRight, setAlignRight] = useState(false);

  const openMenu = (initialActive = selectedIndex) => {
    // Menus can be wider than their button; near the right edge they open
    // leftwards so they never run off screen.
    const rect = rootRef.current?.getBoundingClientRect();
    setAlignRight(Boolean(rect && rect.left > window.innerWidth / 2));
    setActive(initialActive);
    setOpen(true);
  };

  const firstEnabled = () => {
    const idx = options.findIndex((o) => !o.disabled);
    return idx >= 0 ? idx : 0;
  };

  const lastEnabled = () => {
    for (let i = options.length - 1; i >= 0; i--) {
      if (!options[i].disabled) return i;
    }
    return 0;
  };

  const step = (from: number, dir: 1 | -1) => {
    for (let i = 1; i <= options.length; i++) {
      const next = (from + dir * i + options.length) % options.length;
      if (!options[next].disabled) return next;
    }
    return from;
  };

  const findTypeaheadMatch = (char: string, startFrom: number) => {
    const state = typeaheadRef.current;
    if (state.timer) clearTimeout(state.timer);
    state.buffer += char.toLowerCase();
    state.timer = setTimeout(() => {
      state.buffer = "";
      state.timer = null;
    }, 500);

    const query = state.buffer;
    const total = options.length;
    if (total === 0) return -1;

    const search = (prefix: string, offset: number) => {
      for (let i = 0; i < total; i++) {
        const idx = (offset + i) % total;
        const opt = options[idx];
        if (!opt.disabled && opt.label.trim().toLowerCase().startsWith(prefix)) {
          return idx;
        }
      }
      return -1;
    };

    const startOffset = query.length === 1 ? (startFrom + 1) % total : startFrom;
    const direct = search(query, startOffset);
    if (direct !== -1) return direct;
    // Repeating the same letter cycles through options starting with that letter.
    if (query.length > 1 && new Set(query).size === 1) {
      return search(query[0], (startFrom + 1) % total);
    }
    return -1;
  };

  const choose = (i: number) => {
    const o = options[i];
    if (!o || o.disabled) return;
    setOpen(false);
    if (o.value !== value) {
      if (controlled === undefined) setInternal(o.value);
      onChange?.(o.value);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const isPrintable =
      !e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1 && e.key !== " ";

    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        openMenu();
      } else if (e.key === "Home") {
        e.preventDefault();
        openMenu(firstEnabled());
      } else if (e.key === "End") {
        e.preventDefault();
        openMenu(lastEnabled());
      } else if (isPrintable) {
        const match = findTypeaheadMatch(e.key, selectedIndex);
        if (match !== -1) {
          e.preventDefault();
          openMenu(match);
        }
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => step(a, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => step(a, -1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(firstEnabled());
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(lastEnabled());
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(active);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === "Tab") {
      setOpen(false);
    } else if (isPrintable) {
      const match = findTypeaheadMatch(e.key, active);
      if (match !== -1) {
        e.preventDefault();
        setActive(match);
      }
    }
  };

  const label = (o: FilterOption) => (o.count !== undefined ? `${o.label} (${o.count})` : o.label);
  const activeOptionId = open && options[active] ? optionId(active) : undefined;

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      {name !== undefined && <input type="hidden" name={name} value={value} />}
      <button
        id={id}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={activeOptionId}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
        className={`flex w-full items-center justify-between gap-2 rounded-xl border bg-white text-left text-ink transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-iica-600 ${
          size === "md" ? "py-2.5 pr-3 pl-3.5 text-sm" : "py-1.5 pr-2.5 pl-3 text-xs"
        } ${
          open
            ? "border-iica-600 shadow-[0_0_0_3px_rgba(27,83,145,0.15)]"
            : "border-[var(--hairline-strong)] hover:border-iica-300"
        }`}
      >
        <span className="truncate">{selected ? label(selected) : ariaLabel}</span>
        <ChevronDown
          size={14}
          aria-hidden="true"
          className={`shrink-0 text-ink/65 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          className={`animate-popover absolute ${alignRight ? "right-0" : "left-0"} z-50 mt-1.5 max-h-72 max-w-[calc(100vw-2rem)] min-w-full overflow-y-auto rounded-xl border border-ink/10 bg-white p-1 shadow-[0_12px_32px_-12px_rgba(11,40,72,0.35)]`}
        >
          {options.map((o, i) => {
            const isSelected = i === selectedIndex;
            const isActive = i === active;
            return (
              <li
                key={o.value || "__all"}
                id={optionId(i)}
                data-index={i}
                role="option"
                aria-selected={isSelected}
                aria-disabled={o.disabled || undefined}
                onMouseEnter={() => !o.disabled && setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(i)}
                className={`flex cursor-pointer items-center justify-between gap-3 whitespace-nowrap rounded-lg px-2.5 ${size === "md" ? "py-2 text-sm" : "py-1.5 text-xs"} ${
                  o.disabled
                    ? "cursor-not-allowed text-ink/45"
                    : isActive
                      ? "bg-iica-50 text-iica-900"
                      : "text-ink/80"
                } ${isSelected ? "font-semibold" : ""}`}
              >
                <span>{o.label}</span>
                <span className="flex items-center gap-2">
                  {o.count !== undefined && (
                    <span className="rounded-full bg-ink/6 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-ink/65">
                      {o.count}
                    </span>
                  )}
                  <Check size={13} aria-hidden="true" className={isSelected ? "text-iica-700" : "invisible"} />
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
