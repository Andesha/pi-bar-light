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

function timeUntil(resetAt: string | undefined, now: number): string | undefined {
  if (!resetAt) return undefined;
  const remainingMinutes = Math.ceil((Date.parse(resetAt) - now) / 60_000);
  if (!Number.isFinite(remainingMinutes)) return undefined;
  if (remainingMinutes <= 0) return "now";
  const days = Math.floor(remainingMinutes / 1_440);
  const hours = Math.floor(remainingMinutes % 1_440 / 60);
  const minutes = remainingMinutes % 60;
  if (days > 0) return `${days}d${hours ? ` ${hours}h` : ""}`;
  if (hours > 0) return `${hours}h${minutes ? ` ${minutes}m` : ""}`;
  return `${minutes}m`;
}

const quota = (windows: RateWindow[] = [], now = Date.now()): string => windows.map((window) => {
  const reset = timeUntil(window.resetAt, now);
  return `${Math.round(window.usedPercent)}%${reset ? ` ↻${reset}` : ""}`;
}).join(" · ");

export function renderFooter(state: FooterState, width: number, now = Date.now()): string {
  if (width <= 0) return "";
  const location = state.cwd
    ? `${state.cwd}${state.branch ? ` (${state.branch})` : ""}`
    : state.branch || "no-git";
  const left = [location, state.contextPercent === undefined ? undefined : `ctx ${Math.round(state.contextPercent)}%`].filter(Boolean).join(" · ");
  const right = [
    `${state.model || "no-model"}${state.thinking && state.thinking !== "off" ? `:${state.thinking}` : ""}`,
    `↑${compact(state.inputTokens)} ↓${compact(state.outputTokens)} $${state.cost.toFixed(3)}`,
    state.quotaUnavailable ? "quota unavailable" : quota(state.quota, now),
  ].filter(Boolean).join(" · ");

  if (visibleWidth(left) + visibleWidth(right) + 1 <= width) {
    return left + " ".repeat(width - visibleWidth(left) - visibleWidth(right)) + right;
  }
  return truncateToWidth(right, width);
}
