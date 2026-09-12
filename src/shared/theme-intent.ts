/**
 * Update-Plan/checkpoint-1.md §14/§15/§19 — the Theme Intent Parser.
 *
 * §14's workflow starts with "User Prompt → Theme Intent Parser". This module
 * turns a natural-language style request into a *structured, explainable intent*:
 * every signal carries the phrase that produced it, so a user can see why the
 * draft looks the way it does, and the generator downstream never has to guess.
 *
 * Two properties matter for the plan:
 *
 *   §19 generation boundary — a request that asks for layout or behaviour
 *   ("move the sidebar to the right", "delete the settings panel", "make the
 *   composer a modal") is NOT a theme task. It is detected here and escalated to
 *   a UI Engineering Task instead of being silently approximated by colours.
 *
 *   §2.3 deterministic truth — the parser is deterministic keyword/shape
 *   analysis, not a model. A model may later propose an intent, but it must
 *   arrive as this same structure and pass the same validation; nothing in the
 *   pipeline trusts a claim that cannot name its evidence.
 *
 * Pure: no fs, no clock, no network.
 */

export const THEME_INTENT_VERSION = "theme-intent-1" as const;

/* ------------------------------------------------------------------ *
 * Intent model
 * ------------------------------------------------------------------ */

export type ThemeTemperature = "COOL" | "WARM" | "NEUTRAL";
export type ThemeLightness = "DARK" | "LIGHT" | "FOLLOW_BASE";
export type ThemeDensity = "COMPACT" | "COMFORTABLE" | "SPACIOUS";
export type ThemeRadius = "SHARP" | "SOFT" | "ROUNDED" | "PILL";
export type ThemeTypography = "SANS" | "ROUNDED" | "MONO" | "SERIF" | "FOLLOW_BASE";
export type ThemeContrast = "HIGH" | "NORMAL" | "SUBTLE";

export interface ThemeIntentSignal<T> {
  value: T;
  /** The prompt text that produced this signal (never empty). */
  evidence: string;
  /** 0..1 — how explicit the phrase was. */
  confidence: number;
}

export interface ThemeIntent {
  schemaVersion: 1;
  version: typeof THEME_INTENT_VERSION;
  /** The user's own words, kept verbatim for the revision loop. */
  prompt: string;
  /** Named reference styles, e.g. "macOS", "cyberpunk", "paper". */
  references: ThemeIntentSignal<string>[];
  temperature?: ThemeIntentSignal<ThemeTemperature>;
  lightness?: ThemeIntentSignal<ThemeLightness>;
  translucency?: ThemeIntentSignal<{ enabled: boolean; strength: number }>;
  density?: ThemeIntentSignal<ThemeDensity>;
  radius?: ThemeIntentSignal<ThemeRadius>;
  typography?: ThemeIntentSignal<ThemeTypography>;
  contrast?: ThemeIntentSignal<ThemeContrast>;
  /** Explicit accent colour when the user named one. */
  accent?: ThemeIntentSignal<string>;
  /** Extra hues the user mentioned, in mention order. */
  tones: string[];
  /** What the user asked to keep. */
  preserve: string[];
  /** §19: requests that are NOT a theme task. */
  escalations: { phrase: string; reason: string }[];
  /** True when at least one usable style signal was found. */
  usable: boolean;
  /** Human-readable trace, one line per decision. */
  trace: string[];
}

/* ------------------------------------------------------------------ *
 * Signal vocabulary (bilingual: this product is used in both languages)
 * ------------------------------------------------------------------ */

interface Term<T> { value: T; patterns: RegExp[] }

const REFERENCES: ReadonlyArray<{ name: string; patterns: RegExp[] }> = [
  { name: "macOS", patterns: [/mac\s?os/i, /macos/i, /\bapple\b/i, /苹果/i, /mac\s*风格/i] },
  { name: "Windows 11", patterns: [/windows\s*11/i, /\bwin11\b/i, /acrylic/i, /亚克力/i] },
  { name: "VS Code", patterns: [/vs\s?code/i, /vscode/i, /编辑器风格/i] },
  { name: "Terminal", patterns: [/\bterminal\b/i, /\btty\b/i, /终端/i, /命令行/i] },
  { name: "Cyberpunk", patterns: [/cyberpunk/i, /赛博/i, /霓虹/i, /\bneon\b/i] },
  { name: "Paper", patterns: [/\bpaper\b/i, /\bprint\b/i, /纸张/i, /纸感/i, /阅读模式/i] },
  { name: "Notion", patterns: [/notion/i] },
  { name: "Linear", patterns: [/linear/i, /极简暗色/i] },
  { name: "Glassmorphism", patterns: [/glass/i, /磨砂/i, /毛玻璃/i, /玻璃/i, /frosted/i, /vibrancy/i] },
  { name: "Brutalist", patterns: [/brutal/i, /粗野/i] },
  { name: "Retro", patterns: [/retro/i, /复古/i, /像素/i, /pixel\s*art/i] }
];

const TEMPERATURE: ReadonlyArray<Term<ThemeTemperature>> = [
  { value: "COOL", patterns: [/偏冷/i, /冷色/i, /冷调/i, /\bcool\b/i, /\bcold\b/i, /\bblue[- ]?ish\b/i, /青蓝/i, /冰川/i, /\bicy\b/i] },
  { value: "WARM", patterns: [/偏暖/i, /暖色/i, /暖调/i, /\bwarm\b/i, /\bsunset\b/i, /琥珀/i, /\bamber\b/i] }
];

const LIGHTNESS: ReadonlyArray<Term<ThemeLightness>> = [
  { value: "LIGHT", patterns: [/\blight\b/i, /浅色/i, /亮色/i, /白天/i, /白底/i, /明亮/i] },
  { value: "DARK", patterns: [/\bdark\b/i, /深色/i, /暗色/i, /夜间/i, /黑底/i, /更暗/i] }
];

const DENSITY: ReadonlyArray<Term<ThemeDensity>> = [
  { value: "COMPACT", patterns: [/紧凑/i, /更密/i, /密度高/i, /\bcompact\b/i, /\bdense\b/i, /\btight\b/i, /小一点/i] },
  { value: "SPACIOUS", patterns: [/宽松/i, /宽敞/i, /\bspacious\b/i, /\bairy\b/i, /留白/i, /大一点/i] }
];

const RADIUS: ReadonlyArray<Term<ThemeRadius>> = [
  { value: "SHARP", patterns: [/直角/i, /硬朗/i, /锐利/i, /\bsharp\b/i, /\bsquare\b/i, /方正/i, /圆角更小/i, /小圆角/i, /不要圆角/i] },
  { value: "PILL", patterns: [/胶囊/i, /\bpill\b/i, /全圆角/i] },
  { value: "ROUNDED", patterns: [/圆角更大/i, /更大的圆角/i, /圆角大/i, /更圆/i, /圆形/i, /\brounded\b/i, /\bround\b/i, /圆润/i] },
  { value: "SOFT", patterns: [/微圆/i, /轻微圆角/i, /\bsoft\b/i] }
];

const TYPOGRAPHY: ReadonlyArray<Term<ThemeTypography>> = [
  { value: "ROUNDED", patterns: [/圆体/i, /圆润字体/i, /\brounded\s+font\b/i, /字不要这么圆/i, /字体圆/i] },
  { value: "MONO", patterns: [/等宽/i, /\bmono/i, /代码字体/i, /\bmonospace\b/i] },
  { value: "SERIF", patterns: [/衬线/i, /\bserif\b/i] },
  { value: "SANS", patterns: [/无衬线/i, /\bsans\b/i, /\binter\b/i, /现代字体/i] }
];

const CONTRAST: ReadonlyArray<Term<ThemeContrast>> = [
  { value: "HIGH", patterns: [/高对比/i, /对比度更高/i, /更清晰/i, /\bhigh\s+contrast\b/i, /可读性/i] },
  { value: "SUBTLE", patterns: [/低对比/i, /柔和/i, /不要那么刺眼/i, /\bsubtle\b/i, /柔光/i] }
];

const TRANSLUCENCY = [
  /半透明/i, /透明/i, /磨砂/i, /毛玻璃/i, /玻璃/i, /\btransparent\b/i, /\btranslucent\b/i, /\bglass\b/i, /\bfrosted\b/i,
  /\bacrylic\b/i, /\bblur\b/i, /模糊/i, /vibrancy/i
];
const MORE_TRANSPARENT = [/再透明/i, /更透明/i, /更通透/i, /more\s+transparent/i, /less\s+opaque/i];
const LESS_TRANSPARENT = [/不要那么透明/i, /少一点透明/i, /更不透明/i, /more\s+opaque/i, /less\s+transparent/i];

const PRESERVE = [/保持/i, /保留/i, /不要改/i, /不变/i, /keep\s+(?:the\s+)?(.{2,20})/i];

/** Hues the user may name explicitly. */
const TONE_WORDS: ReadonlyArray<{ tone: string; patterns: RegExp[] }> = [
  { tone: "blue", patterns: [/蓝/i, /\bblue\b/i] },
  { tone: "teal", patterns: [/青/i, /\bteal\b/i, /蓝绿/i] },
  { tone: "green", patterns: [/绿/i, /\bgreen\b/i, /薄荷/i, /\bmint\b/i] },
  { tone: "purple", patterns: [/紫/i, /\bpurple\b/i, /\bviolet\b/i] },
  { tone: "pink", patterns: [/粉/i, /\bpink\b/i, /玫红/i] },
  { tone: "red", patterns: [/红/i, /\bred\b/i, /朱红/i] },
  { tone: "orange", patterns: [/橙/i, /\borange\b/i] },
  { tone: "amber", patterns: [/琥珀/i, /\bamber\b/i, /金黄/i] },
  { tone: "yellow", patterns: [/黄/i, /\byellow\b/i] },
  { tone: "slate", patterns: [/石板/i, /\bslate\b/i, /灰蓝/i] },
  { tone: "graphite", patterns: [/石墨/i, /\bgraphite\b/i, /中性灰/i] }
];

/**
 * §19 boundary: these requests are layout/behaviour work, not skinning. Each
 * detection carries the phrase so the escalation is explainable, and the caller
 * must turn it into a UI Engineering Task rather than a theme.
 */
const ESCALATIONS: ReadonlyArray<{ patterns: RegExp[]; reason: string }> = [
  { patterns: [/移动/i, /挪到/i, /\bmove\b/i, /\breorder\b/i, /改布局/i, /布局调整/i, /\blayout\s+change/i, /换个位置/i, /放(?:到|在)右边/i, /放(?:到|在)左边/i], reason: "moving or reordering UI regions is a layout change, not a theme" },
  {
    // Removal only escalates when it names an interface element: "去掉半透明"
    // is a style request, "去掉设置按钮" is not.
    patterns: [
      /(?:删掉|删除|移除|去掉|拿掉|干掉|隐藏)\s*(?:这个|该|那个|掉)?[\u4e00-\u9fff A-Za-z0-9]{0,6}?(?:侧栏|侧边栏|面板|按钮|输入框|导航|卡片|弹窗|窗口|标签|菜单|图标|组件|控件)/i,
      /\b(?:remove|delete|hide)\s+(?:the\s+)?(?:sidebar|panel|button|input|nav|card|modal|window|tab|menu|icon|component|control)\b/i
    ],
    reason: "removing or hiding a component changes behaviour, not appearance"
  },
  { patterns: [/新(?:增|加)\s*(?:一个|个|一块|一个)?[\u4e00-\u9fff A-Za-z0-9]{0,6}?(?:按钮|面板|页面|功能|视图|标签页|弹窗)/i, /\badd\s+(?:a\s+)?(?:button|panel|page|feature|view|tab)\b/i], reason: "adding interface elements is new UI work, not a theme" },
  { patterns: [/改(?:业务|逻辑|功能)/i, /\bbusiness\s+logic\b/i, /修改\s*IPC/i, /\bIPC\b/i, /快捷键/i, /\bshortcut\b/i, /拖拽/i, /\bdrag\b/i], reason: "behaviour, IPC and interaction changes are outside the theme boundary" },
  { patterns: [/换(?:框架|组件库)/i, /重写/i, /\brewrite\b/i, /\brefactor\b/i], reason: "rewriting components is engineering work" }
];

function firstMatch<T>(text: string, terms: ReadonlyArray<Term<T>>): ThemeIntentSignal<T> | undefined {
  for (const term of terms) {
    for (const pattern of term.patterns) {
      const match = pattern.exec(text);
      if (match) return { value: term.value, evidence: match[0], confidence: 0.8 };
    }
  }
  return undefined;
}

function allMatches(text: string, patterns: readonly RegExp[]): string[] {
  const found: string[] = [];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match && !found.includes(match[0])) found.push(match[0]);
  }
  return found;
}

/** Splits a revision into clauses so "再透明一些，其余不变" is an *adjustment*. */
export function isRevisionRequest(prompt: string): boolean {
  return /更|再|稍微|略微|一点|一些|不要那么|改成|还是|still|more|less|slightly|a bit|too\s/i.test(prompt);
}

/**
 * §14/§19: parses a style request into an explainable intent.
 *
 * The same function serves the first prompt and every later feedback message:
 * a revision simply re-parses the union of the original prompt and the feedback
 * (the caller passes `previous`), so "再透明一些" adjusts translucency strength
 * instead of replacing the whole intent.
 */
export function parseThemeIntent(prompt: string, options: { previous?: ThemeIntent } = {}): ThemeIntent {
  const text = (prompt ?? "").replace(/\s+/g, " ").trim();
  const trace: string[] = [];
  const intent: ThemeIntent = {
    schemaVersion: 1,
    version: THEME_INTENT_VERSION,
    prompt: text,
    references: [],
    tones: [],
    preserve: [],
    escalations: [],
    usable: false,
    trace
  };

  for (const reference of REFERENCES) {
    for (const pattern of reference.patterns) {
      const match = pattern.exec(text);
      if (!match) continue;
      intent.references.push({ value: reference.name, evidence: match[0], confidence: 0.75 });
      trace.push(`reference "${reference.name}" from ${JSON.stringify(match[0])}`);
      break;
    }
  }
  const temperature = firstMatch(text, TEMPERATURE);
  if (temperature) { intent.temperature = temperature; trace.push(`temperature ${temperature.value} from ${JSON.stringify(temperature.evidence)}`); }
  const lightness = firstMatch(text, LIGHTNESS);
  if (lightness) { intent.lightness = lightness; trace.push(`lightness ${lightness.value} from ${JSON.stringify(lightness.evidence)}`); }
  const density = firstMatch(text, DENSITY);
  if (density) { intent.density = density; trace.push(`density ${density.value} from ${JSON.stringify(density.evidence)}`); }
  const radius = firstMatch(text, RADIUS);
  if (radius) { intent.radius = radius; trace.push(`radius ${radius.value} from ${JSON.stringify(radius.evidence)}`); }
  const typography = firstMatch(text, TYPOGRAPHY);
  if (typography) { intent.typography = typography; trace.push(`typography ${typography.value} from ${JSON.stringify(typography.evidence)}`); }
  const contrast = firstMatch(text, CONTRAST);
  if (contrast) { intent.contrast = contrast; trace.push(`contrast ${contrast.value} from ${JSON.stringify(contrast.evidence)}`); }

  const translucent = allMatches(text, TRANSLUCENCY);
  if (translucent.length) {
    const more = allMatches(text, MORE_TRANSPARENT);
    const less = allMatches(text, LESS_TRANSPARENT);
    const previousStrength = options.previous?.translucency?.value.strength ?? 0.5;
    let strength = previousStrength;
    if (more.length) strength = Math.min(0.92, previousStrength + 0.18);
    if (less.length) strength = Math.max(0.12, previousStrength - 0.18);
    intent.translucency = { value: { enabled: true, strength: Number(strength.toFixed(2)) }, evidence: [...more, ...less, ...translucent][0], confidence: more.length || less.length ? 0.85 : 0.7 };
    trace.push(`translucency enabled at ${intent.translucency.value.strength} from ${JSON.stringify(translucent.join(", "))}`);
  }

  for (const tone of TONE_WORDS) {
    const match = tone.patterns.map((pattern) => pattern.exec(text)).find(Boolean);
    if (match) intent.tones.push(tone.tone);
  }
  const hex = /#([0-9a-f]{6}|[0-9a-f]{3})\b/i.exec(text);
  if (hex) {
    intent.accent = { value: hex[0], evidence: hex[0], confidence: 0.95 };
    trace.push(`accent ${hex[0]} named explicitly`);
  } else if (intent.tones.length) {
    trace.push(`tones mentioned: ${intent.tones.join(", ")}`);
  }

  for (const pattern of PRESERVE) {
    const match = pattern.exec(text);
    if (match) intent.preserve.push(match[0]);
  }
  if (intent.preserve.length) trace.push(`preserve: ${intent.preserve.join(", ")}`);

  for (const escalation of ESCALATIONS) {
    for (const pattern of escalation.patterns) {
      const match = pattern.exec(text);
      if (!match) continue;
      if (intent.escalations.some((entry) => entry.phrase === match[0])) break;
      intent.escalations.push({ phrase: match[0], reason: escalation.reason });
      trace.push(`§19 escalation: ${JSON.stringify(match[0])} — ${escalation.reason}`);
      break;
    }
  }

  // A revision that only adjusts one axis inherits everything else.
  if (options.previous) {
    const previous = options.previous;
    intent.references = intent.references.length ? intent.references : previous.references;
    intent.temperature ??= previous.temperature;
    intent.lightness ??= previous.lightness;
    intent.density ??= previous.density;
    intent.radius ??= previous.radius;
    intent.typography ??= previous.typography;
    intent.contrast ??= previous.contrast;
    intent.translucency ??= previous.translucency;
    intent.accent ??= previous.accent;
    intent.tones = intent.tones.length ? intent.tones : previous.tones;
    intent.preserve = [...new Set([...previous.preserve, ...intent.preserve])];
    trace.push("revision: unchanged axes inherited from the previous intent");
  }

  intent.usable = Boolean(
    intent.references.length || intent.temperature || intent.lightness || intent.density
    || intent.radius || intent.typography || intent.contrast || intent.translucency || intent.accent || intent.tones.length
  );
  if (!intent.usable) trace.push("no usable style signal found in the request");
  return intent;
}

/** §19: true when the request must become a UI Engineering Task, not a theme. */
export function requiresUiEngineering(intent: ThemeIntent): boolean {
  return intent.escalations.length > 0;
}

/** Compact statement of the intent, used in the package metadata and knowledge. */
export function describeIntent(intent: ThemeIntent): string {
  const parts: string[] = [];
  if (intent.references.length) parts.push(`reference: ${intent.references.map((entry) => entry.value).join("/")}`);
  if (intent.lightness) parts.push(`lightness: ${intent.lightness.value.toLowerCase()}`);
  if (intent.temperature) parts.push(`temperature: ${intent.temperature.value.toLowerCase()}`);
  if (intent.translucency) parts.push(`translucency: ${intent.translucency.value.strength}`);
  if (intent.density) parts.push(`density: ${intent.density.value.toLowerCase()}`);
  if (intent.radius) parts.push(`radius: ${intent.radius.value.toLowerCase()}`);
  if (intent.typography) parts.push(`typography: ${intent.typography.value.toLowerCase()}`);
  if (intent.contrast) parts.push(`contrast: ${intent.contrast.value.toLowerCase()}`);
  if (intent.accent) parts.push(`accent: ${intent.accent.value}`);
  if (!parts.length) return "no style signal";
  return parts.join("; ");
}
