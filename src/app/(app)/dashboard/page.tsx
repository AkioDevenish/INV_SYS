import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeftRight,
  Boxes,
  CalendarDays,
  CheckCircle2,
  Coins,
  FolderKanban,
  ListChecks,
  MapPin,
  Tags,
  Users,
  Users2,
} from "lucide-react";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { ensureSchema } from "@/lib/setup";
import {
  conditionCounts,
  countTasksByStatus,
  dashboardStats,
  listCalendarEvents,
  listItems,
  listMovements,
  listStaffTasks,
  listStakeholderGroups,
  listTaskAreas,
  lowStockItems,
  movementTrend,
  stakeholderStats,
  stakeholdersByGroup,
  stockByCategory,
  stockByLocation,
} from "@/lib/queries";
import { listProjects } from "@/lib/projects";
import { listVendorsWithStats } from "@/lib/vendors";
import {
  VENDOR_GROUP_ORDER,
  VENDOR_GROUPS,
  vendorGroupForCategory,
} from "@/lib/vendor-groups";
import {
  APP_TIMEZONE,
  formatCurrency,
  formatCurrencyCompact,
  formatNumber,
  formatUnits,
  relativeTime,
} from "@/lib/format";
import { EmptyState, PageHeader, SectionCard, StatCard } from "@/components/ui";
import { ExportDialog } from "@/components/export-dialog";
import { DashboardGrid } from "./dashboard-grid";
import { loadLayout } from "@/lib/dashboard-server";
import { exportDatasetsFor } from "@/lib/export-datasets";
import { TrendChart } from "@/components/trend-chart";
import {
  D3CalendarPulseChart,
  D3CategoryChart,
  D3ConditionHealthChart,
  D3LocationChart,
  D3OperationsChart,
  D3StakeholderChart,
  D3VendorSpendChart,
  type CalendarPulseDay,
  type CalendarPulseEvent,
  type VendorGroupSpendDatum,
  type VendorRenewalDatum,
} from "@/components/d3-dashboard-charts";
import { MovementTypeBadge } from "@/components/movement-badge";
import { Sku } from "@/components/sku";

export const metadata = { title: "Dashboard" };

function astDayKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIMEZONE }).format(date);
}

function addDaysToKey(dayKey: string, delta: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta, 12, 0, 0));
  return dt.toISOString().slice(0, 10);
}

function formatAstClock(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: APP_TIMEZONE,
  });
}

function formatShortAstLabel(dayKey: string): { label: string; shortDay: string } {
  const [y, m, d] = dayKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return {
    label: dt.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: APP_TIMEZONE,
    }),
    shortDay: dt.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: APP_TIMEZONE,
    }),
  };
}

/**
 * Adaptive executive command center.
 *
 * Instead of gating the whole dashboard behind a single module permission, every
 * signed-in user sees the KPIs and interactive D3.js charts their role grants,
 * spanning inventory, stock trends, 14-day schedule, timelines, projects,
 * directory groups, and vendor spend.
 */
export default async function DashboardPage() {
  const user = await requireUser("/dashboard");

  // Run schema readiness check unconditionally before fanning out concurrent
  // dashboard queries so DDL locks never interleave with parallel reads.
  await ensureSchema();

  const [
    showInventory,
    showReports,
    showCalendar,
    showStakeholders,
    showTimelines,
    showProjects,
    canRecord,
    canManageUsers,
    canManageTaxonomy,
    exportDatasets,
    layout,
  ] = await Promise.all([
    can(user.role, "inventory.view"),
    can(user.role, "reports.view"),
    can(user.role, "calendar.view"),
    can(user.role, "stakeholders.view"),
    can(user.role, "timelines.view"),
    can(user.role, "projects.view"),
    can(user.role, "movement.record"),
    can(user.role, "users.manage"),
    can(user.role, "taxonomy.manage"),
    exportDatasetsFor(user.role),
    loadLayout(user.userId),
  ]);

  if (
    !showInventory &&
    !showReports &&
    !showCalendar &&
    !showStakeholders &&
    !showTimelines &&
    !showProjects &&
    !canManageUsers &&
    !canManageTaxonomy
  ) {
    redirect("/denied?permission=inventory.view");
  }

  const now = new Date();
  const todayKey = astDayKey(now);
  const tomorrowKey = addDaysToKey(todayKey, 1);
  const endWindowKey = addDaysToKey(todayKey, 13);
  const currentMonth = todayKey.slice(0, 7);
  const windowStart = new Date(`${todayKey}T00:00:00-04:00`);
  const windowEnd = new Date(`${endWindowKey}T23:59:59-04:00`);

  const canExport = exportDatasets.some((d) => d.allowed);
  const canExportStakeholders = exportDatasets.some(
    (d) => d.allowed && d.key === "stakeholders",
  );
  const needStats = showInventory || canManageUsers || canManageTaxonomy;
  const showInventoryReports = showInventory && showReports;
  const showVendorReports = showStakeholders && showReports;

  const [
    stats,
    condCounts,
    lowStock,
    recent,
    byCategory,
    trend,
    byLocation,
    stakeholders,
    stakeholderGroups,
    exportGroups,
    upcomingEvents,
    taskStatusCounts,
    taskAreas,
    myTasks,
    projects,
    vendorData,
  ] = await Promise.all([
    needStats ? dashboardStats() : Promise.resolve(null),
    showInventory
      ? conditionCounts()
      : Promise.resolve({} as Awaited<ReturnType<typeof conditionCounts>>),
    showInventory ? lowStockItems(5) : Promise.resolve([]),
    showInventory ? listMovements({ limit: 5 }) : Promise.resolve([]),
    showInventoryReports ? stockByCategory() : Promise.resolve([]),
    showInventoryReports ? movementTrend(90) : Promise.resolve([]),
    showInventoryReports ? stockByLocation() : Promise.resolve([]),
    showStakeholders ? stakeholderStats() : Promise.resolve(null),
    showStakeholders ? stakeholdersByGroup() : Promise.resolve([]),
    canExportStakeholders ? listStakeholderGroups() : Promise.resolve([]),
    showCalendar ? listCalendarEvents(windowStart, windowEnd) : Promise.resolve([]),
    showTimelines
      ? countTasksByStatus()
      : Promise.resolve({} as Awaited<ReturnType<typeof countTasksByStatus>>),
    showTimelines ? listTaskAreas() : Promise.resolve([]),
    showTimelines ? listStaffTasks({ ownerId: user.userId }) : Promise.resolve([]),
    showProjects ? listProjects() : Promise.resolve([]),
    showVendorReports ? listVendorsWithStats() : Promise.resolve(null),
  ]);

  const hasValuation = (stats?.totalValue ?? 0) > 0;
  const topValue = showInventoryReports
    ? await listItems({
        sort: hasValuation ? "value" : "units",
        excludeRetired: true,
        page: 1,
        perPage: 5,
      })
    : [];

  const retiredCount = (condCounts.DECOMMISSIONED ?? 0) + (condCounts.DISPOSED ?? 0);
  const activeItemsCount = stats ? Math.max(0, stats.totalItems - retiredCount) : 0;
  const healthyCount = stats
    ? Math.max(0, activeItemsCount - stats.lowStock - stats.outOfStock)
    : 0;
  const averageValue =
    stats && activeItemsCount > 0 ? stats.totalValue / activeItemsCount : 0;

  // Build 14-day AST calendar pulse dataset
  const calendarDays: CalendarPulseDay[] = [];
  const dayKeyIndex = new Map<string, CalendarPulseDay>();
  for (let i = 0; i < 14; i++) {
    const dk = addDaysToKey(todayKey, i);
    const { label, shortDay } = formatShortAstLabel(dk);
    const entry: CalendarPulseDay = {
      dayKey: dk,
      label,
      shortDay,
      isToday: dk === todayKey,
      counts: {
        MEETING: 0,
        MISSION: 0,
        LEAVE: 0,
        HOLIDAY: 0,
        DEADLINE: 0,
        OTHER: 0,
      },
      total: 0,
    };
    calendarDays.push(entry);
    dayKeyIndex.set(dk, entry);
  }

  const calendarFeed: CalendarPulseEvent[] = [];
  let todayEventCount = 0;
  for (const ev of upcomingEvents) {
    const sKey = astDayKey(ev.starts_at);
    const eKey = astDayKey(ev.ends_at);
    const effectiveEnd = eKey < sKey ? sKey : eKey;
    const typeKey = (
      ["MEETING", "MISSION", "LEAVE", "HOLIDAY", "DEADLINE", "OTHER"].includes(
        ev.event_type,
      )
        ? ev.event_type
        : "OTHER"
    ) as keyof CalendarPulseDay["counts"];

    if (sKey <= todayKey && effectiveEnd >= todayKey) {
      todayEventCount++;
    }

    for (const dayObj of calendarDays) {
      if (dayObj.dayKey >= sKey && dayObj.dayKey <= effectiveEnd) {
        dayObj.counts[typeKey] += 1;
        dayObj.total += 1;
      }
    }

    calendarFeed.push({
      id: ev.id,
      title: ev.title,
      eventType: typeKey,
      startDayKey: sKey,
      endDayKey: effectiveEnd,
      timeLabel: ev.all_day
        ? "All day"
        : `${formatAstClock(ev.starts_at)} – ${formatAstClock(ev.ends_at)}`,
      location: ev.location,
      monthKey: (sKey < todayKey ? todayKey : sKey).slice(0, 7),
    });
  }

  // Build vendor spend & renewals dataset
  const vendorGroups: VendorGroupSpendDatum[] = [];
  const vendorRenewals: VendorRenewalDatum[] = [];
  const vendorTotals = {
    paid: 0,
    pending: 0,
    quoted: 0,
    renewalsDue: 0,
    activeVendors: 0,
  };
  if (vendorData) {
    const bucketMap = new Map<string, VendorGroupSpendDatum>();
    for (const gk of VENDOR_GROUP_ORDER) {
      bucketMap.set(gk, {
        key: gk,
        label: VENDOR_GROUPS[gk].shortLabel,
        vendorCount: 0,
        paid: 0,
        pending: 0,
        quoted: 0,
      });
    }
    const soonKey = addDaysToKey(todayKey, 30);
    for (const v of vendorData.vendors) {
      if (v.status !== "INACTIVE") vendorTotals.activeVendors += 1;
      const gk = vendorGroupForCategory(v.category);
      const b = bucketMap.get(gk)!;
      b.vendorCount += 1;
      b.paid += v.total_spend_ttd;
      b.pending += v.pending_spend_ttd;
      b.quoted += v.quoted_ttd;
      vendorTotals.paid += v.total_spend_ttd;
      vendorTotals.pending += v.pending_spend_ttd;
      vendorTotals.quoted += v.quoted_ttd;

      const isDueSoon =
        v.contract_status === "RENEWAL_DUE" ||
        (v.next_due_date != null && v.next_due_date <= soonKey);
      if (v.status !== "INACTIVE" && isDueSoon) {
        vendorTotals.renewalsDue += 1;
        vendorRenewals.push({
          id: v.id,
          name: v.name,
          category: v.category,
          contractStatus: v.contract_status,
          nextDueDate: v.next_due_date,
        });
      }
    }
    vendorRenewals.sort((a, b) =>
      (a.nextDueDate ?? "9999-12-31").localeCompare(b.nextDueDate ?? "9999-12-31"),
    );
    for (const gk of VENDOR_GROUP_ORDER) {
      const b = bucketMap.get(gk)!;
      if (b.vendorCount > 0) vendorGroups.push(b);
    }
  }

  // Personal & operations summary figures
  const myOpenTasks = myTasks.filter((t) => t.status !== "COMPLETE").length;
  const totalTasks = Object.values(taskStatusCounts).reduce((s, n) => s + n, 0);
  const completedTasks = taskStatusCounts.COMPLETE ?? 0;
  const activeProjects = projects.filter((p) => !p.is_closed);
  const overdueProjectActions = activeProjects.reduce(
    (s, p) => s + p.overdue_actions,
    0,
  );

  const defaultExportDataset =
    exportDatasets.find((d) => d.allowed)?.key ?? "inventory";

  const hour =
    Number(
      new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        hour12: false,
        timeZone: APP_TIMEZONE,
      }).format(now),
    ) % 24;
  const greeting =
    hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const todayReadable = now.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: APP_TIMEZONE,
  });

  // Build balanced, high-signal KPI cards (max 4 cards, suppressing zero/empty clutter)
  type KpiDef = {
    key: string;
    label: string;
    value: string;
    hint: string;
    href: string;
    tone?: "default" | "good" | "positive" | "warn" | "danger";
    icon: React.ReactNode;
  };
  const kpiCards: KpiDef[] = [];

  if (showInventory && stats) {
    kpiCards.push({
      key: "items",
      label: "Items",
      value: formatNumber(stats.totalItems),
      hint: `${formatNumber(stats.totalUnits)} active units`,
      href: "/inventory",
      icon: <Boxes size={15} />,
    });
    if (showReports && hasValuation) {
      kpiCards.push({
        key: "value",
        label: "Stock value",
        value: formatCurrencyCompact(stats.totalValue),
        hint: `${formatCurrencyCompact(averageValue)} avg / item`,
        href: "/inventory?sort=value",
        tone: "positive",
        icon: <Coins size={15} />,
      });
    }
    const attentionCount = stats.lowStock + stats.outOfStock;
    if (attentionCount > 0) {
      kpiCards.push({
        key: "low",
        label: "Reorder alerts",
        value: formatNumber(attentionCount),
        hint:
          stats.outOfStock > 0
            ? `${formatNumber(stats.outOfStock)} out of stock`
            : `${formatNumber(stats.lowStock)} at or below min`,
        href: "/inventory?stock=attention",
        tone: stats.outOfStock > 0 ? "danger" : "warn",
        icon: <AlertTriangle size={15} />,
      });
    }
  }
  if (showCalendar && kpiCards.length < 4) {
    kpiCards.push({
      key: "calendar",
      label: "Next 14 days",
      value: formatNumber(calendarFeed.length),
      hint:
        todayEventCount > 0
          ? `${formatNumber(todayEventCount)} happening today`
          : "Upcoming delegation events",
      href: `/calendar?month=${currentMonth}`,
      tone: todayEventCount > 0 ? "good" : "default",
      icon: <CalendarDays size={15} />,
    });
  }
  if (showTimelines && kpiCards.length < 4) {
    kpiCards.push({
      key: "timelines",
      label: myTasks.length > 0 ? "My open tasks" : "Staff tasks",
      value: formatNumber(myTasks.length > 0 ? myOpenTasks : totalTasks),
      hint: `${completedTasks}/${totalTasks} team tasks complete`,
      href: myTasks.length > 0 ? "/timelines?mine=1" : "/timelines",
      tone: myOpenTasks > 0 ? "good" : "default",
      icon: <ListChecks size={15} />,
    });
  }
  if (showProjects && projects.length > 0 && kpiCards.length < 4) {
    kpiCards.push({
      key: "projects",
      label: "Active projects",
      value: formatNumber(activeProjects.length),
      hint:
        overdueProjectActions > 0
          ? `${formatNumber(overdueProjectActions)} overdue actions`
          : `${formatNumber(projects.length)} total tracked`,
      href: "/projects",
      tone: overdueProjectActions > 0 ? "warn" : "good",
      icon: <FolderKanban size={15} />,
    });
  }
  if (showStakeholders && stakeholders && kpiCards.length < 4) {
    kpiCards.push({
      key: "stakeholders",
      label: "Stakeholders",
      value: formatNumber(stakeholders.total),
      hint: `${formatNumber(stakeholders.groups)} directory groups`,
      href: "/stakeholders",
      icon: <Users2 size={15} />,
    });
  }
  if (showInventory && stats && kpiCards.length < 4) {
    kpiCards.push({
      key: "movements",
      label: "Movements (7d)",
      value: formatNumber(stats.movementsThisWeek),
      hint: "Last 7 days of activity",
      href: "/movements",
      icon: <ArrowLeftRight size={15} />,
    });
  }

  const statGridCols =
    kpiCards.length >= 4
      ? "lg:grid-cols-4"
      : kpiCards.length === 3
        ? "lg:grid-cols-3"
        : kpiCards.length === 2
          ? "lg:grid-cols-2"
          : "lg:grid-cols-1";

  return (
    <div className="mx-auto max-w-[1360px]">
      <PageHeader
        eyebrow={`${greeting}, ${user.name.split(" ")[0]} · ${todayReadable} (AST)`}
        title="Dashboard"
        description="Operational pulse across stock, schedule, timelines and directory."
        actions={
          <>
            {canExport && (
              <ExportDialog
                datasets={exportDatasets}
                groups={exportGroups.map((g) => ({
                  id: g.id,
                  name: g.name,
                  count: g.item_count,
                }))}
                defaultDataset={defaultExportDataset}
                title="Export data"
                description="Choose which tables to export and pick a format."
              />
            )}
            {canRecord && (
              <Link href="/movements" className="btn btn-primary">
                <ArrowLeftRight size={15} /> Record movement
              </Link>
            )}
          </>
        }
      />

      <DashboardGrid
        initialLayout={layout}
        panels={{
          stats:
            kpiCards.length > 0 ? (
              <div className={`grid grid-cols-2 gap-3 ${statGridCols}`}>
                {kpiCards.map((c) => (
                  <StatCard
                    key={c.key}
                    label={c.label}
                    value={c.value}
                    hint={c.hint}
                    href={c.href}
                    tone={c.tone}
                    icon={c.icon}
                  />
                ))}
              </div>
            ) : undefined,
          chart: showInventoryReports && stats ? (
            <SectionCard
              title="Movement volume"
              description={`${formatNumber(stats.movementsThisWeek)} movements in the last 7 days · switch range or mode`}
              action={
                <Link href="/movements" className="text-xs text-iica-700 hover:underline">
                  View ledger
                </Link>
              }
              bodyClassName="px-4 py-3.5"
            >
              <TrendChart data={trend} />
            </SectionCard>
          ) : undefined,
          category: showInventoryReports ? (
            <SectionCard
              title={hasValuation ? "Value by category" : "Stock by category"}
              description={
                hasValuation
                  ? "Share of active stock value"
                  : "Active units across categories"
              }
              action={
                <Link href="/inventory" className="text-xs text-iica-700 hover:underline">
                  View inventory
                </Link>
              }
              bodyClassName="px-4 py-3.5"
            >
              <D3CategoryChart data={byCategory} />
            </SectionCard>
          ) : undefined,
          agenda: showCalendar ? (
            <SectionCard
              title="Upcoming schedule"
              description="Next 14 days (AST) · click any bar to focus a day"
              action={
                <Link
                  href={`/calendar?month=${currentMonth}`}
                  className="text-xs text-iica-700 hover:underline"
                >
                  Open calendar
                </Link>
              }
              bodyClassName="px-4 py-3.5"
            >
              <D3CalendarPulseChart
                days={calendarDays}
                events={calendarFeed}
                todayKey={todayKey}
                tomorrowKey={tomorrowKey}
              />
            </SectionCard>
          ) : undefined,
          operations:
            showTimelines || showProjects ? (
              <SectionCard
                title={
                  showTimelines && showProjects && projects.length > 0
                    ? "Timelines & projects"
                    : showTimelines
                      ? "Staff timelines"
                      : "Projects"
                }
                description={
                  showTimelines && showProjects && projects.length > 0
                    ? "Staff task completion and project pipeline"
                    : showTimelines
                      ? "Staff task completion and workload by area"
                      : "Project pipeline and open actions"
                }
                action={
                  showTimelines && showProjects && projects.length > 0 ? undefined : showTimelines ? (
                    <Link href="/timelines" className="text-xs text-iica-700 hover:underline">
                      Open timelines
                    </Link>
                  ) : (
                    <Link href="/projects" className="text-xs text-iica-700 hover:underline">
                      Open projects
                    </Link>
                  )
                }
                bodyClassName="px-4 py-3.5"
              >
                <D3OperationsChart
                  showTimelines={showTimelines}
                  showProjects={showProjects}
                  taskStatusCounts={taskStatusCounts}
                  taskAreas={taskAreas}
                  projects={projects}
                />
              </SectionCard>
            ) : undefined,
          health: showInventory && stats ? (
            <SectionCard
              title="Catalogue health"
              description="Condition breakdown and reorder coverage"
              action={
                <Link href="/inventory" className="text-xs text-iica-700 hover:underline">
                  Browse
                </Link>
              }
              bodyClassName="px-4 py-3.5"
            >
              <D3ConditionHealthChart
                conditions={condCounts}
                stockSummary={{
                  totalItems: stats.totalItems,
                  healthy: healthyCount,
                  low: stats.lowStock,
                  out: stats.outOfStock,
                  retired: retiredCount,
                }}
              />
            </SectionCard>
          ) : undefined,
          vendors:
            showVendorReports && vendorTotals.activeVendors > 0 ? (
              <SectionCard
                title={
                  vendorTotals.paid + vendorTotals.pending + vendorTotals.quoted > 0
                    ? "Vendor spend & renewals"
                    : "Vendors & renewals"
                }
                description={
                  vendorTotals.paid + vendorTotals.pending + vendorTotals.quoted > 0
                    ? "Paid, pending & quoted commitments (TTD)"
                    : "Active suppliers by group and contract renewals"
                }
                action={
                  <Link href="/vendors" className="text-xs text-iica-700 hover:underline">
                    View vendors
                  </Link>
                }
                bodyClassName="px-4 py-3.5"
              >
                <D3VendorSpendChart
                  groups={vendorGroups}
                  renewals={vendorRenewals}
                  totals={vendorTotals}
                />
              </SectionCard>
            ) : undefined,
          attention: showInventory ? (
            <SectionCard
              title="Needs attention"
              description="Items at or below minimum stock"
              action={
                <Link href="/inventory?stock=attention" className="text-xs text-iica-700 hover:underline">
                  View all
                </Link>
              }
              bodyClassName="divide-y divide-ink/5"
            >
              {lowStock.length === 0 ? (
                <div className="flex items-center gap-3 px-4 py-5 text-sm text-ink/70">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                    <CheckCircle2 size={16} />
                  </span>
                  <div className="min-w-0">
                    <div className="font-medium text-ink/85">All stock above minimum</div>
                    <div className="text-xs text-ink/65">No reordering needed right now.</div>
                  </div>
                </div>
              ) : (
                lowStock.map((item) => (
                  <Link
                    key={item.id}
                    href={`/inventory/${item.id}`}
                    className="flex items-center gap-3 px-4 py-2 transition hover:bg-iica-50/60"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-ink">{item.name}</div>
                      <div className="truncate text-xs text-ink/60">
                        <Sku sku={item.sku} /> · {item.location_name ?? "Unassigned"}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div
                        className={`text-sm font-semibold tabular-nums ${
                          item.quantity <= 0 ? "text-rose-600" : "text-gold-700"
                        }`}
                      >
                        {formatUnits(item.quantity, item.unit)}
                      </div>
                      <div className="text-xs text-ink/60">min {formatNumber(item.min_quantity)}</div>
                    </div>
                  </Link>
                ))
              )}
            </SectionCard>
          ) : undefined,
          directory: showStakeholders ? (
            <SectionCard
              title="Directory by group"
              description="Interactive contact distribution"
              action={
                <Link href="/stakeholders" className="text-xs text-iica-700 hover:underline">
                  View all
                </Link>
              }
              bodyClassName="px-4 py-3.5"
            >
              <D3StakeholderChart data={stakeholderGroups} />
            </SectionCard>
          ) : undefined,
          location: showInventoryReports ? (
            <SectionCard
              title={hasValuation ? "Value by location" : "Stock by location"}
              description={
                hasValuation
                  ? "Active valuation held at each site"
                  : "Active units held at each site"
              }
              action={
                <Link href="/inventory" className="text-xs text-iica-700 hover:underline">
                  View inventory
                </Link>
              }
              bodyClassName="px-4 py-3.5"
            >
              <D3LocationChart data={byLocation} />
            </SectionCard>
          ) : undefined,
          movements: showInventory ? (
            <SectionCard
              title="Latest movements"
              description="Most recent stock changes"
              className="flex h-full flex-col"
              action={
                <Link href="/movements" className="text-xs text-iica-700 hover:underline">
                  View all
                </Link>
              }
              bodyClassName="flex-1 divide-y divide-ink/5"
            >
              {recent.length === 0 ? (
                <EmptyState
                  icon={<ArrowLeftRight size={18} />}
                  title="No movements recorded"
                  description="Stock receipts and issues will appear here."
                />
              ) : (
                recent.map((m) => (
                  <Link
                    key={m.id}
                    href={`/inventory/${m.item_id}`}
                    className="flex items-center gap-3 px-4 py-2 transition hover:bg-iica-50/60"
                  >
                    <MovementTypeBadge type={m.type} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-ink">{m.item_name}</div>
                      <div className="truncate text-xs text-ink/60">
                        {m.user_name ?? "Removed user"} · {relativeTime(m.created_at)}
                      </div>
                    </div>
                    <div
                      className={`shrink-0 text-sm font-semibold tabular-nums ${
                        m.type === "OUT" || m.quantity < 0
                          ? "text-gold-700"
                          : m.quantity === 0
                            ? "text-ink/65"
                            : "text-iica-700"
                      }`}
                    >
                      {m.type === "OUT"
                        ? `−${formatNumber(Math.abs(m.quantity))}`
                        : m.type === "IN"
                          ? `+${formatNumber(Math.abs(m.quantity))}`
                          : m.quantity === 0
                            ? "0"
                            : `${m.quantity > 0 ? "+" : "−"}${formatNumber(Math.abs(m.quantity))}`}
                    </div>
                  </Link>
                ))
              )}
            </SectionCard>
          ) : undefined,
          topValue: showInventoryReports ? (
            <SectionCard
              title={hasValuation ? "Highest-value items" : "Top stocked items"}
              description={
                hasValuation
                  ? "Top 5 items by total inventory value"
                  : "Top 5 active items by quantity on hand"
              }
              action={
                <Link
                  href={hasValuation ? "/inventory?sort=value" : "/inventory"}
                  className="text-xs text-iica-700 hover:underline"
                >
                  View catalogue
                </Link>
              }
              bodyClassName="divide-y divide-ink/5"
            >
              {topValue.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-ink/60">No items yet.</div>
              ) : (
                topValue.map((item) => (
                  <Link
                    key={item.id}
                    href={`/inventory/${item.id}`}
                    className="flex items-center gap-3 px-4 py-2 transition hover:bg-iica-50/60"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-ink">{item.name}</div>
                      <div className="truncate text-xs text-ink/60">
                        <Sku sku={item.sku} /> · {item.location_name ?? item.category_name ?? "Unassigned"}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      {hasValuation ? (
                        <>
                          <div className="text-sm font-semibold tabular-nums text-iica-700">
                            {formatCurrency(item.quantity * item.unit_cost)}
                          </div>
                          <div className="text-xs tabular-nums text-ink/60">
                            {formatUnits(item.quantity, item.unit)}
                          </div>
                        </>
                      ) : (
                        <div className="text-sm font-semibold tabular-nums text-iica-700">
                          {formatUnits(item.quantity, item.unit)}
                        </div>
                      )}
                    </div>
                  </Link>
                ))
              )}
            </SectionCard>
          ) : undefined,
          admin:
            (canManageUsers || canManageTaxonomy) && stats ? (
              <div className="panel flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-xs">
                <span className="font-semibold uppercase tracking-wider text-ink/65">
                  Administration
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  {canManageUsers && (
                    <Link
                      href="/users"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-ink/10 bg-iica-50/50 px-2.5 py-1 font-medium text-ink/80 transition hover:border-iica-300 hover:bg-iica-50"
                    >
                      <Users size={13} className="text-iica-700" />
                      <span>Active users</span>
                      <strong className="tabular-nums text-ink">
                        {formatNumber(stats.activeUsers)}
                      </strong>
                    </Link>
                  )}
                  {canManageTaxonomy && (
                    <>
                      <Link
                        href="/taxonomy"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-ink/10 bg-iica-50/50 px-2.5 py-1 font-medium text-ink/80 transition hover:border-iica-300 hover:bg-iica-50"
                      >
                        <Tags size={13} className="text-iica-700" />
                        <span>Categories</span>
                        <strong className="tabular-nums text-ink">
                          {formatNumber(stats.categories)}
                        </strong>
                      </Link>
                      <Link
                        href="/taxonomy?view=locations"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-ink/10 bg-iica-50/50 px-2.5 py-1 font-medium text-ink/80 transition hover:border-iica-300 hover:bg-iica-50"
                      >
                        <MapPin size={13} className="text-iica-700" />
                        <span>Locations</span>
                        <strong className="tabular-nums text-ink">
                          {formatNumber(stats.locations)}
                        </strong>
                      </Link>
                    </>
                  )}
                </div>
              </div>
            ) : undefined,
        }}
      />
    </div>
  );
}
