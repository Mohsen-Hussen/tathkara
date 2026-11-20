import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Seat } from "@tathkara/shared";
import { SeatMap } from "./seat-map";

const seat = (n: number, status: Seat["status"], extra: Partial<Seat> = {}): Seat => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  section: "Orchestra",
  row: "A",
  number: n,
  tier: "VIP",
  price: 45_000,
  status,
  mine: false,
  ...extra,
});

describe("SeatMap", () => {
  it("labels every seat and only lets you pick free ones", async () => {
    const onToggle = vi.fn();
    render(
      <SeatMap
        seats={[seat(1, "available"), seat(2, "sold"), seat(3, "held", { mine: true })]}
        selected={new Set()}
        onToggle={onToggle}
      />,
    );
    const free = screen.getByRole("button", { name: /Row A, seat 1, VIP, .*available/ });
    const sold = screen.getByRole("button", { name: /seat 2, .*sold/ });
    expect(screen.getByRole("button", { name: /seat 3, .*held by you/ })).toBeInTheDocument();
    expect(sold).toBeDisabled();
    await userEvent.click(free);
    expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ number: 1 }));
  });

  it("marks selected seats as pressed", () => {
    const s = seat(1, "available");
    render(<SeatMap seats={[s]} selected={new Set([s.id])} onToggle={() => {}} />);
    expect(screen.getByRole("button", { name: /seat 1/ })).toHaveAttribute("aria-pressed", "true");
  });
});
