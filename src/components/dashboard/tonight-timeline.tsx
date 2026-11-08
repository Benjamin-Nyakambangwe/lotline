"use client";

import { useEffect, useRef, useState } from "react";
import { layoutTimeline } from "@/lib/dashboard/timeline";
import { formatMoney } from "@/lib/domain/money";
import { type MyStatus, STATUS_LABEL } from "@/lib/domain/status";
import type { LiveLot } from "@/lib/live-view";
import { useNow } from "../time/ticker";

/**
 * Status is never colour alone (green/amber and red/green collapse for colour-blind readers):
 * every status also has its own shape, shown in the legend and named in the tooltip.
 */
type Shape = "circle" | "triangle" | "diamond" | "square" | "ring";
const MARK: Record<MyStatus, { shape: Shape; color: string }> = {
  winning: { shape: "circle", color: "var(--win)" },
  won: { shape: "circle", color: "var(--win)" },
  outbid: { shape: "triangle", color: "var(--outbid)" },
  closing: { shape: "diamond", color: "var(--closing)" },
  lost: { shape: "square", color: "var(--muted-foreground)" },
  watching: { shape: "ring", color: "var(--muted-foreground)" },
  passed: { shape: "ring", color: "var(--muted-foreground)" },
  ended: { shape: "ring", color: "var(--muted-foreground)" },
};

const LANE = 20;
const TOP = 26;
const AXIS = 24;
const R = 6;

export function MarkShape({
  status,
  x,
  y,
  r = R,
}: {
  status: MyStatus;
  x: number;
  y: number;
  r?: number;
}) {
  const { shape, color } = MARK[status];
  // A 2px ring in the surface colour keeps overlapping marks legible.
  const common = {
    stroke: "var(--card)",
    strokeWidth: 2,
    paintOrder: "stroke" as const,
  };
  switch (shape) {
    case "circle":
      return <circle cx={x} cy={y} r={r} fill={color} {...common} />;
    case "triangle":
      return (
        <path
          d={`M${x},${y - r * 1.15} L${x + r * 1.1},${y + r * 0.85} L${x - r * 1.1},${y + r * 0.85} Z`}
          fill={color}
          {...common}
          strokeLinejoin="round"
        />
      );
    case "diamond":
      return (
        <path
          d={`M${x},${y - r * 1.25} L${x + r * 1.15},${y} L${x},${y + r * 1.25} L${x - r * 1.15},${y} Z`}
          fill={color}
          {...common}
          strokeLinejoin="round"
        />
      );
    case "square":
      return (
        <rect
          x={x - r * 0.9}
          y={y - r * 0.9}
          width={r * 1.8}
          height={r * 1.8}
          rx={1.5}
          fill={color}
          {...common}
        />
      );
    default:
      return (
        <circle
          cx={x}
          cy={y}
          r={r - 1}
          fill="var(--card)"
          stroke={color}
          strokeWidth={2}
        />
      );
  }
}

const clock = (t: number) =>
  new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Harare",
  }).format(t);

/** Tonight's watched lots on a time axis, by status, with soft-close extensions as trails. */
export function TonightTimeline({
  lots,
  onOpen,
}: {
  lots: LiveLot[];
  onOpen: (id: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<{
    lot: LiveLot;
    x: number;
    y: number;
  } | null>(null);
  const ticked = useNow();
  const now = ticked || Date.now();

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) =>
      setWidth(Math.round(e.contentRect.width)),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const withEnd = lots.filter((l) => l.endAt);
  const layout =
    width > 0 && withEnd.length
      ? layoutTimeline(
          withEnd.map((l) => ({
            id: l.id,
            end: Date.parse(l.endAt as string),
            originalEnd:
              l.extended && l.originalEndAt
                ? Date.parse(l.originalEndAt)
                : null,
          })),
          { width, now },
        )
      : null;
  const byId = new Map(withEnd.map((l) => [l.id, l]));
  const height = TOP + (layout?.lanes ?? 1) * LANE + AXIS;
  const present = [...new Set(withEnd.map((l) => l.status))];
  const showNow = layout && now >= layout.start && now <= layout.end;

  return (
    <div>
      {/* Legend: shape + colour + word, only for statuses on the chart. */}
      <ul
        className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
        aria-label="Legend"
      >
        {present.map((s) => (
          <li key={s} className="flex items-center gap-1.5">
            <svg width="14" height="14" aria-hidden="true">
              <MarkShape status={s} x={7} y={7} r={5} />
            </svg>
            {STATUS_LABEL[s]}
          </li>
        ))}
        {withEnd.some((l) => l.extended) && (
          <li className="flex items-center gap-1.5">
            <svg width="18" height="14" aria-hidden="true">
              <line
                x1="2"
                y1="7"
                x2="16"
                y2="7"
                stroke="var(--extended)"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            Extended (late bids)
          </li>
        )}
      </ul>
      <div ref={box} className="relative w-full" style={{ height }}>
        {layout && (
          <svg
            width={width}
            height={height}
            className="overflow-visible"
            role="img"
            aria-label={`Tonight: ${withEnd.length} watched lots by closing time`}
          >
            {layout.ticks.map((t) => (
              <g key={t.t}>
                <line
                  x1={t.x}
                  x2={t.x}
                  y1={TOP - 6}
                  y2={height - AXIS + 4}
                  stroke="var(--border)"
                  strokeWidth={1}
                />
                <text
                  x={t.x}
                  y={height - 6}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[11px] tabular-nums"
                >
                  {clock(t.t)}
                </text>
              </g>
            ))}
            {showNow && (
              <g>
                <line
                  x1={layout.x(now)}
                  x2={layout.x(now)}
                  y1={TOP - 8}
                  y2={height - AXIS + 4}
                  stroke="var(--primary)"
                  strokeWidth={1.5}
                />
                <text
                  x={layout.x(now)}
                  y={TOP - 12}
                  textAnchor="middle"
                  className="fill-primary text-[11px] font-semibold"
                >
                  now
                </text>
              </g>
            )}
            {layout.placed.map((p) => {
              const l = byId.get(p.id);
              if (!l) return null;
              const y = TOP + p.lane * LANE + LANE / 2;
              return (
                <g key={p.id}>
                  {p.xOriginal !== null && (
                    <line
                      x1={p.xOriginal}
                      x2={p.x}
                      y1={y}
                      y2={y}
                      stroke="var(--extended)"
                      strokeWidth={2}
                      strokeLinecap="round"
                    />
                  )}
                  <MarkShape
                    status={l.status}
                    x={p.x}
                    y={y}
                    r={hover?.lot.id === l.id ? R + 1.5 : R}
                  />
                </g>
              );
            })}
          </svg>
        )}
        {layout?.placed.map((p) => {
          const l = byId.get(p.id);
          if (!l) return null;
          const y = TOP + p.lane * LANE + LANE / 2;
          const show = () => setHover({ lot: l, x: p.x, y });
          return (
            <button
              key={p.id}
              type="button"
              aria-label={`${l.title}: ${STATUS_LABEL[l.status]}, closes ${l.endAt ? clock(Date.parse(l.endAt)) : ""}`}
              onPointerEnter={show}
              onPointerLeave={() => setHover(null)}
              onFocus={show}
              onBlur={() => setHover(null)}
              onClick={() => onOpen(l.id)}
              className="absolute size-6 -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
              style={{ left: p.x, top: y }}
            />
          );
        })}
        {hover && (
          <div
            className="pointer-events-none absolute z-10 w-56 -translate-x-1/2 -translate-y-full rounded-lg border bg-popover p-2.5 text-xs shadow-lg"
            style={{
              left: Math.min(Math.max(hover.x, 112), width - 112),
              top: hover.y - 12,
            }}
            role="tooltip"
          >
            <p className="text-sm font-semibold tabular-nums">
              {hover.lot.phase === "final"
                ? hover.lot.finalPrice !== null
                  ? `Sold ${formatMoney(hover.lot.finalPrice)}`
                  : "No sale"
                : `${formatMoney(hover.lot.currentBid ?? hover.lot.nextBid)}${hover.lot.currentBid !== null ? ` · next ${formatMoney(hover.lot.nextBid)}` : ""}`}
            </p>
            <p className="mt-0.5 line-clamp-2 text-muted-foreground">
              {hover.lot.title}
            </p>
            <p className="mt-1 flex items-center gap-1.5">
              <svg width="12" height="12" aria-hidden="true">
                <MarkShape status={hover.lot.status} x={6} y={6} r={4} />
              </svg>
              {STATUS_LABEL[hover.lot.status]}
              {hover.lot.endAt && (
                <span className="text-muted-foreground">
                  · {clock(Date.parse(hover.lot.endAt))}
                </span>
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
