import { describe, expect, it } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderFooter } from "../src/render.js";

const state = {
  cwd: "pi-bar-light",
  branch: "main",
  contextPercent: 42,
  model: "claude-sonnet-4-5",
  thinking: "high",
  inputTokens: 1250,
  outputTokens: 80,
  cost: 0.1234,
  quota: [{ label: "5h", usedPercent: 20 }, { label: "7d", usedPercent: 75 }],
};

describe("renderFooter", () => {
  it("renders all metrics when space is available", () => {
    const line = renderFooter(state, 120);
    expect(line).toContain("pi-bar-light (main) · ctx 42%");
    expect(line).toContain("claude-sonnet-4-5:high");
    expect(line).toContain("↑1.3k ↓80 $0.123");
    expect(line).toContain("20% · 75%");
  });

  it("shows when each quota window resets", () => {
    const now = Date.parse("2026-03-01T12:00:00Z");
    const line = renderFooter({
      ...state,
      quota: [
        { label: "5h", usedPercent: 20, resetAt: "2026-03-01T14:15:00Z" },
        { label: "7d", usedPercent: 75, resetAt: "2026-03-04T15:00:00Z" },
      ],
    }, 160, now);
    expect(line).toContain("20% ↻2h 15m · 75% ↻3d 3h");
  });

  it("handles imminent, elapsed, and invalid reset times", () => {
    const now = Date.parse("2026-03-01T12:00:00Z");
    const line = renderFooter({
      ...state,
      quota: [
        { label: "5h", usedPercent: 20, resetAt: "2026-03-01T12:00:01Z" },
        { label: "7d", usedPercent: 75, resetAt: "2026-03-01T11:59:00Z" },
        { label: "other", usedPercent: 10, resetAt: "invalid" },
      ],
    }, 180, now);
    expect(line).toContain("20% ↻1m · 75% ↻now · 10%");
  });

  it("never exceeds the available width", () => {
    for (const width of [0, 1, 12, 31, 32, 50]) {
      expect(visibleWidth(renderFooter(state, width))).toBeLessThanOrEqual(width);
    }
  });

  it("prioritizes right-side session data at narrow widths", () => {
    expect(renderFooter(state, 24)).toContain("claude-sonnet");
  });

  it("clearly reports unavailable quota", () => {
    expect(renderFooter({ ...state, quota: undefined, quotaUnavailable: true }, 120)).toContain("quota unavailable");
  });
});
