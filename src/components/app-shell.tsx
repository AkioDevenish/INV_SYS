"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftRight,
  BarChart3,
  Boxes,
  Gauge,
  LogOut,
  MapPin,
  Menu,
  List,
  ListChecks,
  ShieldCheck,
  Tags,
  Contact,
  CalendarDays,
  BriefcaseBusiness,
  FolderKanban,
  KeyRound,
  Users,
  X,
} from "lucide-react";
import { BrandLockup, BrandMark } from "./brand";
import { APP_NAME } from "@/lib/brand";
import { lockBodyScroll } from "./modal";
import { SearchPalette, SearchTrigger } from "./search-palette";
import { NotificationBell } from "./notification-bell";
import { ThemeToggle } from "./theme-toggle";
import type { ThemeChoice } from "@/lib/theme";
import type { NavSection } from "./nav-config";
import { ROLE_LABELS, type Role } from "@/lib/roles";
import { initials } from "@/lib/format";

const ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  gauge: Gauge,
  chart: BarChart3,
  boxes: Boxes,
  arrows: ArrowLeftRight,
  tags: Tags,
  pin: MapPin,
  users: Users,
  key: KeyRound,
  shield: ShieldCheck,
  contacts: Contact,
  calendar: CalendarDays,
  briefcase: BriefcaseBusiness,
  list: List,
  checklist: ListChecks,
  project: FolderKanban,
};

const DRAWER_FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

type Props = {
  sections: NavSection[];
  user: { name: string; role: Role };
  logout: () => Promise<void>;
  children: React.ReactNode;
  theme?: ThemeChoice;
};

function isItemActive(pathname: string, href: string, match?: string[]) {
  const paths = [href, ...(match ?? [])];
  return paths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function AppShell({ sections, user, logout, children, theme = "system" }: Props) {
  const pathname = usePathname();
  const [openPathname, setOpenPathname] = useState<string | null>(null);
  const open = openPathname === pathname;
  const drawerRef = useRef<HTMLElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef(true);

  const openDrawer = () => {
    restoreFocusRef.current = true;
    setOpenPathname(pathname);
  };

  const closeDrawer = (restoreFocus: boolean) => {
    restoreFocusRef.current = restoreFocus;
    setOpenPathname(null);
  };

  useEffect(() => {
    if (!open) return;

    const openedPathname = window.location.pathname;
    const releaseScroll = lockBodyScroll();
    const drawer = drawerRef.current;
    const prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    if (drawer && !drawer.contains(document.activeElement)) {
      drawer.focus({ preventScroll: true });
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (e.defaultPrevented) return;
        e.preventDefault();
        restoreFocusRef.current = true;
        setOpenPathname(null);
        return;
      }

      if (e.key === "Tab" && drawerRef.current) {
        const focusables = Array.from(
          drawerRef.current.querySelectorAll<HTMLElement>(DRAWER_FOCUSABLE),
        );
        if (focusables.length === 0) {
          e.preventDefault();
          drawerRef.current.focus();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;

        if (e.shiftKey) {
          if (!active || active === first || active === drawerRef.current || !drawerRef.current.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else if (!active || active === last || !drawerRef.current.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      releaseScroll();
      const navigatedAway = window.location.pathname !== openedPathname;
      if (restoreFocusRef.current && !navigatedAway) {
        if (menuButtonRef.current?.isConnected) {
          menuButtonRef.current.focus({ preventScroll: true });
        } else if (prevFocus?.isConnected) {
          prevFocus.focus({ preventScroll: true });
        }
      }
    };
  }, [open]);

  const activeTitle = useMemo(() => {
    if (pathname === "/profile" || pathname.startsWith("/profile/")) return "Profile";
    for (const section of sections) {
      for (const item of section.items) {
        if (isItemActive(pathname, item.href, item.match)) return item.label;
      }
    }
    return APP_NAME;
  }, [pathname, sections]);

  const renderNav = (onNavigate?: () => void) => (
    <nav aria-label="Primary" className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
      {sections.map((section, i) => (
        <div key={section.title || `section-${i}`}>
          {section.title && (
            <div className="px-3 pb-1.5 text-[11px] font-semibold text-ink/65">
              {section.title}
            </div>
          )}
          <ul className="space-y-1">
            {section.items.map((item) => {
              const Icon = ICONS[item.icon] ?? Boxes;
              const active = isItemActive(pathname, item.href, item.match);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    onClick={onNavigate}
                    title={item.description}
                    className={`group flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] font-medium transition-all duration-200 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-iica-600 motion-safe:active:scale-[0.99] ${
                      active
                        ? "bg-iica-700 font-semibold text-white shadow-xs"
                        : "text-ink/80 hover:bg-iica-50 hover:text-iica-800"
                    }`}
                  >
                    <Icon
                      size={16}
                      aria-hidden="true"
                      className={
                        active
                          ? "shrink-0 text-white"
                          : "shrink-0 text-ink/65 transition group-hover:text-iica-700"
                      }
                    />
                    <span className="truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  const renderAccount = (onNavigate?: () => void) => (
    <div className="border-t border-ink/8 p-3">
      <div className="space-y-2 rounded-xl border border-ink/8 bg-iica-50/40 p-2.5">
        <Link
          href="/profile"
          onClick={onNavigate}
          className="flex min-w-0 items-center gap-2.5 rounded-lg p-0.5 transition hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-iica-600"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-iica-700 text-xs font-semibold text-white">
            {initials(user.name)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold text-ink">
              {user.name}
            </span>
            <span className="block truncate text-[11px] text-ink/65">
              {ROLE_LABELS[user.role] ?? user.role}
            </span>
          </span>
        </Link>
        <ThemeToggle initial={theme} />
        <form action={logout}>
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-ink/10 bg-white px-2.5 py-1.5 text-xs font-medium text-ink/80 transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-iica-600"
          >
            <LogOut size={13} aria-hidden="true" />
            <span>Sign out</span>
          </button>
        </form>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      <SearchPalette sections={sections} />
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-xl focus:bg-iica-700 focus:px-4 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-white focus:shadow-lg focus:outline-2 focus:outline-offset-2 focus:outline-iica-900"
      >
        Skip to main content
      </a>

      {/* Desktop sidebar */}
      <aside
        data-app-chrome="sidebar"
        inert={open || undefined}
        aria-hidden={open || undefined}
        className="sticky top-0 z-30 hidden h-screen w-[248px] shrink-0 flex-col border-r border-ink/8 bg-white lg:flex"
      >
        <div className="border-b border-ink/8 px-4 py-4">
          <div className="flex items-start justify-between gap-2">
            <Link href="/" className="inline-block rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-iica-600">
              <BrandLockup />
            </Link>
            <NotificationBell />
          </div>
          <div className="mt-3.5">
            <SearchTrigger variant="sidebar" />
          </div>
        </div>
        {renderNav()}
        {renderAccount()}
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div data-app-chrome="mobile-drawer" className="fixed inset-0 z-50 lg:hidden">
          <div
            aria-hidden="true"
            className="animate-backdrop absolute inset-0 bg-ink-950/35 backdrop-blur-sm"
            onClick={() => closeDrawer(true)}
          />
          <aside
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            tabIndex={-1}
            className="animate-fade absolute inset-y-0 left-0 flex w-[280px] max-w-[85vw] flex-col border-r border-ink/10 bg-white outline-none"
          >
            <div className="flex items-center justify-between border-b border-ink/8 px-5 py-4">
              <Link
                href="/"
                onClick={() => closeDrawer(false)}
                className="inline-block rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-iica-600"
              >
                <BrandLockup />
              </Link>
              <button
                type="button"
                onClick={() => closeDrawer(true)}
                className="rounded-lg p-1.5 text-ink/70 hover:bg-ink/5 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-iica-600"
                aria-label="Close navigation"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            {renderNav(() => closeDrawer(false))}
            {renderAccount(() => closeDrawer(false))}
          </aside>
        </div>
      )}

      <div
        inert={open || undefined}
        aria-hidden={open || undefined}
        className="flex min-w-0 flex-1 flex-col"
      >
        <header
          data-app-chrome="mobile-header"
          className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-ink/8 bg-white/85 px-4 py-3 backdrop-blur-xl lg:hidden"
        >
          <div className="flex min-w-0 items-center gap-3">
            <button
              ref={menuButtonRef}
              type="button"
              onClick={openDrawer}
              aria-expanded={open}
              aria-label="Open navigation"
              className="rounded-lg p-2 text-ink/75 hover:bg-ink/5 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-iica-600"
            >
              <Menu size={18} aria-hidden="true" />
            </button>
            <Link
              href="/"
              className="flex min-w-0 items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-iica-600"
            >
              <BrandMark size={28} />
              <span className="truncate text-sm font-semibold text-ink">{activeTitle}</span>
            </Link>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
          <SearchTrigger variant="icon" />
          <NotificationBell align="right" />
          <Link
            href="/profile"
            aria-label={`Profile (${user.name})`}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-iica-700 text-xs font-semibold text-white transition hover:bg-iica-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-iica-600"
          >
            {initials(user.name)}
          </Link>
          </div>
        </header>

        <main
          id="main-content"
          tabIndex={-1}
          className="min-w-0 flex-1 px-4 py-6 focus:outline-none sm:px-6 lg:px-8 lg:py-8"
        >
          {/* Capped so a 2560px monitor does not stretch every table to breaking. */}
          <div className="mx-auto w-full max-w-[1600px]">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
