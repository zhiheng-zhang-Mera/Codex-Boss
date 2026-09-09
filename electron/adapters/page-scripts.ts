import type { AdapterDefinition } from "./registry";

export interface PageProbe {
  inputFound: boolean;
  loginLikely: boolean;
  rateLimited: boolean;
  busy: boolean;
  latestResponse: string;
  sourceUrl: string;
}

const editorSerialization = `
    const serialized = (node) => {
      if (node.nodeType === 3) return node.textContent || '';
      if (node.nodeName === 'BR') return '\\n';
      const text = Array.from(node.childNodes || []).map(serialized).join('');
      return /^(P|DIV|LI)$/.test(node.nodeName || '') ? text.replace(/\\n$/, '') + '\\n' : text;
    };
`;

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
    const alerts = Array.from(document.querySelectorAll('[role="alert"], [data-testid*="error"]')).filter(visible).map((e) => e.textContent || '').join(' ').toLowerCase();
    const rateLimited = /rate limit|too many requests|try again later|请求过于频繁|达到.*上限/.test(alerts || (!first ? body : ''));
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
    // Chromium can suspend requestAnimationFrame for an occluded provider
    // view. Keep the visual-settle hint, but never let preparation hang.
    await Promise.race([
      new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      new Promise((resolve) => setTimeout(resolve, 250))
    ]);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const current = input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement
      ? input.value
      : (input.innerText || input.textContent || '');
    const normalize = (text) => text.replace(/[\\u200B-\\u200D\\u2060\\uFEFF]/g, '').replace(/\\u00A0/g, ' ').replace(/\\r\\n?/g, '\\n').trim();
    ${editorSerialization}
    return normalize(current) === normalize(value) || normalize(serialized(input)) === normalize(value)
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
    ${editorSerialization}
    return normalize(current) === normalize(${safePrompt}) || normalize(serialized(input)) === normalize(${safePrompt})
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
    if (d.sendMode === 'enter') {
      // Composer with NO send button (verified live for DeepSeek 2026): the
      // visible text input submits on Enter. Still a user-visible action — the
      // prompt was typed into the visible page and Enter is pressed on it.
      input.focus();
      const key = (type) => input.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      key('keydown');
      key('keyup');
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const after = input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement ? input.value : (input.innerText || '');
      return after.trim() ? { ok: false, reason: 'enter-did-not-submit' } : { ok: true };
    }
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

export interface UploadFilePayload {
  name: string;
  mime: string;
  /** Base64 content for page-side File construction. */
  base64: string;
}

/**
 * Injects files through the adapter's file input (plan §9). The page builds a
 * File from the embedded base64 payload, assigns it via DataTransfer and fires
 * change — then waits briefly for the UI to render an attachment chip. It does
 * NOT send the prompt; the caller must verify the chip and only then send.
 */
export function uploadFilesScript(definition: AdapterDefinition, files: UploadFilePayload[]): string {
  const safeFiles = files.map((file) => ({ name: JSON.stringify(file.name).replaceAll("<", "\\u003c"), mime: JSON.stringify(file.mime).replaceAll("<", "\\u003c"), base64: file.base64 }));
  return `(async () => {
    const d = ${payload(definition)};
    const visible = (e) => !!e && e.getClientRects().length > 0;
    const input = (d.fileInputSelectors || ['input[type="file"]']).map((s) => document.querySelector(s)).find(visible);
    if (!input) return { ok: false, reason: 'file-input-not-found', confirmed: false };
    const files = ${JSON.stringify(safeFiles)};
    const transfer = new DataTransfer();
    for (const file of files) {
      const binary = atob(file.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      transfer.items.add(new File([bytes], file.name, { type: file.mime }));
    }
    Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 900));
    return { ok: true, confirmed: false };
  })()`;
}

/**
 * Fail-closed upload verification (plan §9.1): returns true only when a
 * rendered attachment chip carrying the expected file name is visible in the
 * DOM. Never treat an open dialog as an uploaded file.
 */
export function verifyUploadScript(definition: AdapterDefinition, expectedNames: string[]): string {
  const safeNames = JSON.stringify(expectedNames);
  return `(() => {
    const d = ${payload(definition)};
    const visible = (e) => !!e && e.getClientRects().length > 0;
    const selectors = d.attachmentSelectors || [];
    const body = (document.body?.innerText || '');
    const expected = ${safeNames};
    if (selectors.length === 0) {
      // No versioned chip surface: fail closed unless the file name already
      // appears in the visible page text (best-effort, still conservative).
      const present = expected.every((name) => body.includes(name));
      return { ok: present, confirmed: present, found: [], missing: present ? [] : expected };
    }
    const chips = Array.from(new Set(selectors.flatMap((s) => Array.from(document.querySelectorAll(s))))).filter(visible).map((e) => (e.innerText || e.textContent || e.getAttribute?.('aria-label') || '').trim()).filter(Boolean);
    const text = chips.join('\\n') + '\\n' + body;
    const found = expected.filter((name) => text.includes(name));
    const missing = expected.filter((name) => !text.includes(name));
    return { ok: missing.length === 0, confirmed: missing.length === 0, found, missing };
  })()`;
}
