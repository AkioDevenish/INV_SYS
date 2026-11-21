"use client";

import type { MouseEvent, ReactNode } from "react";

/**
 * The row-level edit and delete controls, defined once so every list in the
 * app - users, stakeholders, inventory, reference lists - uses the same
 * treatment: a quiet outline icon that only takes on colour when hovered, and
 * red only for the destructive one.
 *
 * Page-level actions keep the labelled `.btn` styles; these are for table rows
 * and cards, where a label would crowd the row.
 */
export function IconButton({
  onClick,
  label,
  children,
  tone = "neutral",
  disabled = false,
  type = "button",
  className = "",
}: {
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  /** Used for both the accessible name and the hover tooltip. */
  label: string;
  children: ReactNode;
  tone?: "neutral" | "danger";
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`rounded-lg p-2 text-ink/60 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-iica-600 disabled:pointer-events-none disabled:opacity-45 ${
        tone === "danger"
          ? "hover:bg-rose-500/10 hover:text-rose-700"
          : "hover:bg-ink/5 hover:text-ink"
      } ${className}`}
    >
      {children}
    </button>
  );
}

/** Keeps the spacing consistent wherever a pair of them sits together. */
export function RowActions({ children }: { children: ReactNode }) {
  return <div className="flex items-center justify-end gap-1">{children}</div>;
}
