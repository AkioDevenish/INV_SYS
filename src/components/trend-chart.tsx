"use client";

import { useId, useMemo, useState } from "react";
import * as d3 from "d3";
import { ChartModeToggle, useChartWidth } from "./d3-dashboard-charts";
import { APP_TIMEZONE, formatNumber } from "@/lib/format";

type Point = { day: string; inbound: number; outbound: number };
type RangeDays = 7 | 14 | 30 | 90;

function formatShortDay(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0));
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: APP_TIMEZONE,
  });
}

/**
 * Interactive D3.js movement chart with timeframe switching (7D/14D/30D/90D),
 * grouped bar vs smooth area+net trend modes, crosshair hover, and summary KPIs.
 */
export function TrendChart({ data }: { data: Point[] }) {
  const [range, setRange] = useState<RangeDays>(30);
  const [mode, setMode] = useState<"bars" | "area">("area");
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const { ref, width } = useChartWidth(560);
  const gradId = useId().replace(/:/g, "");

  const normalized = useMemo(
    () =>
      data.map((d) => ({
        day: d.day,
        label: formatShortDay(d.day),
        inbound: Math.max(0, Number.isFinite(d.inbound) ? d.inbound : 0),
        outbound: Math.max(0, Number.isFinite(d.outbound) ? d.outbound : 0),
      })),
    [data],
  );

  const availableRanges = useMemo<RangeDays[]>(() => {
    const opts: RangeDays[] = [7, 14, 30, 90];
    return opts.filter((r) => r <= Math.max(7, normalized.length));
  }, [normalized.length]);

  const effectiveRange = availableRanges.includes(range)
    ? range
    : availableRanges[availableRanges.length - 1] ?? 30;

  const sliced = useMemo(
    () => normalized.slice(-effectiveRange),
    [normalized, effectiveRange],
  );

  const summary = useMemo(() => {
    let totalIn = 0;
    let totalOut = 0;
    let peak = 0;
    for (const d of sliced) {
      totalIn += d.inbound;
      totalOut += d.outbound;
      if (d.inbound > peak) peak = d.inbound;
      if (d.outbound > peak) peak = d.outbound;
    }
    return { totalIn, totalOut, net: totalIn - totalOut, peak };
  }, [sliced]);

  if (normalized.length === 0) {
    return (
      <div className="flex h-[170px] items-center justify-center text-sm text-ink/60">
        No stock movements recorded yet.
      </div>
    );
  }

  const margin = { top: 10, right: 12, bottom: 22, left: 30 };
  const height = 170;
  const innerW = Math.max(120, width - margin.left - margin.right);
  const innerH = height - margin.top - margin.bottom;
  const yMax = Math.max(1, summary.peak);

  const xBand = d3
    .scaleBand<number>()
    .domain(sliced.map((_, i) => i))
    .range([0, innerW])
    .paddingInner(sliced.length > 45 ? 0.16 : 0.28)
    .paddingOuter(0.08);

  const xCenter = (idx: number) =>
    (xBand(idx) ?? 0) + xBand.bandwidth() / 2;

  const yScale = d3.scaleLinear().domain([0, yMax]).nice(4).range([innerH, 0]);
  const yTicks = yScale.ticks(4);

  const inAreaPath =
    d3
      .area<(typeof sliced)[number]>()
      .x((_, i) => xCenter(i))
      .y0(innerH)
      .y1((d) => yScale(d.inbound))
      .curve(d3.curveMonotoneX)(sliced) ?? "";

  const outAreaPath =
    d3
      .area<(typeof sliced)[number]>()
      .x((_, i) => xCenter(i))
      .y0(innerH)
      .y1((d) => yScale(d.outbound))
      .curve(d3.curveMonotoneX)(sliced) ?? "";

  const inLinePath =
    d3
      .line<(typeof sliced)[number]>()
      .x((_, i) => xCenter(i))
      .y((d) => yScale(d.inbound))
      .curve(d3.curveMonotoneX)(sliced) ?? "";

  const outLinePath =
    d3
      .line<(typeof sliced)[number]>()
      .x((_, i) => xCenter(i))
      .y((d) => yScale(d.outbound))
      .curve(d3.curveMonotoneX)(sliced) ?? "";

  // Pick up to ~5 evenly spaced date ticks along X
  const xTickIndices = (() => {
    if (sliced.length <= 1) return [0];
    if (sliced.length <= 7) return sliced.map((_, i) => i);
    const step = Math.max(1, Math.ceil((sliced.length - 1) / 4));
    const list: number[] = [];
    for (let i = 0; i < sliced.length; i += step) list.push(i);
    if (list[list.length - 1] !== sliced.length - 1) {
      if (sliced.length - 1 - list[list.length - 1] < Math.floor(step / 2)) {
        list[list.length - 1] = sliced.length - 1;
      } else {
        list.push(sliced.length - 1);
      }
    }
    return list;
  })();

  const activePoint = hoverIdx != null ? sliced[hoverIdx] : undefined;
  const activeX = hoverIdx != null ? xCenter(hoverIdx) : 0;

  return (
    <div className="space-y-3">
      {/* Interactive toolbar + summary pills */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="flex items-center gap-1.5 text-ink/75">
            <span className="h-2.5 w-2.5 rounded-full bg-iica-600" aria-hidden="true" />
            Received <strong className="tabular-nums text-ink">{formatNumber(summary.totalIn)}</strong>
          </span>
          <span className="flex items-center gap-1.5 text-ink/75">
            <span className="h-2.5 w-2.5 rounded-full bg-gold-400" aria-hidden="true" />
            Issued <strong className="tabular-nums text-ink">{formatNumber(summary.totalOut)}</strong>
          </span>
          <span className="rounded-md bg-iica-50 px-2 py-0.5 text-[11px] font-medium tabular-nums text-iica-800">
            Net {summary.net >= 0 ? `+${formatNumber(summary.net)}` : formatNumber(summary.net)}
          </span>
          <span className="text-[11px] tabular-nums text-ink/65">
            Peak {formatNumber(summary.peak)}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <div
            role="group"
            aria-label="Timeframe"
            className="inline-flex rounded-lg border border-ink/10 bg-iica-50/80 p-0.5"
          >
            {availableRanges.map((r) => {
              const active = r === effectiveRange;
              return (
                <button
                  key={r}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setHoverIdx(null);
                    setRange(r);
                  }}
                  className={`rounded-md px-2 py-1 text-[11px] font-medium tabular-nums transition motion-reduce:transition-none ${
                    active ? "bg-white text-iica-800 shadow-xs" : "text-ink/65 hover:text-ink"
                  }`}
                >
                  {r}D
                </button>
              );
            })}
          </div>

          <ChartModeToggle
            value={mode}
            onChange={setMode}
            label="Movement chart mode"
            options={[
              { key: "area", label: "Area" },
              { key: "bars", label: "Bars" },
            ]}
          />
        </div>
      </div>

      {/* D3 SVG Canvas */}
      <div
        ref={ref}
        className="relative select-none"
        onMouseLeave={() => setHoverIdx(null)}
      >
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="block w-full overflow-visible"
          role="img"
          aria-label={`D3 ${mode} chart of daily stock received and issued across ${sliced.length} days, peak ${summary.peak}`}
        >
          <defs>
            <linearGradient id={`${gradId}-in`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#1b5391" stopOpacity={0.28} />
              <stop offset="100%" stopColor="#1b5391" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id={`${gradId}-out`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#d9a520" stopOpacity={0.26} />
              <stop offset="100%" stopColor="#d9a520" stopOpacity={0.02} />
            </linearGradient>
          </defs>

          <g transform={`translate(${margin.left}, ${margin.top})`}>
            {/* Horizontal D3 Y-gridlines & labels */}
            {yTicks.map((tick) => {
              const y = yScale(tick);
              return (
                <g key={tick} transform={`translate(0, ${y})`}>
                  <line
                    x1={0}
                    x2={innerW}
                    y1={0}
                    y2={0}
                    stroke="rgba(22, 36, 58, 0.08)"
                    strokeDasharray={tick === 0 ? undefined : "3 3"}
                  />
                  <text
                    x={-8}
                    y={0}
                    textAnchor="end"
                    dominantBaseline="middle"
                    className="fill-ink/65 text-[10px] tabular-nums"
                  >
                    {formatNumber(tick)}
                  </text>
                </g>
              );
            })}

            {/* Mode 1: Smooth D3 Area + Line */}
            {mode === "area" && (
              <>
                <path d={inAreaPath} fill={`url(#${gradId}-in)`} />
                <path d={outAreaPath} fill={`url(#${gradId}-out)`} />
                <path
                  d={inLinePath}
                  fill="none"
                  stroke="#1b5391"
                  strokeWidth={2.2}
                  strokeLinecap="round"
                />
                <path
                  d={outLinePath}
                  fill="none"
                  stroke="#d9a520"
                  strokeWidth={2}
                  strokeLinecap="round"
                />
              </>
            )}

            {/* Mode 2: Grouped D3 Bars */}
            {mode === "bars" &&
              sliced.map((d, i) => {
                const bw = xBand.bandwidth();
                const gap = Math.min(2, bw * 0.12);
                const subW = Math.max(1.5, (bw - gap) / 2);
                const x0 = xBand(i) ?? 0;
                const inY = yScale(d.inbound);
                const outY = yScale(d.outbound);
                const isActive = hoverIdx === i;
                const dim = hoverIdx !== null && !isActive;

                return (
                  <g
                    key={d.day}
                    style={{ opacity: dim ? 0.45 : 1 }}
                    className="transition-opacity duration-150 motion-reduce:transition-none"
                  >
                    <rect
                      x={x0}
                      y={inY}
                      width={subW}
                      height={Math.max(0, innerH - inY)}
                      rx={Math.min(3, subW / 2)}
                      fill="#1b5391"
                    />
                    <rect
                      x={x0 + subW + gap}
                      y={outY}
                      width={subW}
                      height={Math.max(0, innerH - outY)}
                      rx={Math.min(3, subW / 2)}
                      fill="#d9a520"
                    />
                  </g>
                );
              })}

            {/* Hover crosshair + active dots */}
            {hoverIdx != null && activePoint && (
              <g className="pointer-events-none">
                <line
                  x1={activeX}
                  x2={activeX}
                  y1={0}
                  y2={innerH}
                  stroke="rgba(20, 71, 125, 0.35)"
                  strokeDasharray="3 3"
                />
                <circle
                  cx={activeX}
                  cy={yScale(activePoint.inbound)}
                  r={4.5}
                  fill="#1b5391"
                  stroke="#ffffff"
                  strokeWidth={2}
                />
                <circle
                  cx={activeX}
                  cy={yScale(activePoint.outbound)}
                  r={4.5}
                  fill="#d9a520"
                  stroke="#ffffff"
                  strokeWidth={2}
                />
              </g>
            )}

            {/* X-axis tick labels */}
            {xTickIndices.map((idx) => (
              <text
                key={sliced[idx]?.day ?? idx}
                x={xCenter(idx)}
                y={innerH + 17}
                textAnchor={
                  sliced.length === 1
                    ? "middle"
                    : idx === 0
                      ? "start"
                      : idx === sliced.length - 1
                        ? "end"
                        : "middle"
                }
                className="fill-ink/65 text-[10.5px] tabular-nums"
              >
                {sliced[idx]?.label}
              </text>
            ))}

            {/* Invisible hover & keyboard-focus hit columns across entire plot */}
            {sliced.map((d, i) => {
              const colW = innerW / Math.max(1, sliced.length);
              const net = d.inbound - d.outbound;
              return (
                <rect
                  key={`hit-${d.day}`}
                  x={i * colW}
                  y={0}
                  width={colW}
                  height={innerH}
                  fill="transparent"
                  tabIndex={0}
                  role="button"
                  aria-label={`${d.label}: ${formatNumber(d.inbound)} received, ${formatNumber(d.outbound)} issued, net ${net >= 0 ? `+${formatNumber(net)}` : formatNumber(net)}`}
                  className="cursor-crosshair focus:outline-none focus-visible:stroke-iica-700 focus-visible:stroke-1"
                  onMouseEnter={() => setHoverIdx(i)}
                  onFocus={() => setHoverIdx(i)}
                  onBlur={() => setHoverIdx((cur) => (cur === i ? null : cur))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setHoverIdx((cur) => (cur === i ? null : i));
                    } else if (e.key === "Escape") {
                      setHoverIdx(null);
                    }
                  }}
                />
              );
            })}
          </g>
        </svg>

        {/* Floating glassmorphic tooltip */}
        {hoverIdx != null && activePoint && (
          <div
            className="pointer-events-none absolute top-1 z-10 rounded-xl border border-iica-200/80 bg-white/95 px-3 py-2 text-xs shadow-lg backdrop-blur-xs"
            style={{
              left: `${Math.min(
                Math.max(8, margin.left + activeX - 72),
                Math.max(8, width - 168),
              )}px`,
            }}
          >
            <div className="font-semibold text-ink">{activePoint.label}</div>
            <div className="mt-1 space-y-0.5 tabular-nums">
              <div className="flex items-center justify-between gap-4 text-ink/80">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-iica-600" />
                  Received
                </span>
                <strong className="text-ink">{formatNumber(activePoint.inbound)}</strong>
              </div>
              <div className="flex items-center justify-between gap-4 text-ink/80">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-gold-400" />
                  Issued
                </span>
                <strong className="text-ink">{formatNumber(activePoint.outbound)}</strong>
              </div>
              <div className="flex items-center justify-between gap-4 border-t border-ink/10 pt-0.5 text-ink/70">
                <span>Net</span>
                <strong
                  className={
                    activePoint.inbound - activePoint.outbound >= 0
                      ? "text-emerald-700"
                      : "text-rose-600"
                  }
                >
                  {activePoint.inbound - activePoint.outbound >= 0
                    ? `+${formatNumber(activePoint.inbound - activePoint.outbound)}`
                    : formatNumber(activePoint.inbound - activePoint.outbound)}
                </strong>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
