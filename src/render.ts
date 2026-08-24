import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { RateWindow } from "./usage.js";

export interface FooterState {
  cwd?: string;
  branch?: string | null;
  contextPercent?: number;
  model?: string;
  thinking?: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  quota?: RateWindow[];
  quotaUnavailable?: boolean;
}

const compact = (value: number): string => value < 1000 ? String(value) : `${(value / 1000).toFixed(1)}k`;
const quota = (windows: RateWindow[] = []): string => windows.map((window) => `${window.label} ${Math.round(window.usedPercent)}%`).join(" · ");

export function renderFooter(state: FooterState, width: number): string {
  if (width <= 0) return "";
  const location = state.cwd
    ? `${state.cwd}${state.branch ? ` (${state.branch})` : ""}`
    : state.branch || "no-git";
  const left = [location, state.contextPercent === undefined ? undefined : `ctx ${Math.round(state.contextPercent)}%`].filter(Boolean).join(" · ");
  const right = [
    `${state.model || "no-model"}${state.thinking && state.thinking !== "off" ? `:${state.thinking}` : ""}`,
    `↑${compact(state.inputTokens)} ↓${compact(state.outputTokens)} $${state.cost.toFixed(3)}`,
    state.quotaUnavailable ? "quota unavailable" : quota(state.quota),
  ].filter(Boolean).join(" · ");

  if (visibleWidth(left) + visibleWidth(right) + 1 <= width) {
    return left + " ".repeat(width - visibleWidth(left) - visibleWidth(right)) + right;
  }
  return truncateToWidth(right, width);
}
