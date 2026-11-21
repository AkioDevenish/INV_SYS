"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useIsClient } from "@/lib/use-is-client";

let scrollLockCount = 0;
let savedBodyOverflow: string | null = null;

/**
 * Reference-counted `body` scroll lock shared by modals and the mobile drawer so
 * closing one overlay never unlocks scrolling while another is still open.
 */
export function lockBodyScroll(): () => void {
  if (typeof document === "undefined") return () => {};
  if (scrollLockCount === 0) {
    savedBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  scrollLockCount += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    scrollLockCount = Math.max(0, scrollLockCount - 1);
    if (scrollLockCount === 0) {
      document.body.style.overflow = savedBodyOverflow ?? "";
      savedBodyOverflow = null;
    }
  };
}

const modalStack: string[] = [];
const savedInertState = new WeakMap<
  Element,
  { hadInert: boolean; inert: boolean; ariaHidden: string | null }
>();

function syncModalInertState() {
  if (typeof document === "undefined") return;
  const topId = modalStack[modalStack.length - 1] ?? null;

  for (const child of Array.from(document.body.children)) {
    const tag = child.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "LINK" || tag === "TEMPLATE") continue;

    const modalId = child.getAttribute("data-modal-id");
    const shouldBeInert = topId !== null && modalId !== topId;

    if (shouldBeInert) {
      if (!savedInertState.has(child)) {
        savedInertState.set(child, {
          hadInert: child.hasAttribute("inert"),
          inert: (child as HTMLElement).inert ?? false,
          ariaHidden: child.getAttribute("aria-hidden"),
        });
      }
      (child as HTMLElement).inert = true;
      child.setAttribute("aria-hidden", "true");
    } else if (savedInertState.has(child)) {
      const prev = savedInertState.get(child)!;
      savedInertState.delete(child);
      if (prev.hadInert) {
        (child as HTMLElement).inert = prev.inert;
      } else {
        child.removeAttribute("inert");
      }
      if (prev.ariaHidden === null) child.removeAttribute("aria-hidden");
      else child.setAttribute("aria-hidden", prev.ariaHidden);
    }
  }
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "summary",
  "[tabindex]:not([tabindex='-1'])",
  "[contenteditable='true']",
].join(",");

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true",
  );
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  width = "max-w-2xl",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  width?: string;
}) {
  // Modals are opened from page headers and table rows, and any of those
  // ancestors may carry a transform (the `rise` animation used to). A transformed
  // ancestor becomes the containing block for `position: fixed`, which pins the
  // dialog inside a sliver of the page instead of the viewport. Rendering into
  // <body> makes the dialog immune to whatever it was triggered from.
  const mounted = useIsClient();
  const modalId = useId();
  const titleId = useId();
  const descId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open || !mounted) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    modalStack.push(modalId);
    syncModalInertState();
    const releaseScroll = lockBodyScroll();

    const dialog = dialogRef.current;
    if (dialog && !dialog.contains(document.activeElement)) {
      dialog.focus({ preventScroll: true });
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (modalStack[modalStack.length - 1] !== modalId) return;

      if (e.key === "Escape") {
        if (e.defaultPrevented) return;
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
        return;
      }

      if (e.key === "Tab" && dialogRef.current) {
        const focusables = getFocusable(dialogRef.current);
        if (focusables.length === 0) {
          e.preventDefault();
          dialogRef.current.focus();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;

        if (e.shiftKey) {
          if (!active || active === first || active === dialogRef.current || !dialogRef.current.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else if (!active || active === last || !dialogRef.current.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      releaseScroll();
      const idx = modalStack.lastIndexOf(modalId);
      if (idx !== -1) modalStack.splice(idx, 1);
      syncModalInertState();
      if (previouslyFocused && previouslyFocused.isConnected) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [open, mounted, modalId]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      data-modal-id={modalId}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
    >
      <div
        className="animate-backdrop absolute inset-0 bg-ink-950/35 backdrop-blur-sm"
        onClick={() => onCloseRef.current()}
      />
      {/* Capped to the viewport with the body scrolling inside, so a long form
          stays usable on a phone or a short laptop window. */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={`animate-rise panel relative flex max-h-[calc(100dvh-1.5rem)] w-full flex-col outline-none sm:max-h-[calc(100dvh-3rem)] ${width}`}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-ink/8 px-5 py-4 sm:px-6 sm:py-5">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold tracking-tight text-ink">
              {title}
            </h2>
            {description && (
              <p id={descId} className="mt-1 text-sm text-ink/60">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => onCloseRef.current()}
            className="-mr-1 shrink-0 rounded-lg p-1.5 text-ink/55 transition hover:bg-ink/5 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-iica-600"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6 sm:py-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
