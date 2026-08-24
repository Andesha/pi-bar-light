import { describe, expect, it, vi } from "vitest";
import { fetchUsage, loadCredentials, providerFor, UsageCache, type UsageDependencies } from "../src/usage.js";

const deps = (fetch: typeof globalThis.fetch, files: Record<string, unknown> = {}): UsageDependencies => ({
  fetch,
  readJson: (path) => files[path],
  home: "/home/test",
  env: {},
  now: () => 1_000,
});

const response = (body: unknown, status = 200, headers?: HeadersInit): Response => new Response(JSON.stringify(body), { status, headers });

describe("provider detection and credentials", () => {
  it("uses exact provider IDs rather than model names", () => {
    expect(providerFor("anthropic")).toBe("anthropic");
    expect(providerFor("openai-codex")).toBe("openai-codex");
    expect(providerFor("openai")).toBeUndefined();
  });

  it("reads Pi credentials without changing them", () => {
    const files = { "/home/test/.pi/agent/auth.json": { anthropic: { access: "secret" } } };
    expect(loadCredentials("anthropic", deps(vi.fn(), files))).toEqual({ accessToken: "secret", accountId: undefined });
  });

  it("does not mistake a Codex API key for ChatGPT OAuth", () => {
    const files = { "/home/test/.codex/auth.json": { OPENAI_API_KEY: "sk-secret" } };
    expect(loadCredentials("openai-codex", deps(vi.fn(), files))).toBeUndefined();
  });
});

describe("provider adapters", () => {
  it("normalizes Anthropic windows and sends OAuth headers", async () => {
    const fetch = vi.fn(async (_url, init) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer token");
      expect(new Headers(init?.headers).get("anthropic-beta")).toBe("oauth-2025-04-20");
      return response({ five_hour: { utilization: 12 }, seven_day: { utilization: 34 } });
    });
    await expect(fetchUsage("anthropic", { accessToken: "token" }, deps(fetch as typeof globalThis.fetch))).resolves.toEqual({
      windows: [{ label: "5h", usedPercent: 12, resetAt: undefined }, { label: "7d", usedPercent: 34, resetAt: undefined }],
    });
  });

  it("normalizes Codex windows and sends the account ID", async () => {
    const fetch = vi.fn(async (_url, init) => {
      expect(new Headers(init?.headers).get("chatgpt-account-id")).toBe("account");
      return response({ rate_limit: { primary_window: { used_percent: 10, limit_window_seconds: 18_000 }, secondary_window: { used_percent: 90, limit_window_seconds: 604_800 } } });
    });
    const result = await fetchUsage("openai-codex", { accessToken: "token", accountId: "account" }, deps(fetch as typeof globalThis.fetch));
    expect(result.windows.map(({ label, usedPercent }) => ({ label, usedPercent }))).toEqual([
      { label: "5h", usedPercent: 10 }, { label: "7d", usedPercent: 90 },
    ]);
  });
});

describe("UsageCache", () => {
  it("deduplicates refreshes and honors TTL", async () => {
    let now = 0;
    const cache = new UsageCache(60_000, () => now);
    const fetcher = vi.fn(async () => ({ windows: [{ label: "5h", usedPercent: 1 }] }));
    await Promise.all([cache.refresh("anthropic", fetcher), cache.refresh("anthropic", fetcher)]);
    now = 59_999;
    await cache.refresh("anthropic", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("keeps last-known-good data and backs off after failure", async () => {
    let now = 0;
    const cache = new UsageCache(60_000, () => now);
    await cache.refresh("anthropic", async () => ({ windows: [{ label: "5h", usedPercent: 20 }] }));
    now = 60_001;
    const failing = vi.fn(async () => { throw Object.assign(new Error("429"), { retryAfterMs: 120_000 }); });
    expect(await cache.refresh("anthropic", failing)).toEqual([{ label: "5h", usedPercent: 20 }]);
    now = 100_000;
    await cache.refresh("anthropic", failing);
    expect(failing).toHaveBeenCalledTimes(1);
  });
});
