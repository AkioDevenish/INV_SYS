"use client";

import { Printer } from "lucide-react";

/** Opens the browser's print dialog, where "Save as PDF" is one of the printers. Hidden in print. */
export function PrintButton({ label = "Print / Save as PDF" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="no-print btn btn-ghost">
      <Printer size={15} aria-hidden="true" /> {label}
    </button>
  );
}
