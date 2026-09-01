import type { AdapterDefinition } from "./registry";

export interface PageProbe {
  inputFound: boolean;
  loginLikely: boolean;
  rateLimited: boolean;
  busy: boolean;
  latestResponse: string;
  sourceUrl: string;
}

function payload(definition: AdapterDefinition): string {
  return JSON.stringify(definition).replaceAll("<", "\\u003c");
}

export function probeScript(definition: AdapterDefinition): string {
  return `(() => {
    const d = ${payload(definition)};
    const visible = (e) => !!e && e.getClientRects().length > 0;
    const first = d.inputSelectors.map((s) => document.querySelector(s)).find(visible);
    const body = (document.body?.innerText || '').slice(0, 20000).toLowerCase();
    const loginLikely = /log in|sign in|登录|登入|继续使用|continue with google/.test(body) && !first;
    const rateLimited = /rate limit|too many requests|try again later|请求过于频繁|达到.*上限/.test(body);
    const busy = d.stopSelectors.some((s) => visible(document.querySelector(s)));
    const nodes = Array.from(new Set(d.responseSelectors.flatMap((s) => Array.from(document.querySelectorAll(s))))).filter(visible);
    nodes.sort((a, b) => a === b ? 0 : (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1);
    const responses = nodes.map((e) => (e.innerText || e.textContent || '').trim()).filter((t) => t.length >= 20);
    return { inputFound: !!first, loginLikely, rateLimited, busy, latestResponse: responses.at(-1)?.slice(0, 100000) || '', sourceUrl: location.href };
  })()`;
}

export function prepareScript(definition: AdapterDefinition, prompt: string): string {
  const safePrompt = JSON.stringify(prompt).replaceAll("<", "\\u003c");
  return `(() => {
    const d = ${payload(definition)};
    const visible = (e) => !!e && e.getClientRects().length > 0;
    const input = d.inputSelectors.map((s) => document.querySelector(s)).find(visible);
    if (!input) return { ok: false, reason: 'input-not-found' };
    input.focus();
    const value = ${safePrompt};
    if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set;
      setter ? setter.call(input, value) : input.value = value;
    } else {
      input.textContent = value;
    }
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.scrollIntoView({ block: 'center', behavior: 'smooth' });
    input.style.outline = '2px solid #d9f99d';
    input.style.outlineOffset = '3px';
    return { ok: true };
  })()`;
}

export function sendScript(definition: AdapterDefinition): string {
  return `(() => {
    const d = ${payload(definition)};
    const visible = (e) => !!e && e.getClientRects().length > 0;
    const input = d.inputSelectors.map((s) => document.querySelector(s)).find(visible);
    if (!input) return { ok: false, reason: 'input-not-found' };
    let scope = input.parentElement;
    for (let i = 0; i < 5 && scope?.parentElement; i += 1) scope = scope.parentElement;
    const buttons = Array.from((scope || document).querySelectorAll('button'));
    const send = buttons.find((button) => {
      if (!visible(button) || button.disabled) return false;
      const label = [button.getAttribute('aria-label'), button.getAttribute('data-testid'), button.textContent].filter(Boolean).join(' ').toLowerCase();
      const normalized = label.replace(/\s+/g, ' ').trim();
      if (/feedback|report|share|反馈|举报|分享/.test(normalized)) return false;
      return normalized === 'send' || normalized === '发送' || normalized.includes('send-button') || /send (prompt|message)$/.test(normalized) || /发送(提示|消息)$/.test(normalized);
    });
    if (!send) return { ok: false, reason: 'send-button-not-found' };
    send.click();
    return { ok: true };
  })()`;
}
