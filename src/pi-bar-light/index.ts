import { basename } from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { renderFooter } from "../render.js";
import { fetchUsage, loadCredentials, providerFor, UsageCache } from "../usage.js";

function sessionTotals(ctx: ExtensionContext): { inputTokens: number; outputTokens: number; cost: number } {
  let inputTokens = 0;
  let outputTokens = 0;
  let cost = 0;
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "message" || entry.message.role !== "assistant") continue;
    const message = entry.message as AssistantMessage;
    inputTokens += message.usage.input;
    outputTokens += message.usage.output;
    cost += message.usage.cost.total;
  }
  return { inputTokens, outputTokens, cost };
}

export default function piBarLight(pi: ExtensionAPI): void {
  const cache = new UsageCache();
  let requestRender: (() => void) | undefined;
  let timer: NodeJS.Timeout | undefined;
  const unavailable = new Set<string>();

  pi.registerShortcut("ctrl+shift+o", {
    description: "Open the current directory in VS Code",
    handler: async (ctx) => {
      const result = await pi.exec("code", [ctx.cwd]);
      if (result.code !== 0) {
        ctx.ui.notify(result.stderr || "Failed to open VS Code", "error");
      }
    },
  });

  const refresh = async (ctx: ExtensionContext): Promise<void> => {
    const provider = providerFor(ctx.model?.provider);
    if (!provider) {
      requestRender?.();
      return;
    }
    await cache.refresh(provider, async () => {
      const credentials = loadCredentials(provider);
      if (!credentials) {
        unavailable.add(provider);
        return { windows: [] };
      }
      unavailable.delete(provider);
      return fetchUsage(provider, credentials);
    });
    requestRender?.();
  };

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode === "tui") {
      ctx.ui.setFooter((tui, theme, footerData) => {
        requestRender = () => tui.requestRender();
        const unsubscribe = footerData.onBranchChange(requestRender);
        return {
          dispose() {
            unsubscribe();
            requestRender = undefined;
          },
          invalidate() {},
          render(width: number): string[] {
            const usage = ctx.getContextUsage();
            const contextPercent = usage?.tokens != null && ctx.model?.contextWindow
              ? usage.tokens / ctx.model.contextWindow * 100
              : undefined;
            const provider = providerFor(ctx.model?.provider);
            const line = renderFooter({
              cwd: basename(ctx.cwd) || ctx.cwd,
              branch: footerData.getGitBranch(),
              contextPercent,
              model: ctx.model?.id,
              thinking: ctx.thinkingLevel,
              ...sessionTotals(ctx),
              quota: provider ? cache.get(provider) : undefined,
              quotaUnavailable: provider ? unavailable.has(provider) : false,
            }, width);
            return [theme.fg("dim", line)];
          },
        };
      });
    }
    timer = setInterval(() => void refresh(ctx), 60_000);
    timer.unref?.();
    await refresh(ctx);
  });

  pi.on("model_select", async (_event, ctx) => {
    requestRender?.();
    await refresh(ctx);
  });
  pi.on("thinking_level_select", () => requestRender?.());
  pi.on("turn_end", async (_event, ctx) => {
    requestRender?.();
    await refresh(ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (timer) clearInterval(timer);
    timer = undefined;
    requestRender = undefined;
    if (ctx.mode === "tui") ctx.ui.setFooter(undefined);
  });
}
