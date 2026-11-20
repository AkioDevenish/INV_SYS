"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as d3 from "d3";
import { CONDITION_META, CONDITIONS, isCondition, type Condition } from "@/lib/conditions";
import { formatCurrencyCompact, formatNumber } from "@/lib/format";
import { formatTtd } from "@/lib/vendor-groups";

function onActivateKey(e: KeyboardEvent, action: () => void) {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    action();
  }
}

const CHART_PALETTE: readonly string[] = [
  "#14477d", // iica-700
  "#2f6bac", // iica-500
  "#d9a520", // gold-400
  "#059669", // emerald-600
  "#5b8fc7", // iica-400
  "#0284c7", // sky-600
  "#95b8de", // iica-300
];

/** Tracks container width responsively without causing hydration mismatches. */
export function useChartWidth(fallback = 420) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = Math.floor(el.getBoundingClientRect().width);
      if (w > 40) setWidth(w);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { ref, width };
}

/** Shared mode pill toggle used across dashboard D3 cards. */
export function ChartModeToggle<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { key: T; label: string }[];
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex rounded-lg border border-ink/10 bg-iica-50/80 p-0.5"
    >
      {options.map((opt) => {
        const active = opt.key === value;
        return (
          <button
            key={opt.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.key)}
            className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition motion-reduce:transition-none ${
              active
                ? "bg-white text-iica-800 shadow-xs"
                : "text-ink/65 hover:text-ink"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/** Shared ranked D3 horizontal bar chart with hover tooltips & optional drill-down links. */
type RankedDatum = {
  key: string;
  label: string;
  value: number;
  caption: string;
  sublabel?: string;
  href?: string;
  color?: string;
};

function D3RankedBars({
  items,
  formatValue,
  emptyTitle,
  ariaLabel,
  maxRows = 5,
}: {
  items: RankedDatum[];
  formatValue: (v: number) => string;
  emptyTitle: string;
  ariaLabel: string;
  maxRows?: number;
}) {
  const router = useRouter();
  const { ref, width } = useChartWidth(360);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const gradId = useId().replace(/:/g, "");

  const total = useMemo(
    () => items.reduce((sum, item) => sum + Math.max(0, item.value), 0),
    [items],
  );

  const visible = useMemo(() => items.slice(0, maxRows), [items, maxRows]);
  const maxVal = useMemo(
    () => Math.max(1, ...visible.map((d) => Math.max(0, d.value))),
    [visible],
  );

  if (items.length === 0) {
    return (
      <div className="flex h-[150px] items-center justify-center text-sm text-ink/60">
        {emptyTitle}
      </div>
    );
  }

  const rowHeight = 30;
  const padTop = 2;
  const padBottom = 2;
  const height = padTop + padBottom + visible.length * rowHeight;
  const leftWidth = Math.min(132, Math.max(92, Math.floor(width * 0.36)));
  const rightWidth = 68;
  const barAreaWidth = Math.max(60, width - leftWidth - rightWidth - 8);

  const xScale = d3.scaleLinear().domain([0, maxVal]).range([0, barAreaWidth]);
  const hovered = visible.find((d) => d.key === hoveredKey);

  return (
    <div ref={ref} className="relative select-none">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="block w-full overflow-visible"
        role="img"
        aria-label={ariaLabel}
      >
        <defs>
          <linearGradient id={`${gradId}-bar`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#14477d" />
            <stop offset="100%" stopColor="#2f6bac" />
          </linearGradient>
        </defs>

        {visible.map((item, idx) => {
          const y = padTop + idx * rowHeight;
          const val = Math.max(0, item.value);
          const barW = val > 0 ? Math.max(4, xScale(val)) : 0;
          const isHovered = hoveredKey === item.key;
          const dim = hoveredKey !== null && !isHovered;

          const pct = total > 0 ? Math.round((val / total) * 100) : 0;
          return (
            <g
              key={item.key}
              transform={`translate(0, ${y})`}
              tabIndex={0}
              role={item.href ? "link" : "button"}
              aria-label={`${item.label}: ${formatValue(val)}${total > 0 ? ` (${pct}%)` : ""}${item.href ? " — open filtered view" : ""}`}
              className={`transition-opacity duration-200 focus:outline-none focus-visible:outline-2 focus-visible:outline-iica-700 motion-reduce:transition-none ${
                item.href ? "cursor-pointer" : "cursor-default"
              }`}
              style={{ opacity: dim ? 0.45 : 1 }}
              onMouseEnter={() => setHoveredKey(item.key)}
              onMouseLeave={() => setHoveredKey((cur) => (cur === item.key ? null : cur))}
              onFocus={() => setHoveredKey(item.key)}
              onBlur={() => setHoveredKey((cur) => (cur === item.key ? null : cur))}
              onClick={() => {
                if (item.href) router.push(item.href);
              }}
              onKeyDown={(e) => {
                if (item.href) onActivateKey(e, () => router.push(item.href!));
              }}
            >
              <rect
                x={0}
                y={0}
                width={width}
                height={rowHeight - 2}
                rx={8}
                fill={isHovered ? "rgba(225, 236, 247, 0.55)" : "transparent"}
              />
              <text
                x={6}
                y={item.sublabel ? 12 : 15}
                className="fill-ink text-[11.5px] font-medium"
                dominantBaseline="middle"
              >
                {item.label.length > 18 ? `${item.label.slice(0, 17)}…` : item.label}
              </text>
              {item.sublabel && (
                <text
                  x={6}
                  y={23}
                  className="fill-ink/65 text-[9.5px]"
                  dominantBaseline="middle"
                >
                  {item.sublabel}
                </text>
              )}

              {/* Background track */}
              <rect
                x={leftWidth}
                y={9}
                width={barAreaWidth}
                height={9}
                rx={4.5}
                fill="rgba(22, 36, 58, 0.06)"
              />
              {/* D3 scaled value bar */}
              <rect
                x={leftWidth}
                y={9}
                width={barW}
                height={9}
                rx={4.5}
                fill={item.color ?? `url(#${gradId}-bar)`}
                className="transition-all duration-300 ease-out motion-reduce:transition-none"
              />

              <text
                x={width - 6}
                y={14}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-ink text-[11.5px] font-semibold tabular-nums"
              >
                {formatValue(val)}
              </text>
            </g>
          );
        })}
      </svg>

      {hovered && (
        <div className="mt-2 flex items-center justify-between rounded-lg bg-iica-50/90 px-3 py-1.5 text-xs text-ink/80">
          <span className="truncate font-medium text-ink">{hovered.label}</span>
          <span className="ml-2 shrink-0 tabular-nums text-ink/70">
            {hovered.caption}
            {total > 0 ? ` · ${Math.round((Math.max(0, hovered.value) / total) * 100)}%` : ""}
          </span>
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------- Category Donut / Bar */

export type CategoryDatum = {
  id?: number | null;
  name: string;
  items: number;
  units: number;
  value: number;
};

export function D3CategoryChart({ data }: { data: CategoryDatum[] }) {
  const router = useRouter();
  const hasValue = useMemo(() => data.some((d) => d.value > 0), [data]);
  const [mode, setMode] = useState<"donut" | "bars">("donut");
  const [metric, setMetric] = useState<"value" | "units">(hasValue ? "value" : "units");
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  const activeMetric = hasValue ? metric : "units";

  const slices = useMemo(() => {
    const sorted = [...data].sort((a, b) =>
      activeMetric === "value"
        ? b.value - a.value || b.units - a.units
        : b.units - a.units || b.items - a.items,
    );
    const positive = sorted.filter((d) =>
      activeMetric === "value" ? d.value > 0 : d.units > 0 || d.items > 0,
    );
    const source = positive.length > 0 ? positive : sorted;
    const top = source.slice(0, 5);
    const rest = source.slice(5);
    const merged = top.map((d, idx) => ({
      key: d.id != null ? String(d.id) : `none-${d.name}`,
      id: d.id ?? null,
      name: d.name,
      metricVal: Math.max(
        0,
        activeMetric === "value" ? d.value : d.units > 0 ? d.units : d.items,
      ),
      value: Math.max(0, d.value),
      items: d.items,
      units: d.units,
      color: CHART_PALETTE[idx % CHART_PALETTE.length],
      href: d.id != null ? `/inventory?category=${d.id}` : "/inventory",
    }));

    if (rest.length > 0) {
      const restVal = rest.reduce((s, r) => s + Math.max(0, r.value), 0);
      const restUnits = rest.reduce((s, r) => s + r.units, 0);
      const restItems = rest.reduce((s, r) => s + r.items, 0);
      merged.push({
        key: "other-rollup",
        id: null,
        name: `Other (${rest.length})`,
        metricVal: activeMetric === "value" ? restVal : restUnits > 0 ? restUnits : restItems,
        value: restVal,
        items: restItems,
        units: restUnits,
        color: "#cbd5e1",
        href: "/inventory",
      });
    }
    return merged;
  }, [data, activeMetric]);

  const totalMetric = useMemo(
    () => slices.reduce((s, d) => s + d.metricVal, 0),
    [slices],
  );

  const arcs = useMemo(() => {
    const pie = d3
      .pie<(typeof slices)[number]>()
      .value((d) => (totalMetric > 0 ? d.metricVal : 1))
      .sort(null)
      .padAngle(0.024);
    return pie(slices);
  }, [slices, totalMetric]);

  const size = 152;
  const outerR = 68;
  const innerR = 44;
  const arcGen = useMemo(
    () =>
      d3
        .arc<d3.PieArcDatum<(typeof slices)[number]>>()
        .innerRadius(innerR)
        .outerRadius(outerR)
        .cornerRadius(4),
    [],
  );
  const hoverArcGen = useMemo(
    () =>
      d3
        .arc<d3.PieArcDatum<(typeof slices)[number]>>()
        .innerRadius(innerR - 2)
        .outerRadius(outerR + 5)
        .cornerRadius(4),
    [],
  );

  if (data.length === 0) {
    return (
      <div className="flex h-[165px] items-center justify-center text-sm text-ink/60">
        No categories yet.
      </div>
    );
  }

  const activeSlice = slices.find((s) => s.key === hoveredKey);
  const formatMetric = (n: number) =>
    activeMetric === "value" ? formatCurrencyCompact(n) : formatNumber(n);

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-ink/65">
          {data.length} {data.length === 1 ? "category" : "categories"}
        </span>
        <div className="flex items-center gap-1.5">
          {hasValue && (
            <ChartModeToggle
              value={activeMetric}
              onChange={setMetric}
              label="Category metric"
              options={[
                { key: "value", label: "Value" },
                { key: "units", label: "Units" },
              ]}
            />
          )}
          <ChartModeToggle
            value={mode}
            onChange={setMode}
            label="Category chart view"
            options={[
              { key: "donut", label: "Donut" },
              { key: "bars", label: "Bars" },
            ]}
          />
        </div>
      </div>

      {mode === "bars" ? (
        <D3RankedBars
          maxRows={6}
          emptyTitle="No categories yet."
          ariaLabel="Inventory breakdown by category bar chart"
          formatValue={formatMetric}
          items={slices.map((s) => ({
            key: s.key,
            label: s.name,
            sublabel: `${formatNumber(s.items)} items`,
            value: s.metricVal,
            caption:
              activeMetric === "value"
                ? `${formatCurrencyCompact(s.value)} · ${formatNumber(s.units)} units`
                : `${formatNumber(s.units)} units · ${formatNumber(s.items)} items`,
            href: s.href,
            color: s.color,
          }))}
        />
      ) : (
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center">
          <div className="relative shrink-0">
            <svg
              width={size}
              height={size}
              viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`}
              role="img"
              aria-label={`Category breakdown donut totaling ${formatMetric(totalMetric)}`}
            >
              {arcs.map((arc) => {
                const isActive = hoveredKey === arc.data.key;
                const d = (isActive ? hoverArcGen(arc) : arcGen(arc)) ?? undefined;
                const dim = hoveredKey !== null && !isActive;
                const pct =
                  totalMetric > 0 ? Math.round((arc.data.metricVal / totalMetric) * 100) : 0;
                return (
                  <path
                    key={arc.data.key}
                    d={d}
                    fill={arc.data.color}
                    tabIndex={0}
                    role="link"
                    aria-label={`${arc.data.name}: ${formatMetric(arc.data.metricVal)} (${pct}%)`}
                    className="cursor-pointer transition-all duration-200 ease-out focus:outline-none focus-visible:stroke-iica-900 focus-visible:stroke-2 motion-reduce:transition-none"
                    style={{ opacity: dim ? 0.42 : 1 }}
                    onMouseEnter={() => setHoveredKey(arc.data.key)}
                    onMouseLeave={() =>
                      setHoveredKey((cur) => (cur === arc.data.key ? null : cur))
                    }
                    onFocus={() => setHoveredKey(arc.data.key)}
                    onBlur={() =>
                      setHoveredKey((cur) => (cur === arc.data.key ? null : cur))
                    }
                    onClick={() => router.push(arc.data.href)}
                    onKeyDown={(e) => onActivateKey(e, () => router.push(arc.data.href))}
                  />
                );
              })}
            </svg>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-4 text-center">
              <span className="max-w-[78px] truncate text-[9.5px] font-medium uppercase tracking-wider text-ink/65">
                {activeSlice
                  ? activeSlice.name
                  : activeMetric === "value"
                    ? "Total value"
                    : "Total units"}
              </span>
              <span className="mt-0.5 text-sm font-semibold tabular-nums text-ink">
                {formatMetric(activeSlice ? activeSlice.metricVal : totalMetric)}
              </span>
              <span className="text-[10.5px] tabular-nums text-ink/65">
                {activeSlice && totalMetric > 0
                  ? `${Math.round((activeSlice.metricVal / totalMetric) * 100)}%`
                  : `${formatNumber(data.reduce((s, d) => s + d.items, 0))} items`}
              </span>
            </div>
          </div>

          <ul className="w-full min-w-0 flex-1 space-y-1">
            {slices.map((s) => {
              const isActive = hoveredKey === s.key;
              const pct = totalMetric > 0 ? Math.round((s.metricVal / totalMetric) * 100) : 0;
              return (
                <li key={s.key}>
                  <Link
                    href={s.href}
                    onMouseEnter={() => setHoveredKey(s.key)}
                    onMouseLeave={() => setHoveredKey((cur) => (cur === s.key ? null : cur))}
                    className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-xs transition ${
                      isActive ? "bg-iica-50" : "hover:bg-iica-50/60"
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: s.color }}
                        aria-hidden="true"
                      />
                      <span className="truncate font-medium text-ink/85">{s.name}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-ink/70">
                      {formatMetric(s.metricVal)}{" "}
                      <span className="text-ink/65">({pct}%)</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------- Location Chart */

export function D3LocationChart({ data }: { data: CategoryDatum[] }) {
  const hasValue = useMemo(() => data.some((d) => d.value > 0), [data]);
  const [metric, setMetric] = useState<"value" | "units">(hasValue ? "value" : "units");
  const activeMetric = hasValue ? metric : "units";

  const items = useMemo<RankedDatum[]>(() => {
    const sorted = [...data].sort((a, b) =>
      activeMetric === "value"
        ? b.value - a.value || b.units - a.units
        : b.units - a.units || b.items - a.items,
    );
    const positive = sorted.filter((d) =>
      activeMetric === "value" ? d.value > 0 : d.units > 0 || d.items > 0,
    );
    const source = positive.length > 0 ? positive : sorted;
    const top = source.slice(0, 5);
    const rest = source.slice(5);

    const mapped: RankedDatum[] = top.map((d, idx) => ({
      key: d.id != null ? String(d.id) : `loc-${d.name}`,
      label: d.name,
      sublabel: `${formatNumber(d.items)} items`,
      value: activeMetric === "value" ? d.value : d.units > 0 ? d.units : d.items,
      caption:
        activeMetric === "value"
          ? `${formatCurrencyCompact(d.value)} · ${formatNumber(d.units)} units`
          : `${formatNumber(d.units)} units · ${formatNumber(d.items)} items`,
      href: d.id != null ? `/inventory?location=${d.id}` : "/inventory?locationGroup=all",
      color: CHART_PALETTE[idx % CHART_PALETTE.length],
    }));

    if (rest.length > 0) {
      const restVal = rest.reduce((s, r) => s + Math.max(0, r.value), 0);
      const restUnits = rest.reduce((s, r) => s + r.units, 0);
      const restItems = rest.reduce((s, r) => s + r.items, 0);
      mapped.push({
        key: "other-locations",
        label: `Other (${rest.length})`,
        sublabel: `${formatNumber(restItems)} items`,
        value: activeMetric === "value" ? restVal : restUnits > 0 ? restUnits : restItems,
        caption:
          activeMetric === "value"
            ? `${formatCurrencyCompact(restVal)} · ${formatNumber(restUnits)} units`
            : `${formatNumber(restUnits)} units · ${formatNumber(restItems)} items`,
        href: "/inventory?locationGroup=all",
        color: "#cbd5e1",
      });
    }

    return mapped;
  }, [data, activeMetric]);

  if (data.length === 0) {
    return (
      <div className="flex h-[150px] items-center justify-center text-sm text-ink/65">
        No location stock yet.
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-ink/65">
          {data.length} {data.length === 1 ? "location" : "locations"}
        </span>
        {hasValue && (
          <ChartModeToggle
            value={activeMetric}
            onChange={setMetric}
            label="Location metric"
            options={[
              { key: "value", label: "Value" },
              { key: "units", label: "Units" },
            ]}
          />
        )}
      </div>

      <D3RankedBars
        maxRows={6}
        items={items}
        formatValue={activeMetric === "value" ? formatCurrencyCompact : formatNumber}
        emptyTitle="No location stock yet."
        ariaLabel={
          activeMetric === "value"
            ? "Inventory value by location chart"
            : "Inventory units by location chart"
        }
      />
    </div>
  );
}

/* ----------------------------------------------------- Stakeholder Treemap */

type GroupDatum = { id?: number | null; name: string; count: number };

export function D3StakeholderChart({ data }: { data: GroupDatum[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<"treemap" | "bars">("treemap");
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const { ref, width } = useChartWidth(340);

  const items = useMemo(
    () =>
      data.filter((g) => g.count > 0).map((g, idx) => ({
        key: g.id != null ? String(g.id) : "ungrouped",
        id: g.id ?? null,
        name: g.name,
        count: g.count,
        color: CHART_PALETTE[idx % CHART_PALETTE.length],
        href:
          g.id != null
            ? `/stakeholders?group=${g.id}`
            : "/stakeholders?group=ungrouped",
      })),
    [data],
  );

  const total = useMemo(() => items.reduce((s, i) => s + i.count, 0), [items]);

  const height = 154;
  const leaves = useMemo(() => {
    if (items.length === 0 || width <= 0) return [];
    const root = d3
      .hierarchy<{ children?: typeof items; name?: string; count?: number }>({
        children: items,
      })
      .sum((d) => ("count" in d && typeof d.count === "number" ? d.count : 0))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

    return d3
      .treemap<{ children?: typeof items; name?: string; count?: number }>()
      .size([width, height])
      .paddingInner(4)
      .round(true)(root)
      .leaves();
  }, [items, width]);

  if (items.length === 0) {
    return (
      <div className="flex h-[154px] items-center justify-center text-sm text-ink/60">
        No stakeholders yet.
      </div>
    );
  }

  const hovered = items.find((i) => i.key === hoveredKey);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-ink/60">
          {formatNumber(total)} contacts across {items.length}{" "}
          {items.length === 1 ? "group" : "groups"}
        </span>
        <ChartModeToggle
          value={mode}
          onChange={setMode}
          label="Directory chart view"
          options={[
            { key: "treemap", label: "Treemap" },
            { key: "bars", label: "Bars" },
          ]}
        />
      </div>

      {mode === "bars" ? (
        <D3RankedBars
          emptyTitle="No stakeholders yet."
          ariaLabel="Stakeholders by group bar chart"
          formatValue={formatNumber}
          items={items.map((i) => ({
            key: i.key,
            label: i.name,
            value: i.count,
            caption: `${formatNumber(i.count)} contacts`,
            href: i.href,
            color: i.color,
          }))}
        />
      ) : (
        <div ref={ref} className="select-none">
          <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            className="block w-full"
            role="img"
            aria-label={`Stakeholder directory treemap of ${formatNumber(total)} contacts`}
          >
            {leaves.map((leaf) => {
              const datum = leaf.data as unknown as (typeof items)[number];
              const w = Math.max(0, leaf.x1 - leaf.x0);
              const h = Math.max(0, leaf.y1 - leaf.y0);
              const isActive = hoveredKey === datum.key;
              const dim = hoveredKey !== null && !isActive;
              const showTitle = w >= 66 && h >= 38;
              const showCount = w >= 48 && h >= 26;

              const pct = total > 0 ? Math.round((datum.count / total) * 100) : 0;

              return (
                <g
                  key={datum.key}
                  transform={`translate(${leaf.x0}, ${leaf.y0})`}
                  tabIndex={0}
                  role="link"
                  aria-label={`${datum.name}: ${formatNumber(datum.count)} contacts (${pct}%)`}
                  className="cursor-pointer transition-opacity duration-200 focus:outline-none focus-visible:outline-2 focus-visible:outline-iica-900 motion-reduce:transition-none"
                  style={{ opacity: dim ? 0.5 : 1 }}
                  onMouseEnter={() => setHoveredKey(datum.key)}
                  onMouseLeave={() =>
                    setHoveredKey((cur) => (cur === datum.key ? null : cur))
                  }
                  onFocus={() => setHoveredKey(datum.key)}
                  onBlur={() =>
                    setHoveredKey((cur) => (cur === datum.key ? null : cur))
                  }
                  onClick={() => router.push(datum.href)}
                  onKeyDown={(e) => onActivateKey(e, () => router.push(datum.href))}
                >
                  <rect
                    width={w}
                    height={h}
                    rx={8}
                    fill={datum.color}
                    stroke={isActive ? "#0b2848" : "rgba(255,255,255,0.45)"}
                    strokeWidth={isActive ? 2 : 1}
                  />
                  {showTitle && (
                    <text
                      x={8}
                      y={18}
                      className="fill-white text-[11px] font-semibold"
                    >
                      {datum.name.length > Math.floor(w / 7.2)
                        ? `${datum.name.slice(0, Math.max(4, Math.floor(w / 7.2) - 1))}…`
                        : datum.name}
                    </text>
                  )}
                  {showCount && (
                    <text
                      x={8}
                      y={showTitle ? 33 : 17}
                      className="fill-white/90 text-[11px] font-medium tabular-nums"
                    >
                      {formatNumber(datum.count)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>

          <div className="mt-2 flex min-h-[30px] items-center justify-between rounded-lg bg-iica-50/90 px-3 py-1.5 text-xs text-ink/75">
            {hovered ? (
              <>
                <span className="truncate font-medium text-ink">{hovered.name}</span>
                <span className="ml-2 shrink-0 tabular-nums">
                  {formatNumber(hovered.count)} contacts ·{" "}
                  {total > 0 ? Math.round((hovered.count / total) * 100) : 0}%
                </span>
              </>
            ) : (
              <>
                <span className="text-ink/60">Hover or click any block to filter</span>
                <span className="tabular-nums font-medium text-ink/75">
                  Top: {items[0]?.name} ({formatNumber(items[0]?.count ?? 0)})
                </span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------ Condition & Stock Health */

const CONDITION_COLORS: Record<Condition, string> = {
  IN_SERVICE: "#059669",
  NEEDS_REPAIR: "#d9a520",
  FOR_DECOMMISSION: "#ea580c",
  DECOMMISSIONED: "#64748b",
  DISPOSED: "#e11d48",
};

export function D3ConditionHealthChart({
  conditions,
  stockSummary,
}: {
  conditions: Record<string, number>;
  stockSummary: {
    totalItems: number;
    healthy: number;
    low: number;
    out: number;
    retired: number;
  };
}) {
  const router = useRouter();
  const [hoveredCond, setHoveredCond] = useState<Condition | null>(null);

  const slices = useMemo(() => {
    return CONDITIONS
      .map((c) => ({
        key: c,
        label: CONDITION_META[c].label,
        count: conditions[c] ?? 0,
        color: CONDITION_COLORS[c],
        href: `/inventory?condition=${c}`,
      }))
      .filter((s) => s.count > 0);
  }, [conditions]);

  const totalCond = useMemo(
    () => slices.reduce((sum, s) => sum + s.count, 0),
    [slices],
  );

  const arcs = useMemo(() => {
    const pie = d3
      .pie<(typeof slices)[number]>()
      .value((d) => d.count)
      .sort(null)
      .padAngle(0.03);
    return pie(slices);
  }, [slices]);

  const size = 132;
  const arcGen = useMemo(
    () =>
      d3
        .arc<d3.PieArcDatum<(typeof slices)[number]>>()
        .innerRadius(40)
        .outerRadius(59)
        .cornerRadius(4),
    [],
  );
  const hoverArcGen = useMemo(
    () =>
      d3
        .arc<d3.PieArcDatum<(typeof slices)[number]>>()
        .innerRadius(38)
        .outerRadius(64)
        .cornerRadius(4),
    [],
  );

  const stockSegments = useMemo(
    () => [
      {
        key: "healthy",
        label: "Healthy",
        count: Math.max(0, stockSummary.healthy),
        color: "#059669",
        href: "/inventory",
      },
      {
        key: "low",
        label: "Low stock",
        count: Math.max(0, stockSummary.low),
        color: "#d9a520",
        href: "/inventory?stock=low",
      },
      {
        key: "out",
        label: "Out of stock",
        count: Math.max(0, stockSummary.out),
        color: "#e11d48",
        href: "/inventory?stock=out",
      },
      {
        key: "retired",
        label: "Retired",
        count: Math.max(0, stockSummary.retired),
        color: "#94a3b8",
        href: "/inventory?condition=retired",
      },
    ],
    [stockSummary],
  );

  const activeSlice = slices.find((s) => s.key === hoveredCond);
  const coverageTotal = Math.max(1, stockSummary.totalItems);

  if (stockSummary.totalItems === 0) {
    return (
      <div className="flex h-[180px] items-center justify-center text-sm text-ink/60">
        No catalogue items recorded yet.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-[136px_minmax(0,1fr)]">
      {/* Condition D3 ring */}
      <div className="relative mx-auto shrink-0">
        <svg
          width={size}
          height={size}
          viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`}
          role="img"
          aria-label={`Catalogue condition ring across ${formatNumber(totalCond)} items`}
        >
          {arcs.map((arc) => {
            const isActive = hoveredCond === arc.data.key;
            const dim = hoveredCond !== null && !isActive;
            const pct = totalCond > 0 ? Math.round((arc.data.count / totalCond) * 100) : 0;
            return (
              <path
                key={arc.data.key}
                d={(isActive ? hoverArcGen(arc) : arcGen(arc)) ?? undefined}
                fill={arc.data.color}
                tabIndex={0}
                role="link"
                aria-label={`${arc.data.label}: ${formatNumber(arc.data.count)} items (${pct}%)`}
                className="cursor-pointer transition-all duration-200 focus:outline-none focus-visible:stroke-iica-900 focus-visible:stroke-2 motion-reduce:transition-none"
                style={{ opacity: dim ? 0.45 : 1 }}
                onMouseEnter={() => {
                  if (isCondition(arc.data.key)) setHoveredCond(arc.data.key);
                }}
                onMouseLeave={() => setHoveredCond(null)}
                onFocus={() => {
                  if (isCondition(arc.data.key)) setHoveredCond(arc.data.key);
                }}
                onBlur={() => setHoveredCond(null)}
                onClick={() => router.push(arc.data.href)}
                onKeyDown={(e) => onActivateKey(e, () => router.push(arc.data.href))}
              />
            );
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-4 text-center">
          <span className="max-w-[82px] truncate text-[10px] font-medium uppercase tracking-wider text-ink/65">
            {activeSlice ? activeSlice.label : "Catalogue"}
          </span>
          <span className="mt-0.5 text-lg font-semibold tabular-nums text-ink">
            {formatNumber(activeSlice ? activeSlice.count : totalCond)}
          </span>
          <span className="text-[11px] tabular-nums text-ink/65">
            {activeSlice && totalCond > 0
              ? `${Math.round((activeSlice.count / totalCond) * 100)}%`
              : "items"}
          </span>
        </div>
      </div>

      {/* Stock coverage stacked D3 bar + clickable pills */}
      <div className="min-w-0 space-y-4">
        <div>
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="font-medium text-ink/80">Stock coverage</span>
            <span className="tabular-nums text-ink/60">
              {Math.round((stockSummary.healthy / coverageTotal) * 100)}% healthy
            </span>
          </div>
          <div
            className="flex h-3 w-full overflow-hidden rounded-full bg-ink/10"
            role="img"
            aria-label="Stock coverage breakdown bar"
          >
            {stockSegments.map((seg) => {
              const pct = (seg.count / coverageTotal) * 100;
              if (pct <= 0) return null;
              return (
                <Link
                  key={seg.key}
                  href={seg.href}
                  title={`${seg.label}: ${formatNumber(seg.count)} (${Math.round(pct)}%)`}
                  style={{ width: `${pct}%`, backgroundColor: seg.color }}
                  className="h-full transition-opacity hover:opacity-85"
                />
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {slices.map((s) => {
            const isActive = hoveredCond === s.key;
            return (
              <Link
                key={s.key}
                href={s.href}
                onMouseEnter={() => setHoveredCond(s.key)}
                onMouseLeave={() => setHoveredCond(null)}
                className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition ${
                  isActive
                    ? "border-iica-300 bg-iica-50"
                    : "border-ink/10 hover:bg-iica-50/60"
                }`}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: s.color }}
                    aria-hidden="true"
                  />
                  <span className="truncate text-ink/80">{s.label}</span>
                </span>
                <span className="shrink-0 font-semibold tabular-nums text-ink">
                  {formatNumber(s.count)}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------- Timelines & Projects Chart */

type OpsProject = {
  id: number;
  title: string;
  status_name: string;
  is_closed: boolean;
  open_actions: number;
  overdue_actions: number;
};

export function D3OperationsChart({
  showTimelines,
  showProjects,
  taskStatusCounts,
  taskAreas,
  projects,
}: {
  showTimelines: boolean;
  showProjects: boolean;
  taskStatusCounts: Record<string, number>;
  taskAreas: { area: string; total: number }[];
  projects: OpsProject[];
}) {
  const defaultTab = showTimelines ? "timelines" : "projects";
  const [tab, setTab] = useState<"timelines" | "projects">(defaultTab);

  const taskBreakdown = useMemo(
    () => [
      {
        key: "COMPLETE",
        label: "Complete",
        count: taskStatusCounts.COMPLETE ?? 0,
        color: "#059669",
        href: "/timelines?status=COMPLETE",
      },
      {
        key: "ONGOING",
        label: "Ongoing",
        count: taskStatusCounts.ONGOING ?? 0,
        color: "#14477d",
        href: "/timelines?status=ONGOING",
      },
      {
        key: "NOT_STARTED",
        label: "Not started",
        count: taskStatusCounts.NOT_STARTED ?? 0,
        color: "#94a3b8",
        href: "/timelines?status=NOT_STARTED",
      },
      {
        key: "DELAYED",
        label: "Delayed",
        count: taskStatusCounts.DELAYED ?? 0,
        color: "#e11d48",
        href: "/timelines?status=DELAYED",
      },
    ],
    [taskStatusCounts],
  );

  const totalTasks = useMemo(
    () => taskBreakdown.reduce((s, d) => s + d.count, 0),
    [taskBreakdown],
  );
  const completeTasks = taskStatusCounts.COMPLETE ?? 0;
  const taskCompletionPct =
    totalTasks > 0 ? Math.round((completeTasks / totalTasks) * 100) : 0;

  const projectSummary = useMemo(() => {
    const active = projects.filter((p) => !p.is_closed);
    const closed = projects.length - active.length;
    const openActions = projects.reduce((s, p) => s + p.open_actions, 0);
    const overdueActions = projects.reduce((s, p) => s + p.overdue_actions, 0);
    const byStatus = new Map<string, number>();
    for (const p of projects) {
      byStatus.set(p.status_name, (byStatus.get(p.status_name) ?? 0) + 1);
    }
    const statusRows = [...byStatus.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count], idx) => ({
        key: name,
        label: name,
        count,
        color: CHART_PALETTE[idx % CHART_PALETTE.length],
      }));
    return { active: active.length, closed, openActions, overdueActions, statusRows };
  }, [projects]);

  // D3 radial gauge arc generator
  const gaugeArc = useMemo(() => {
    const r = 52;
    const thickness = 11;
    const pct =
      tab === "timelines"
        ? taskCompletionPct
        : projects.length > 0
          ? Math.round((projectSummary.active / projects.length) * 100)
          : 0;
    const endAngle = (pct / 100) * Math.PI * 2;
    const track =
      d3
        .arc<unknown>()
        .innerRadius(r - thickness)
        .outerRadius(r)
        .startAngle(0)
        .endAngle(Math.PI * 2)({}) ?? "";
    const fill =
      d3
        .arc<unknown>()
        .innerRadius(r - thickness)
        .outerRadius(r)
        .cornerRadius(6)
        .startAngle(0)
        .endAngle(endAngle)({}) ?? "";
    return { track, fill, pct };
  }, [tab, taskCompletionPct, projects.length, projectSummary.active]);

  const maxArea = Math.max(1, ...taskAreas.map((a) => a.total));

  return (
    <div className="space-y-3">
      {showTimelines && showProjects && projects.length > 0 && (
        <div className="flex items-center justify-between gap-2">
          <Link
            href={tab === "timelines" ? "/timelines" : "/projects"}
            className="text-xs font-medium text-iica-700 hover:underline"
          >
            Open {tab === "timelines" ? "staff timelines" : "projects workspace"} →
          </Link>
          <ChartModeToggle
            value={tab}
            onChange={setTab}
            label="Operations view"
            options={[
              { key: "timelines", label: "Timelines" },
              { key: "projects", label: "Projects" },
            ]}
          />
        </div>
      )}

      {tab === "timelines" ? (
        totalTasks === 0 ? (
          <div className="flex h-[150px] items-center justify-center text-sm text-ink/60">
            No staff timeline tasks loaded yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-[118px_minmax(0,1fr)]">
            <div className="relative mx-auto shrink-0">
              <svg
                width={120}
                height={120}
                viewBox="-60 -60 120 120"
                role="img"
                aria-label={`Timeline task completion ${gaugeArc.pct}%`}
              >
                <path d={gaugeArc.track} fill="rgba(22, 36, 58, 0.08)" />
                <path d={gaugeArc.fill} fill="#059669" />
              </svg>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-lg font-semibold tabular-nums text-ink">
                  {gaugeArc.pct}%
                </span>
                <span className="text-[10px] uppercase tracking-wider text-ink/65">
                  complete
                </span>
              </div>
            </div>

            <div className="min-w-0 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {taskBreakdown.map((item) => (
                  <Link
                    key={item.key}
                    href={item.href}
                    className="flex items-center justify-between gap-2 rounded-lg border border-ink/10 px-2.5 py-1.5 text-xs transition hover:bg-iica-50/60"
                  >
                    <span className="flex items-center gap-1.5 text-ink/80">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: item.color }}
                        aria-hidden="true"
                      />
                      {item.label}
                    </span>
                    <span className="font-semibold tabular-nums text-ink">
                      {formatNumber(item.count)}
                    </span>
                  </Link>
                ))}
              </div>

              {taskAreas.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  {taskAreas.slice(0, 4).map((a) => (
                    <Link
                      key={a.area}
                      href={`/timelines?area=${encodeURIComponent(a.area)}`}
                      className="flex items-center gap-2.5 text-xs hover:text-iica-700"
                    >
                      <span className="w-24 truncate font-medium text-ink/75">
                        {a.area}
                      </span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink/8">
                        <div
                          className="h-full rounded-full bg-iica-600"
                          style={{ width: `${Math.round((a.total / maxArea) * 100)}%` }}
                        />
                      </div>
                      <span className="w-8 text-right tabular-nums text-ink/60">
                        {formatNumber(a.total)}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        )
      ) : projects.length === 0 ? (
        <div className="flex h-[160px] items-center justify-center text-sm text-ink/60">
          No projects created yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 items-center gap-5 sm:grid-cols-[124px_minmax(0,1fr)]">
          <div className="relative mx-auto shrink-0">
            <svg
              width={120}
              height={120}
              viewBox="-60 -60 120 120"
              role="img"
              aria-label={`${projectSummary.active} active of ${projects.length} projects`}
            >
              <path d={gaugeArc.track} fill="rgba(22, 36, 58, 0.08)" />
              <path d={gaugeArc.fill} fill="#14477d" />
            </svg>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-lg font-semibold tabular-nums text-ink">
                {formatNumber(projectSummary.active)}
              </span>
              <span className="text-[10px] uppercase tracking-wider text-ink/65">
                active
              </span>
            </div>
          </div>

          <div className="min-w-0 space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg border border-ink/10 px-2.5 py-1.5">
                <div className="text-[10px] uppercase tracking-wider text-ink/65">
                  Projects
                </div>
                <div className="text-sm font-semibold tabular-nums text-ink">
                  {formatNumber(projects.length)}
                </div>
              </div>
              <div className="rounded-lg border border-ink/10 px-2.5 py-1.5">
                <div className="text-[10px] uppercase tracking-wider text-ink/65">
                  Open actions
                </div>
                <div className="text-sm font-semibold tabular-nums text-ink">
                  {formatNumber(projectSummary.openActions)}
                </div>
              </div>
              <div className="rounded-lg border border-ink/10 px-2.5 py-1.5">
                <div className="text-[10px] uppercase tracking-wider text-ink/65">
                  Overdue
                </div>
                <div
                  className={`text-sm font-semibold tabular-nums ${
                    projectSummary.overdueActions > 0 ? "text-rose-600" : "text-ink"
                  }`}
                >
                  {formatNumber(projectSummary.overdueActions)}
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              {projectSummary.statusRows.slice(0, 4).map((row) => (
                <div key={row.key} className="flex items-center gap-2.5 text-xs">
                  <span className="w-28 truncate font-medium text-ink/75">
                    {row.label}
                  </span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink/8">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.round((row.count / projects.length) * 100)}%`,
                        backgroundColor: row.color,
                      }}
                    />
                  </div>
                  <span className="w-6 text-right tabular-nums text-ink/60">
                    {formatNumber(row.count)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------- Calendar 14-Day Pulse */

const EVENT_TYPE_META = [
  { key: "MEETING", label: "Meetings", color: "#14477d", badge: "bg-iica-100 text-iica-800" },
  { key: "MISSION", label: "Missions", color: "#059669", badge: "bg-emerald-100 text-emerald-800" },
  { key: "LEAVE", label: "Leave", color: "#d9a520", badge: "bg-amber-100 text-amber-800" },
  { key: "DEADLINE", label: "Deadlines", color: "#e11d48", badge: "bg-rose-100 text-rose-800" },
  { key: "HOLIDAY", label: "Holidays", color: "#7c3aed", badge: "bg-violet-100 text-violet-800" },
  { key: "OTHER", label: "Other", color: "#64748b", badge: "bg-slate-100 text-slate-700" },
] as const;

type EventTypeKey = (typeof EVENT_TYPE_META)[number]["key"];

export type CalendarPulseDay = {
  dayKey: string;
  label: string;
  shortDay: string;
  isToday: boolean;
  counts: Record<EventTypeKey, number>;
  total: number;
};

export type CalendarPulseEvent = {
  id: number;
  title: string;
  eventType: string;
  startDayKey: string;
  endDayKey: string;
  timeLabel: string;
  location: string | null;
  monthKey: string;
};

export function D3CalendarPulseChart({
  days,
  events,
  todayKey,
  tomorrowKey,
}: {
  days: CalendarPulseDay[];
  events: CalendarPulseEvent[];
  todayKey: string;
  tomorrowKey: string;
}) {
  const { ref, width } = useChartWidth(480);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [hoveredDay, setHoveredDay] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<EventTypeKey | "ALL">("ALL");

  const activeDay = selectedDay ?? hoveredDay;

  const filteredDays = useMemo(
    () =>
      days.map((d) => {
        const val = typeFilter === "ALL" ? d.total : d.counts[typeFilter] ?? 0;
        return { ...d, visibleTotal: val };
      }),
    [days, typeFilter],
  );

  const stacked = useMemo(() => {
    const keys =
      typeFilter === "ALL"
        ? EVENT_TYPE_META.map((m) => m.key)
        : [typeFilter];
    const rows = days.map((d) => ({ dayKey: d.dayKey, ...d.counts }));
    const gen = d3.stack<(typeof rows)[number], EventTypeKey>().keys(keys);
    return gen(rows);
  }, [days, typeFilter]);

  const maxDayTotal = useMemo(
    () => Math.max(1, ...filteredDays.map((d) => d.visibleTotal)),
    [filteredDays],
  );

  const matchingEvents = useMemo(() => {
    return events.filter((ev) => {
      if (typeFilter !== "ALL" && ev.eventType !== typeFilter) return false;
      if (selectedDay) {
        return ev.startDayKey <= selectedDay && ev.endDayKey >= selectedDay;
      }
      return true;
    });
  }, [events, typeFilter, selectedDay]);

  const feedEvents = useMemo(() => matchingEvents.slice(0, 3), [matchingEvents]);
  const extraFeedCount = Math.max(0, matchingEvents.length - feedEvents.length);

  const height = 112;
  const margin = { top: 8, right: 8, bottom: 22, left: 24 };
  const innerW = Math.max(140, width - margin.left - margin.right);
  const innerH = height - margin.top - margin.bottom;

  const xBand = d3
    .scaleBand<string>()
    .domain(days.map((d) => d.dayKey))
    .range([0, innerW])
    .padding(0.24);

  const yScale = d3.scaleLinear().domain([0, maxDayTotal]).nice(3).range([innerH, 0]);
  const yTicks = yScale.ticks(3).filter((t) => Number.isInteger(t));

  const activeDayObj = filteredDays.find((d) => d.dayKey === activeDay);

  return (
    <div className="space-y-3">
      {/* Interactive Event Type Filter Legend */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter upcoming schedule by event type">
          <button
            type="button"
            aria-pressed={typeFilter === "ALL"}
            onClick={() => setTypeFilter("ALL")}
            className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition ${
              typeFilter === "ALL"
                ? "bg-iica-700 text-white"
                : "bg-iica-50 text-ink/70 hover:bg-iica-100"
            }`}
          >
            All ({formatNumber(events.length)})
          </button>
          {EVENT_TYPE_META.filter((m) =>
            events.some((ev) => ev.eventType === m.key),
          ).map((m) => {
            const active = typeFilter === m.key;
            return (
              <button
                key={m.key}
                type="button"
                aria-pressed={active}
                onClick={() => setTypeFilter((cur) => (cur === m.key ? "ALL" : m.key))}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition ${
                  active
                    ? "bg-ink text-white"
                    : "bg-ink/[0.04] text-ink/70 hover:bg-ink/10"
                }`}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: active ? "#ffffff" : m.color }}
                  aria-hidden="true"
                />
                {m.label}
              </button>
            );
          })}
        </div>

        {selectedDay && (
          <button
            type="button"
            onClick={() => setSelectedDay(null)}
            className="text-[11px] font-medium text-iica-700 hover:underline"
          >
            Clear day filter
          </button>
        )}
      </div>

      {/* D3 14-day Stacked Density Chart */}
      <div
        ref={ref}
        className="relative select-none"
        onMouseLeave={() => setHoveredDay(null)}
      >
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="block w-full overflow-visible"
          role="img"
          aria-label={`14-day schedule density across ${events.length} upcoming events`}
        >
          <g transform={`translate(${margin.left}, ${margin.top})`}>
            {yTicks.map((t) => (
              <g key={t} transform={`translate(0, ${yScale(t)})`}>
                <line
                  x1={0}
                  x2={innerW}
                  y1={0}
                  y2={0}
                  stroke="rgba(22, 36, 58, 0.08)"
                  strokeDasharray={t === 0 ? undefined : "3 3"}
                />
                <text
                  x={-6}
                  y={0}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="fill-ink/65 text-[10px] tabular-nums"
                >
                  {t}
                </text>
              </g>
            ))}

            {/* Stacked bars per type */}
            {stacked.map((series) => {
              const meta = EVENT_TYPE_META.find((m) => m.key === series.key);
              const color = meta?.color ?? "#64748b";
              return (
                <g key={series.key}>
                  {series.map((seg) => {
                    const dayKey = seg.data.dayKey;
                    const x = xBand(dayKey) ?? 0;
                    const bw = xBand.bandwidth();
                    const y1 = yScale(seg[1]);
                    const y0 = yScale(seg[0]);
                    const h = Math.max(0, y0 - y1);
                    if (h <= 0) return null;
                    const isFocused = activeDay === dayKey;
                    const dim = activeDay !== null && !isFocused;
                    return (
                      <rect
                        key={`${series.key}-${dayKey}`}
                        x={x}
                        y={y1}
                        width={bw}
                        height={h}
                        rx={Math.min(3, bw / 4)}
                        fill={color}
                        style={{ opacity: dim ? 0.35 : 0.92 }}
                        className="pointer-events-none transition-opacity duration-150"
                      />
                    );
                  })}
                </g>
              );
            })}

            {/* Day hit targets & X-axis labels */}
            {filteredDays.map((d, idx) => {
              const x = xBand(d.dayKey) ?? 0;
              const bw = xBand.bandwidth();
              const isSelected = selectedDay === d.dayKey;
              const showTick = d.isToday || idx % 2 === 0 || idx === filteredDays.length - 1;
              const toggleDay = () =>
                setSelectedDay((cur) => (cur === d.dayKey ? null : d.dayKey));
              return (
                <g
                  key={d.dayKey}
                  tabIndex={0}
                  role="button"
                  aria-pressed={isSelected}
                  aria-label={`${d.isToday ? `Today (${d.label})` : d.label}: ${d.visibleTotal} ${d.visibleTotal === 1 ? "event" : "events"}`}
                  className="cursor-pointer focus:outline-none focus-visible:outline-2 focus-visible:outline-iica-700"
                  onMouseEnter={() => setHoveredDay(d.dayKey)}
                  onFocus={() => setHoveredDay(d.dayKey)}
                  onBlur={() => setHoveredDay((cur) => (cur === d.dayKey ? null : cur))}
                  onClick={toggleDay}
                  onKeyDown={(e) => onActivateKey(e, toggleDay)}
                >
                  <rect
                    x={x - 2}
                    y={0}
                    width={bw + 4}
                    height={innerH}
                    rx={4}
                    fill={
                      isSelected
                        ? "rgba(20, 71, 125, 0.12)"
                        : hoveredDay === d.dayKey
                          ? "rgba(20, 71, 125, 0.06)"
                          : "transparent"
                    }
                    stroke={isSelected ? "#14477d" : "transparent"}
                    strokeWidth={1.2}
                  />
                  {showTick && (
                    <text
                      x={x + bw / 2}
                      y={innerH + 15}
                      textAnchor="middle"
                      className={`text-[10px] tabular-nums ${
                        d.isToday ? "fill-iica-700 font-semibold" : "fill-ink/65"
                      }`}
                    >
                      {d.isToday ? "Today" : d.shortDay}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        {activeDayObj && (
          <div className="mt-1.5 flex items-center justify-between rounded-lg bg-iica-50/90 px-2.5 py-1 text-xs text-ink/80">
            <span className="font-medium text-ink">
              {activeDayObj.isToday ? `Today (${activeDayObj.label})` : activeDayObj.label}
            </span>
            <span className="tabular-nums text-ink/70">
              {activeDayObj.visibleTotal}{" "}
              {activeDayObj.visibleTotal === 1 ? "event" : "events"}
              {!selectedDay && activeDayObj.visibleTotal > 0 ? " · click bar to filter" : ""}
            </span>
          </div>
        )}
      </div>

      {/* Upcoming event feed */}
      {feedEvents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-ink/12 px-4 py-5 text-center text-xs text-ink/60">
          {selectedDay
            ? "No events matching this filter on the selected day."
            : "No upcoming events in the next 14 days."}
        </div>
      ) : (
        <div className="divide-y divide-ink/5 rounded-xl border border-ink/8 bg-white">
          {feedEvents.map((ev) => {
            const meta =
              EVENT_TYPE_META.find((m) => m.key === ev.eventType) ??
              EVENT_TYPE_META[EVENT_TYPE_META.length - 1];
            const whenBadge =
              ev.startDayKey <= todayKey && ev.endDayKey >= todayKey
                ? "Today"
                : ev.startDayKey === tomorrowKey
                  ? "Tomorrow"
                  : ev.startDayKey.slice(5);
            return (
              <Link
                key={ev.id}
                href={`/calendar?month=${ev.monthKey}`}
                className="flex items-center gap-3 px-3 py-1.5 transition hover:bg-iica-50/60"
              >
                <span
                  className={`shrink-0 rounded-md px-2 py-0.5 text-[10.5px] font-semibold tabular-nums ${
                    whenBadge === "Today"
                      ? "bg-iica-700 text-white"
                      : "bg-ink/6 text-ink/75"
                  }`}
                >
                  {whenBadge}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-ink">{ev.title}</div>
                  <div className="truncate text-[11px] text-ink/60">
                    {ev.timeLabel}
                    {ev.location ? ` · ${ev.location}` : ""}
                  </div>
                </div>
                <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium ${meta.badge}`}>
                  {meta.label}
                </span>
              </Link>
            );
          })}
          {extraFeedCount > 0 && (
            <Link
              href={`/calendar?month=${(selectedDay ?? todayKey).slice(0, 7)}`}
              className="flex items-center justify-between px-3 py-1.5 text-xs font-medium text-iica-700 transition hover:bg-iica-50/60"
            >
              <span>
                +{formatNumber(extraFeedCount)} more{" "}
                {extraFeedCount === 1 ? "event" : "events"}
                {selectedDay ? " on this day" : " in the next 14 days"}
              </span>
              <span aria-hidden="true">→</span>
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------- Vendor Spend & Renewals */

export type VendorGroupSpendDatum = {
  key: string;
  label: string;
  vendorCount: number;
  paid: number;
  pending: number;
  quoted: number;
};

export type VendorRenewalDatum = {
  id: number;
  name: string;
  category: string;
  contractStatus: string;
  nextDueDate: string | null;
};

const VENDOR_STACK_SERIES = [
  { key: "paid", label: "Paid", color: "#14477d" },
  { key: "pending", label: "Pending", color: "#d9a520" },
  { key: "quoted", label: "Quoted", color: "#95b8de" },
] as const;

function VendorRenewalsStrip({ renewals }: { renewals: VendorRenewalDatum[] }) {
  if (renewals.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-t border-ink/8 pt-2.5 text-xs">
      <span className="font-medium text-ink/70">Attention:</span>
      {renewals.slice(0, 3).map((r) => (
        <Link
          key={r.id}
          href="/vendors?view=contracts"
          className="inline-flex items-center gap-1 rounded-md border border-gold-400/45 bg-gold-400/12 px-2 py-0.5 text-[11px] font-medium text-gold-700 hover:bg-gold-400/20"
        >
          <span>{r.name}</span>
          {r.nextDueDate && (
            <span className="tabular-nums text-ink/60">({r.nextDueDate})</span>
          )}
        </Link>
      ))}
    </div>
  );
}

export function D3VendorSpendChart({
  groups,
  renewals,
  totals,
}: {
  groups: VendorGroupSpendDatum[];
  renewals: VendorRenewalDatum[];
  totals: {
    paid: number;
    pending: number;
    quoted: number;
    renewalsDue: number;
    activeVendors: number;
  };
}) {
  const router = useRouter();
  const { ref, width } = useChartWidth(460);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  const hasSpend = totals.paid + totals.pending + totals.quoted > 0;

  const visibleGroups = useMemo(() => {
    return [...groups]
      .sort((a, b) =>
        hasSpend
          ? b.paid + b.pending + b.quoted - (a.paid + a.pending + a.quoted)
          : b.vendorCount - a.vendorCount,
      )
      .slice(0, 5);
  }, [groups, hasSpend]);

  const maxTotal = useMemo(
    () =>
      Math.max(
        1,
        ...visibleGroups.map((g) => g.paid + g.pending + g.quoted),
      ),
    [visibleGroups],
  );

  const stacked = useMemo(() => {
    const gen = d3
      .stack<VendorGroupSpendDatum, "paid" | "pending" | "quoted">()
      .keys(["paid", "pending", "quoted"]);
    return gen(visibleGroups);
  }, [visibleGroups]);

  if (totals.activeVendors === 0 && visibleGroups.length === 0) {
    return (
      <div className="flex h-[150px] items-center justify-center text-sm text-ink/60">
        No vendors recorded yet.
      </div>
    );
  }

  if (!hasSpend) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-ink/10 bg-iica-50/40 px-3 py-1.5">
            <div className="text-[10px] font-medium uppercase tracking-wider text-ink/65">
              Active vendors
            </div>
            <div className="text-sm font-semibold tabular-nums text-iica-800">
              {formatNumber(totals.activeVendors)}
            </div>
          </div>
          <Link
            href="/vendors?view=contracts"
            className={`rounded-lg border px-3 py-1.5 transition hover:border-iica-300 ${
              totals.renewalsDue > 0
                ? "border-gold-400/50 bg-gold-400/10"
                : "border-ink/10"
            }`}
          >
            <div className="text-[10px] font-medium uppercase tracking-wider text-ink/65">
              Renewals due
            </div>
            <div
              className={`text-sm font-semibold tabular-nums ${
                totals.renewalsDue > 0 ? "text-gold-700" : "text-ink"
              }`}
            >
              {formatNumber(totals.renewalsDue)}
            </div>
          </Link>
        </div>

        <D3RankedBars
          emptyTitle="No vendor groups yet."
          ariaLabel="Active vendors by service group bar chart"
          formatValue={formatNumber}
          items={visibleGroups.map((g, idx) => ({
            key: g.key,
            label: g.label,
            value: g.vendorCount,
            caption: `${formatNumber(g.vendorCount)} vendors`,
            href: `/vendors?group=${g.key}`,
            color: CHART_PALETTE[idx % CHART_PALETTE.length],
          }))}
        />
        <VendorRenewalsStrip renewals={renewals} />
      </div>
    );
  }

  const rowHeight = 28;
  const padTop = 6;
  const height = padTop + 6 + visibleGroups.length * rowHeight;
  const leftWidth = Math.min(132, Math.max(92, Math.floor(width * 0.34)));
  const rightWidth = 84;
  const barW = Math.max(60, width - leftWidth - rightWidth - 8);
  const xScale = d3.scaleLinear().domain([0, maxTotal]).range([0, barW]);

  const hovered = visibleGroups.find((g) => g.key === hoveredKey);

  return (
    <div className="space-y-3.5">
      {/* Compact TTD financial strip */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-lg border border-ink/10 bg-iica-50/40 px-2.5 py-1.5">
          <div className="text-[10px] font-medium uppercase tracking-wider text-ink/65">
            Paid (TTD)
          </div>
          <div className="text-sm font-semibold tabular-nums text-iica-800">
            {formatTtd(totals.paid)}
          </div>
        </div>
        <div className="rounded-lg border border-ink/10 px-2.5 py-1.5">
          <div className="text-[10px] font-medium uppercase tracking-wider text-ink/65">
            Pending
          </div>
          <div className="text-sm font-semibold tabular-nums text-gold-700">
            {formatTtd(totals.pending)}
          </div>
        </div>
        <div className="rounded-lg border border-ink/10 px-2.5 py-1.5">
          <div className="text-[10px] font-medium uppercase tracking-wider text-ink/65">
            Quoted
          </div>
          <div className="text-sm font-semibold tabular-nums text-ink/80">
            {formatTtd(totals.quoted)}
          </div>
        </div>
        <Link
          href="/vendors?view=contracts"
          className={`rounded-lg border px-2.5 py-1.5 transition hover:border-iica-300 ${
            totals.renewalsDue > 0
              ? "border-gold-400/50 bg-gold-400/10"
              : "border-ink/10"
          }`}
        >
          <div className="text-[10px] font-medium uppercase tracking-wider text-ink/65">
            Renewals due
          </div>
          <div
            className={`text-sm font-semibold tabular-nums ${
              totals.renewalsDue > 0 ? "text-gold-700" : "text-ink"
            }`}
          >
            {formatNumber(totals.renewalsDue)}
          </div>
        </Link>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-ink/65">
        {VENDOR_STACK_SERIES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: s.color }}
              aria-hidden="true"
            />
            {s.label}
          </span>
        ))}
      </div>

      {/* D3 Stacked Horizontal Bars */}
      <div ref={ref} className="relative select-none">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="block w-full overflow-visible"
          role="img"
          aria-label="D3 stacked bar chart of vendor spend in TTD by vendor group"
        >
          {visibleGroups.map((g, idx) => {
            const y = padTop + idx * rowHeight;
            const total = g.paid + g.pending + g.quoted;
            const isActive = hoveredKey === g.key;
            const dim = hoveredKey !== null && !isActive;

            return (
              <g
                key={g.key}
                transform={`translate(0, ${y})`}
                tabIndex={0}
                role="link"
                aria-label={`${g.label}: ${formatTtd(total)} across ${g.vendorCount} vendors`}
                className="cursor-pointer transition-opacity duration-150 focus:outline-none focus-visible:outline-2 focus-visible:outline-iica-700"
                style={{ opacity: dim ? 0.45 : 1 }}
                onMouseEnter={() => setHoveredKey(g.key)}
                onMouseLeave={() =>
                  setHoveredKey((cur) => (cur === g.key ? null : cur))
                }
                onFocus={() => setHoveredKey(g.key)}
                onBlur={() =>
                  setHoveredKey((cur) => (cur === g.key ? null : cur))
                }
                onClick={() => router.push(`/vendors?group=${g.key}`)}
                onKeyDown={(e) => onActivateKey(e, () => router.push(`/vendors?group=${g.key}`))}
              >
                <rect
                  x={0}
                  y={0}
                  width={width}
                  height={rowHeight - 2}
                  rx={7}
                  fill={isActive ? "rgba(225, 236, 247, 0.55)" : "transparent"}
                />
                <text
                  x={6}
                  y={15}
                  dominantBaseline="middle"
                  className="fill-ink text-[11.5px] font-medium"
                >
                  {g.label.length > 17 ? `${g.label.slice(0, 16)}…` : g.label}
                </text>
                <rect
                  x={leftWidth}
                  y={10}
                  width={barW}
                  height={10}
                  rx={5}
                  fill="rgba(22, 36, 58, 0.06)"
                />
                <text
                  x={width - 4}
                  y={15}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="fill-ink text-[11px] font-semibold tabular-nums"
                >
                  {formatTtd(total)}
                </text>
              </g>
            );
          })}

          {stacked.map((series) => {
            const meta = VENDOR_STACK_SERIES.find((s) => s.key === series.key);
            const color = meta?.color ?? "#14477d";
            return (
              <g key={series.key} className="pointer-events-none">
                {series.map((seg, idx) => {
                  const g = seg.data;
                  const x0 = leftWidth + xScale(seg[0]);
                  const x1 = leftWidth + xScale(seg[1]);
                  const w = Math.max(0, x1 - x0);
                  if (w <= 0) return null;
                  const y = padTop + idx * rowHeight + 10;
                  const dim = hoveredKey !== null && hoveredKey !== g.key;
                  return (
                    <rect
                      key={`${series.key}-${g.key}`}
                      x={x0}
                      y={y}
                      width={Math.max(2, w)}
                      height={10}
                      rx={3}
                      fill={color}
                      style={{ opacity: dim ? 0.45 : 1 }}
                    />
                  );
                })}
              </g>
            );
          })}
        </svg>

        {hovered && (
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-iica-50/90 px-3 py-1.5 text-xs text-ink/80">
            <span className="font-medium text-ink">
              {hovered.label} ({hovered.vendorCount} vendors)
            </span>
            <span className="tabular-nums text-ink/70">
              Paid {formatTtd(hovered.paid)} · Pending {formatTtd(hovered.pending)} · Quoted{" "}
              {formatTtd(hovered.quoted)}
            </span>
          </div>
        )}
      </div>

      <VendorRenewalsStrip renewals={renewals} />
    </div>
  );
}
