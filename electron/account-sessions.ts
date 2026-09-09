import type { WebContentsView } from "electron";
import type { Provider, ProviderAccountMode, ProviderId } from "../src/shared/contracts";
import { StateStore } from "./store";
import { adapterFor } from "./adapters/registry";
import { probeScript, type PageProbe } from "./adapters/page-scripts";
import { lifecycleForAccountMode } from "../src/shared/session-lifecycle";
import type { SessionLifecycleLedger } from "./identity/session-lifecycle-ledger";

/**
 * R-203: account/session lifecycle wiring (Provider → Profile → Account →
 * Session → Conversation). Probe observations are recorded both in the UI
 * account mode (READY / GUEST_READY / AUTH_REQUIRED / UNKNOWN) and in the
 * durable per-provider session-lifecycle ledger (UNKNOWN → CHECKING →
 * LOGGED_IN / EXPIRED / REAUTH_REQUIRED / FAILED). One provider's expiry or
 * failure never touches another provider's lifecycle record.
 */
export class AccountSessionManager {
  constructor(private readonly store: StateStore, private readonly onChange: () => void = () => undefined,
    private readonly lifecycle?: SessionLifecycleLedger) {}

  partitionFor(providerId: ProviderId): string {
    return `persist:codex-boss-${providerId}`;
  }

  ensure(providerId: ProviderId): void {
    const existing = this.store.snapshot().accounts.find((account) => account.providerId === providerId);
    if (existing) return;
    this.store.setAccount(providerId, this.partitionFor(providerId), "UNKNOWN", "等待网页账户状态探测");
    this.lifecycle?.record(providerId, "CHECKING", "开始探测账号会话", "default");
    this.onChange();
  }

  mount(provider: Provider, view: WebContentsView): void {
    this.ensure(provider.id);
    const inspect = async () => {
      const definition = adapterFor(provider);
      if (!definition || view.webContents.isDestroyed()) return;
      try {
        const probe = await view.webContents.executeJavaScript(probeScript(definition)) as PageProbe;
        this.recordProbe(provider.id, probe.inputFound, probe.loginLikely);
      } catch (error) {
        this.store.setAccount(provider.id, this.partitionFor(provider.id), "UNKNOWN", "页面已打开，但账户状态探测尚未完成");
        this.lifecycle?.record(provider.id, "FAILED", `探测异常：${String(error instanceof Error ? error.message : error).slice(0, 200)}`);
        this.onChange();
      }
    };
    view.webContents.on("did-finish-load", () => { void inspect(); });
  }

  recordProbe(providerId: ProviderId, inputFound: boolean, loginLikely: boolean): void {
    const mode: ProviderAccountMode = inputFound ? (loginLikely ? "GUEST_READY" : "READY") : loginLikely ? "AUTH_REQUIRED" : "UNKNOWN";
    const message = mode === "GUEST_READY" ? "游客输入可用；页面同时提供登录入口"
      : mode === "READY" ? "输入区域可用；沿用隔离持久会话"
        : mode === "AUTH_REQUIRED" ? "需要用户在该网页中完成登录"
          : "尚未确认游客或登录可用性";
    this.store.setAccount(providerId, this.partitionFor(providerId), mode, message);
    const lifecycleState = lifecycleForAccountMode(mode);
    if (lifecycleState !== "UNKNOWN") this.lifecycle?.record(providerId, lifecycleState, message);
    this.onChange();
  }
}
