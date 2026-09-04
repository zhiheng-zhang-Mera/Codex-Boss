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
    const responses = nodes.map((e) => (e.innerText || e.textContent || '').trim()).filter((t) => t.length > 0);
    return { inputFound: !!first, loginLikely, rateLimited, busy, latestResponse: responses.at(-1)?.slice(0, 100000) || '', sourceUrl: location.href };
  })()`;
}

export function prepareScript(definition: AdapterDefinition, prompt: string): string {
  const safePrompt = JSON.stringify(prompt).replaceAll("<", "\\u003c");
  return `(async () => {
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
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(input);
      selection?.removeAllRanges();
      selection?.addRange(range);
      const inserted = typeof document.execCommand === 'function' && document.execCommand('insertText', false, value);
      if (!inserted) input.textContent = value;
    }
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.scrollIntoView({ block: 'center', behavior: 'smooth' });
    input.style.outline = '2px solid #d9f99d';
    input.style.outlineOffset = '3px';
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await new Promise((resolve) => setTimeout(resolve, 120));
    const current = input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement
      ? input.value
      : (input.innerText || input.textContent || '');
    const normalize = (text) => text.replace(/[\\u200B-\\u200D\\u2060\\uFEFF]/g, '').replace(/\\u00A0/g, ' ').replace(/\\r\\n?/g, '\\n').trim();
    return normalize(current) === normalize(value)
      ? { ok: true }
      : { ok: false, reason: 'value-not-applied' };
  })()`;
}

export function verifyPromptScript(definition: AdapterDefinition, prompt: string): string {
  const safePrompt = JSON.stringify(prompt).replaceAll("<", "\\u003c");
  return `(() => {
    const d = ${payload(definition)};
    const visible = (e) => !!e && e.getClientRects().length > 0;
    const input = d.inputSelectors.map((s) => document.querySelector(s)).find(visible);
    if (!input) return { ok: false, reason: 'input-not-found' };
    const current = input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement
      ? input.value
      : (input.innerText || input.textContent || '');
    const normalize = (text) => text.replace(/[\\u200B-\\u200D\\u2060\\uFEFF]/g, '').replace(/\\u00A0/g, ' ').replace(/\\r\\n?/g, '\\n').trim();
    return normalize(current) === normalize(${safePrompt})
      ? { ok: true }
      : { ok: false, reason: 'value-not-applied' };
  })()`;
}

export function sendScript(definition: AdapterDefinition): string {
  return `(async () => {
    const d = ${payload(definition)};
    const visible = (e) => !!e && e.getClientRects().length > 0;
    const input = d.inputSelectors.map((s) => document.querySelector(s)).find(visible);
    if (!input) return { ok: false, reason: 'input-not-found' };
    const current = input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement
      ? input.value
      : (input.innerText || input.textContent || '');
    if (!current.trim()) return { ok: false, reason: 'input-empty' };
    const findSend = () => {
      const explicit = [
        "button[data-testid='send-button']",
        "button[data-testid='composer-submit-button']",
        "button[aria-label^='Send']",
        "button[aria-label^='发送']",
        "button[aria-label^='提交']"
      ].map((selector) => document.querySelector(selector)).find((button) => visible(button) && !button.disabled);
      if (explicit) return explicit;
      let scope = input.closest('form') || input.parentElement;
      for (let i = 0; i < 10 && scope?.parentElement && scope.querySelectorAll('button').length < 2; i += 1) scope = scope.parentElement;
      const buttons = Array.from((scope || document).querySelectorAll('button'));
      return buttons.find((button) => {
        if (!visible(button) || button.disabled) return false;
        const labels = [button.getAttribute('aria-label'), button.getAttribute('data-testid'), button.textContent]
          .filter(Boolean).map((label) => label.toLowerCase().replace(/\\s+/g, ' ').trim());
        if (labels.some((label) => /feedback|report|share|反馈|举报|分享/.test(label))) return false;
        const configured = labels.some((label) => d.sendLabels.some((candidate) => label === candidate.toLowerCase() || label.startsWith(candidate.toLowerCase() + ' ') || label.includes(candidate.toLowerCase() + '-button')));
        return configured || button.getAttribute('type') === 'submit' || labels.some((label) => /send (prompt|message)$/.test(label) || /发送(提示|消息|提示词)$/.test(label));
      });
    };
    let send = findSend();
    for (let attempt = 0; !send && attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      send = findSend();
    }
    if (!send) return { ok: false, reason: 'send-button-not-found' };
    send.click();
    return { ok: true };
  })()`;
}
