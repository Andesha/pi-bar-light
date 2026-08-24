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
    expect(line).toContain("5h 20% · 7d 75%");
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
