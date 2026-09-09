/**
 * R43 Phase B (R-205): first-run / fast login scan (pure + shareable).
 *
 * Aggregates the durable account modes + session-lifecycle states into a
 * one-glance login status per provider with an actionable hint. Boss's job is
 * the scan + quick guidance; MFA / CAPTCHA / brand-new-device authorization
 * remain genuine external (operator) steps and are reported as such — never
 * auto-solved, never hidden.
 */

import type { ProviderAccountMode } from "./contracts";
import type { SessionLifecycle } from "./session-lifecycle";

export type LoginScanStatus = "READY" | "GUEST_READY" | "LOGIN_REQUIRED" | "REAUTH_REQUIRED" | "CHECKING" | "FAILED" | "UNKNOWN";

export interface ProviderLoginScan {
  providerId: string;
  status: LoginScanStatus;
  mode: ProviderAccountMode | "UNKNOWN";
  lifecycle: SessionLifecycle;
  /** One-line operator hint (Chinese UI copy is used by the caller; keep ASCII-free). */
  hint: string;
  /** True when this provider needs an operator action to reach READY. */
  needsOperator: boolean;
  /** True only when the operator action is genuinely external (login/MFA/CAPTCHA). */
  externalOnly: boolean;
}

export interface LoginScanSummary {
  providers: ProviderLoginScan[];
  readyCount: number;
  needsOperatorCount: number;
}

function statusFor(mode: ProviderAccountMode, lifecycle: SessionLifecycle): LoginScanStatus {
  if (mode === "READY") return "READY";
  if (mode === "GUEST_READY") return "GUEST_READY";
  if (lifecycle === "FAILED") return "FAILED";
  if (lifecycle === "REAUTH_REQUIRED" || mode === "AUTH_REQUIRED") return "REAUTH_REQUIRED";
  if (lifecycle === "CHECKING") return "CHECKING";
  if (lifecycle === "EXPIRED") return "REAUTH_REQUIRED";
  return "LOGIN_REQUIRED";
}

export function providerLoginScan(providerId: string, mode: ProviderAccountMode | undefined, lifecycle: SessionLifecycle): ProviderLoginScan {
  const effectiveMode = mode ?? "UNKNOWN";
  const status = statusFor(effectiveMode, lifecycle);
  const needsOperator = status === "LOGIN_REQUIRED" || status === "REAUTH_REQUIRED" || status === "FAILED";
  const hintMap: Record<LoginScanStatus, string> = {
    READY: "会话可用，可直接使用",
    GUEST_READY: "游客输入可用；如需完整功能请登录",
    LOGIN_REQUIRED: "尚未登录该网页 AI，请在新标签页完成登录",
    REAUTH_REQUIRED: "会话已过期/需要重新授权，请重新登录",
    CHECKING: "正在探测账号状态",
    FAILED: "会话探测失败，请检查后重试",
    UNKNOWN: "状态未知"
  };
  return {
    providerId,
    status,
    mode: effectiveMode,
    lifecycle,
    hint: hintMap[status],
    needsOperator,
    externalOnly: needsOperator // login/MFA/CAPTCHA/授权是真实外部人工步骤
  };
}

export function loginScan(accounts: Array<{ providerId: string; mode?: ProviderAccountMode }>, lifecycles: Record<string, SessionLifecycle>): LoginScanSummary {
  const ids = [...new Set([...accounts.map((account) => account.providerId), ...Object.keys(lifecycles)])].sort();
  const providers = ids.map((providerId) => {
    const mode = accounts.find((account) => account.providerId === providerId)?.mode;
    return providerLoginScan(providerId, mode, lifecycles[providerId] ?? "UNKNOWN");
  });
  return {
    providers,
    readyCount: providers.filter((provider) => provider.status === "READY").length,
    needsOperatorCount: providers.filter((provider) => provider.needsOperator).length
  };
}
