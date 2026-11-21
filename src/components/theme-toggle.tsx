"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

import { THEME_COOKIE, type ThemeChoice } from "@/lib/theme";

/**
 * Light, dark or follow the computer. The choice is a cookie so the server can
 * render the right theme straight away, with no flash of the wrong one.
 */
export function ThemeToggle({ initial }: { initial: ThemeChoice }) {
  const [choice, setChoice] = useState<ThemeChoice>(initial);

  useEffect(() => {
    const root = document.documentElement;
    if (choice === "system") delete root.dataset.theme;
    else root.dataset.theme = choice;
    document.cookie = `${THEME_COOKIE}=${choice}; path=/; max-age=31536000; samesite=lax`;
  }, [choice]);

  const options: { value: ThemeChoice; label: string; Icon: typeof Sun }[] = [
    { value: "light", label: "Light", Icon: Sun },
    { value: "dark", label: "Dark", Icon: Moon },
    { value: "system", label: "System", Icon: Monitor },
  ];

  return (
    <div role="radiogroup" aria-label="Appearance" className="grid grid-cols-3 gap-0.5 rounded-lg border border-ink/10 bg-ink/[0.03] p-0.5">
      {options.map(({ value, label, Icon }) => {
        const on = choice === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={on}
            title={label}
            onClick={() => setChoice(value)}
            className={`flex items-center justify-center gap-1 rounded-md py-1 text-[11px] font-medium transition ${
              on ? "bg-white text-ink shadow-xs" : "text-ink/55 hover:text-ink"
            }`}
          >
            <Icon size={12} aria-hidden="true" />
            <span className="sr-only sm:not-sr-only">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
