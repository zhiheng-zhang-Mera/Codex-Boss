import type { SemanticAction, SemanticBackend, SemanticResult } from "../semantic-runtime";

/**
 * DOM tier of the §8.2 semantic chain: executes click_control / enter_text /
 * submit (and read_page / verify_state) over a visible web page through an
 * injected page surface (production: a provider WebContentsView; tests: a fake
 * evaluator). Targets use the `dom:` prefix with a JSON body, e.g.
 * `dom:{"selector":"#prompt-textarea"}`. Scripts are built from JSON.stringify
 * so selectors/text can never break out of the evaluated script.
 */
export interface DomPageRef {
  /** Open provider pane whose visible page executes the script (production: its WebContentsView). */
  providerId?: string;
}
export interface DomPageSurface {
  /**
   * Evaluates JS inside a visible page (like WebContentsView.executeJavaScript).
   * `page` selects which provider pane runs the script; surfaces without a
   * page concept may ignore it. Existing one-argument fakes stay assignable.
   */
  evaluate<T>(script: string, page?: DomPageRef): Promise<T>;
}

interface DomTarget { selector?: string; text?: string; providerId?: string }
interface DomOutcome { ok: boolean; reason?: string; text?: string }

export const DOM_TARGET_PREFIX = "dom:";
export const DOM_MUTATIONS: readonly SemanticAction["name"][] = ["click_control", "enter_text", "submit"];
export const DOM_READS: readonly SemanticAction["name"][] = ["read_page", "verify_state"];

function parseTarget(target: string): DomTarget | undefined {
  if (!target.startsWith(DOM_TARGET_PREFIX)) return undefined;
  try { return JSON.parse(target.slice(DOM_TARGET_PREFIX.length)) as DomTarget; } catch { return undefined; }
}

/** Parses a dom: target and returns it with `providerId` filled when present. */
export function parseDomTarget(target: string): { providerId?: string; selector?: string; text?: string } | undefined {
  const parsed = parseTarget(target);
  if (!parsed) return undefined;
  const { providerId, selector, text } = parsed;
  if (providerId !== undefined && !/^[a-zA-Z0-9_-]+$/.test(providerId)) throw new Error("Invalid dom target providerId");
  return { providerId, selector, text };
}

export class DomPageBackend implements SemanticBackend {
  readonly kind = "dom" as const;
  constructor(private readonly surface: DomPageSurface) {}

  supports(action: SemanticAction): boolean {
    const target = parseTarget(action.target);
    if (!target || !target.selector) return false;
    return DOM_MUTATIONS.includes(action.name) || DOM_READS.includes(action.name);
  }

  async execute(action: SemanticAction, _signal: AbortSignal): Promise<SemanticResult> {
    const target = parseDomTarget(action.target);
    if (!target || !target.selector) return { status: "UNSUPPORTED", message: `DOM action requires dom: target with a selector (got ${String(action.target).slice(0, 60)})` };
    const selector = target.selector;
    const page = target.providerId ? { providerId: target.providerId } : undefined;
    try {
      if (action.name === "click_control") {
        const outcome = await this.surface.evaluate<DomOutcome>(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return { ok: false, reason: "not-found" }; el.click(); return { ok: true }; })()`, page) ?? { ok: false };
        return outcome.ok ? { status: "SUCCESS" } : { status: "FAILED", message: outcome.reason ?? "click failed" };
      }
      if (action.name === "enter_text") {
        const value = action.value ?? "";
        const outcome = await this.surface.evaluate<DomOutcome>(`(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return { ok: false, reason: "not-found" };
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
            || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
          if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
            if (setter) setter.call(el, ${JSON.stringify(value)}); else el.value = ${JSON.stringify(value)};
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
          } else if (el.isContentEditable) { el.textContent = ${JSON.stringify(value)}; el.dispatchEvent(new Event("input", { bubbles: true })); }
          else return { ok: false, reason: "unsupported-element" };
          return { ok: true };
        })()`, page) ?? { ok: false };
        return outcome.ok ? { status: "SUCCESS" } : { status: "FAILED", message: outcome.reason ?? "enter_text failed" };
      }
      if (action.name === "submit") {
        const outcome = await this.surface.evaluate<DomOutcome>(`(() => {
          const el = document.querySelector(${JSON.stringify(selector)}) || document.activeElement;
          if (!el) return { ok: false, reason: "not-found" };
          el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
          el.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
          return { ok: true };
        })()`, page) ?? { ok: false };
        return outcome.ok ? { status: "SUCCESS" } : { status: "FAILED", message: outcome.reason ?? "submit failed" };
      }
      if (action.name === "read_page") {
        const outcome = await this.surface.evaluate<DomOutcome>(`(() => ({ ok: true, text: (document.body?.innerText ?? "").slice(0, 30000) }))()`, page);
        return outcome?.ok ? { status: "SUCCESS", evidence: { text: outcome.text ?? "" } } : { status: "FAILED", message: outcome?.reason ?? "read failed" };
      }
      if (action.name === "verify_state") {
        const expected = action.expected ?? action.value;
        const outcome = await this.surface.evaluate<DomOutcome>(`(() => ({ ok: true, text: (document.body?.innerText ?? "") }))()`, page);
        const found = expected === undefined || (outcome?.text ?? "").includes(expected);
        return found ? { status: "SUCCESS", evidence: { verified: true } } : { status: "FAILED", message: `expected state not found: ${expected}` };
      }
      return { status: "UNSUPPORTED", message: `DOM backend does not support ${action.name}` };
    } catch (error) {
      return { status: "FAILED", message: String(error).slice(0, 300) };
    }
  }
}
