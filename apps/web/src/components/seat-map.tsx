import { memo } from "react";
import clsx from "clsx";
import type { Seat } from "@tathkara/shared";
import { formatSar } from "../lib/format";

const TIER_COLORS = ["#7c3aed", "#2563eb", "#0d9488", "#ea580c"];

export function tierPalette(seats: Seat[]) {
  const tiers = [...new Map(seats.map((s) => [s.tier, s.price])).entries()].sort((a, b) => b[1] - a[1]);
  return new Map(tiers.map(([tier, price], i) => [tier, { color: TIER_COLORS[i % TIER_COLORS.length]!, price }]));
}

type Props = {
  seats: Seat[];
  selected: Set<string>;
  onToggle: (seat: Seat) => void;
  disabled?: boolean;
};

/** Seats grouped into sections and rows; every seat is a real, labelled button. */
export const SeatMap = memo(function SeatMap({ seats, selected, onToggle, disabled }: Props) {
  const palette = tierPalette(seats);
  const sections = new Map<string, Map<string, Seat[]>>();
  for (const s of seats) {
    const rows = sections.get(s.section) ?? new Map<string, Seat[]>();
    rows.set(s.row, [...(rows.get(s.row) ?? []), s]);
    sections.set(s.section, rows);
  }

  return (
    <div className="space-y-8">
      <div className="mx-auto h-2 w-2/3 rounded-full bg-slate-300" aria-hidden />
      <p className="-mt-6 text-center text-xs font-medium tracking-widest text-muted uppercase">Stage</p>
      {[...sections].map(([section, rows]) => (
        <section key={section} aria-label={section}>
          <h3 className="mb-3 text-center text-xs font-semibold tracking-wide text-muted uppercase">{section}</h3>
          <div className="space-y-1.5 overflow-x-auto pb-1">
            {[...rows].map(([row, rowSeats]) => (
              <div key={row} className="flex items-center justify-center gap-1.5">
                <span className="w-5 shrink-0 text-right text-xs text-muted">{row}</span>
                {rowSeats.map((s) => {
                  const isSelected = selected.has(s.id);
                  const mine = s.mine && s.status === "held";
                  const free = s.status === "available";
                  const color = palette.get(s.tier)!.color;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      data-seat={`${s.row}${s.number}`}
                      data-status={mine ? "mine" : s.status}
                      aria-pressed={isSelected}
                      aria-label={`Row ${s.row}, seat ${s.number}, ${s.tier}, ${formatSar(s.price)}, ${mine ? "held by you" : s.status}`}
                      disabled={disabled || (!free && !isSelected)}
                      onClick={() => onToggle(s)}
                      className={clsx(
                        "size-6 shrink-0 rounded-t-lg rounded-b-sm text-[10px] font-semibold transition-transform sm:size-7",
                        free && !isSelected && "hover:scale-110",
                        (isSelected || mine) && "text-white ring-2 ring-ink ring-offset-1",
                        !free && !mine && "cursor-not-allowed",
                      )}
                      style={{
                        backgroundColor: isSelected || mine ? "#0f172a" : free ? `${color}26` : "#e2e8f0",
                        color: isSelected || mine ? "#fff" : free ? color : "#94a3b8",
                        border: free && !isSelected ? `1.5px solid ${color}` : "1.5px solid transparent",
                      }}
                    >
                      {s.number}
                    </button>
                  );
                })}
                <span className="w-5 shrink-0 text-xs text-muted">{row}</span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
});

export function SeatLegend({ seats }: { seats: Seat[] }) {
  const palette = tierPalette(seats);
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted">
      {[...palette].map(([tier, { color, price }]) => (
        <li key={tier} className="flex items-center gap-1.5">
          <span
            className="size-3 rounded-sm"
            style={{ backgroundColor: `${color}26`, border: `1.5px solid ${color}` }}
          />
          {tier} · {formatSar(price)}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <span className="size-3 rounded-sm bg-ink" /> Selected
      </li>
      <li className="flex items-center gap-1.5">
        <span className="size-3 rounded-sm bg-slate-200" /> Taken
      </li>
    </ul>
  );
}
