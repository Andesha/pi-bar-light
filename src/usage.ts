import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type Provider = "anthropic" | "openai-codex";

export interface RateWindow {
  label: string;
  usedPercent: number;
  resetAt?: string;
}

export interface Credentials {
  accessToken: string;
  accountId?: string;
}

export interface UsageResult {
  windows: RateWindow[];
  retryAfterMs?: number;
}

export interface UsageDependencies {
  fetch: typeof globalThis.fetch;
  readJson: (path: string) => unknown;
  home: string;
  env: NodeJS.ProcessEnv;
  now: () => number;
}

const defaultDependencies: UsageDependencies = {
  fetch: globalThis.fetch,
  readJson(path) {
    if (!existsSync(path)) return undefined;
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch {
      return undefined;
    }
  },
  home: homedir(),
  env: process.env,
  now: Date.now,
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function providerFor(modelProvider?: string): Provider | undefined {
  if (modelProvider === "anthropic") return "anthropic";
  if (modelProvider === "openai-codex") return "openai-codex";
  return undefined;
}

export function loadCredentials(provider: Provider, deps = defaultDependencies): Credentials | undefined {
  const auth = record(deps.readJson(join(deps.home, ".pi", "agent", "auth.json")));
  const piCredential = record(auth?.[provider]);
  const piAccess = string(piCredential?.access);
  if (piAccess) return { accessToken: piAccess, accountId: string(piCredential?.accountId) };

  if (provider === "anthropic") {
    const claude = record(deps.readJson(join(deps.home, ".claude", ".credentials.json")));
    const oauth = record(claude?.claudeAiOauth);
    const scopes = Array.isArray(oauth?.scopes) ? oauth.scopes : [];
    const accessToken = string(oauth?.accessToken);
    return accessToken && scopes.includes("user:profile") ? { accessToken } : undefined;
  }

  const codexHome = deps.env.CODEX_HOME || join(deps.home, ".codex");
  const codex = record(deps.readJson(join(codexHome, "auth.json")));
  const tokens = record(codex?.tokens);
  const accessToken = string(tokens?.access_token);
  return accessToken ? { accessToken, accountId: string(tokens?.account_id) } : undefined;
}

function retryAfter(response: Response, now: number): number | undefined {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : Math.max(0, timestamp - now);
}

function percent(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : undefined;
}

export async function fetchUsage(provider: Provider, credentials: Credentials, deps = defaultDependencies): Promise<UsageResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const isAnthropic = provider === "anthropic";
    const headers: Record<string, string> = { Authorization: `Bearer ${credentials.accessToken}`, Accept: "application/json" };
    if (isAnthropic) headers["anthropic-beta"] = "oauth-2025-04-20";
    if (!isAnthropic && credentials.accountId) headers["ChatGPT-Account-Id"] = credentials.accountId;
    const url = isAnthropic ? "https://api.anthropic.com/api/oauth/usage" : "https://chatgpt.com/backend-api/wham/usage";
    const response = await deps.fetch(url, { headers, signal: controller.signal });
    if (!response.ok) {
      const error = new Error(`Usage request failed (${response.status})`) as Error & { retryAfterMs?: number };
      error.retryAfterMs = retryAfter(response, deps.now());
      throw error;
    }
    const data = record(await response.json());
    if (isAnthropic) {
      const five = record(data?.five_hour);
      const seven = record(data?.seven_day);
      const normalize = (label: string, value: Record<string, unknown> | undefined): RateWindow | undefined => {
        const usedPercent = percent(value?.utilization);
        return usedPercent === undefined ? undefined : { label, usedPercent, resetAt: string(value?.resets_at) };
      };
      return { windows: [normalize("5h", five), normalize("7d", seven)].filter((window): window is RateWindow => window !== undefined) };
    }
    const rateLimit = record(data?.rate_limit);
    const normalize = (value: unknown): RateWindow | undefined => {
      const window = record(value);
      const usedPercent = percent(window?.used_percent);
      if (usedPercent === undefined) return undefined;
      const seconds = typeof window?.limit_window_seconds === "number" ? window.limit_window_seconds : undefined;
      const hours = seconds ? Math.round(seconds / 3600) : undefined;
      const label = hours === undefined ? "quota" : hours >= 144 ? "7d" : hours >= 24 ? `${Math.round(hours / 24)}d` : `${hours}h`;
      const reset = typeof window?.reset_at === "number" ? new Date(window.reset_at * 1000).toISOString() : undefined;
      return { label, usedPercent, resetAt: reset };
    };
    return { windows: [normalize(rateLimit?.primary_window), normalize(rateLimit?.secondary_window)].filter((window): window is RateWindow => window !== undefined) };
  } finally {
    clearTimeout(timeout);
  }
}

export class UsageCache {
  private entries = new Map<Provider, { fetchedAt: number; windows: RateWindow[]; retryAt: number }>();
  private pending = new Map<Provider, Promise<RateWindow[] | undefined>>();

  constructor(private readonly ttlMs = 60_000, private readonly now = Date.now) {}

  get(provider: Provider): RateWindow[] | undefined {
    return this.entries.get(provider)?.windows;
  }

  async refresh(provider: Provider, fetcher: () => Promise<UsageResult>): Promise<RateWindow[] | undefined> {
    const entry = this.entries.get(provider);
    const now = this.now();
    if (entry && now - entry.fetchedAt < this.ttlMs) return entry.windows;
    if (entry && now < entry.retryAt) return entry.windows;
    const active = this.pending.get(provider);
    if (active) return active;
    const promise = fetcher().then((result) => {
      this.entries.set(provider, { fetchedAt: this.now(), windows: result.windows, retryAt: 0 });
      return result.windows;
    }).catch((error: unknown) => {
      const retry = record(error)?.retryAfterMs;
      const retryMs = typeof retry === "number" && retry > 0 ? retry : this.ttlMs;
      this.entries.set(provider, { fetchedAt: entry?.fetchedAt ?? 0, windows: entry?.windows ?? [], retryAt: this.now() + retryMs });
      return entry?.windows;
    }).finally(() => this.pending.delete(provider));
    this.pending.set(provider, promise);
    return promise;
  }
}
