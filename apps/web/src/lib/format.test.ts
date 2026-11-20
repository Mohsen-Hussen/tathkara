import { describe, expect, it } from "vitest";
import { formatCountdown, formatSar } from "./format";

describe("format", () => {
  it("formats the hold countdown", () => {
    expect(formatCountdown(600_000)).toBe("10:00");
    expect(formatCountdown(61_001)).toBe("1:02");
    expect(formatCountdown(-5)).toBe("0:00");
  });
  it("formats halalas as riyals", () => {
    expect(formatSar(45_000)).toMatch(/450\.00/);
  });
});
