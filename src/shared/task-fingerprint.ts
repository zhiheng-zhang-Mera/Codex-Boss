/**
 * Engine Phase 2/4 — TaskFingerprint contract (pure).
 *
 * The Engine book (§4) forbids an ever-growing hard-coded topic enum as the
 * routing schema. Instead a task is described by an OPEN fingerprint: role,
 * capability requirements, modality, autonomy/effect levels, scale, optional
 * semantic vector reference and learned concepts.
 *
 * This module owns the CONTRACT only. The deterministic builder (including the
 * embedding-free structural fallback required by Phase 4) lives in
 * electron/learning/task-fingerprint.ts.
 */

export const TASK_FINGERPRINT_VERSION = "fingerprint-1.0.0";

/** A learned concept reference — never an enum value. */
export interface LearnedConceptRef {
  conceptId: string;
  similarity: number;
  confidence: number;
}

export interface TaskFingerprint {
  schemaVersion: 1;
  fingerprintVersion: string;
  /** Reference into the embedding store when an embedding backend is available. */
  semanticVectorRef?: string;
  /** Deterministic structural hash — always present, embedding-independent. */
  structuralHash: string;
  role: string;
  capabilities: string[];
  modality?: string[];
  specificity?: number;
  autonomyLevel?: number;
  externalEffectLevel?: number;
  contextScale?: number;
  concepts?: LearnedConceptRef[];
}

export function conceptIds(fingerprint: Pick<TaskFingerprint, "concepts">): string[] {
  return (fingerprint.concepts ?? []).map((concept) => concept.conceptId);
}

/** Deterministic, dependency-free hash (FNV-1a 32-bit, hex) used for structural
 *  fingerprints and cache keys — stable across platforms and process restarts. */
export function structuralHashOf(parts: ReadonlyArray<string | number | undefined>): string {
  let hash = 0x811c9dc5;
  const input = parts.map((part) => (part === undefined ? "" : String(part))).join("\u0001");
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Inputs accepted by the deterministic (embedding-free) fingerprint builder. */
export interface FingerprintInput {
  role: string;
  capabilities?: string[];
  goal?: string;
  deliverables?: string[];
  constraints?: string[];
  /** Characters of assembled context the task will carry. */
  contextLength?: number;
  /** Execution/side-effect risk from TaskIR (executionRiskLevel alias accepted). */
  executionRiskLevel?: "low" | "medium" | "high";
  autonomyLevel?: number;
  externalEffectLevel?: number;
  modality?: string[];
  concepts?: LearnedConceptRef[];
  semanticVectorRef?: string;
}

const MODALITY_KEYWORDS: ReadonlyArray<{ modality: string; pattern: RegExp }> = [
  { modality: "text", pattern: /\b(text|summar|writ|report|article|文档|文本|总结|报告)\w*/i },
  { modality: "code", pattern: /\b(code|refactor|implement|function|module|test|build|代码|重构|实现|测试)\w*/i },
  { modality: "image", pattern: /\b(image|figure|diagram|screenshot|图片|图|截图)\w*/i },
  { modality: "audio", pattern: /\b(audio|speech|voice|音频|语音)\w*/i },
  { modality: "video", pattern: /\b(video|视频)\w*/i },
  { modality: "data", pattern: /\b(csv|json|dataset|table|数据|表格)\w*/i },
  { modality: "web", pattern: /\b(web|browser|url|page|网站|网页|浏览器)\w*/i },
  { modality: "file", pattern: /\b(file|directory|folder|repo|repository|文件|目录|仓库)\w*/i }
];

const HIGH_EFFECT_PATTERN = /\b(publish|deploy|delete|payment|transfer|credential|secret|email|send)\b|发布|部署|删除|转账|支付|密钥|发送/i;

function tokenize(text: string): string[] {
  return (text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((token) => token.length >= 2);
}

/** Vague goal → low specificity; detailed goal → high. Deterministic, bounded. */
export function deriveSpecificity(goal: string | undefined, capabilities: string[] = [], deliverables: string[] = []): number {
  const tokens = tokenize(goal ?? "");
  const significant = new Set(tokens.filter((token) => token.length >= 4));
  const detailBonus = Math.min(0.3, (capabilities.length + deliverables.length) * 0.03);
  const raw = Math.min(1, significant.size / 15) * 0.7 + detailBonus + Math.min(0.3, tokens.length / 100);
  return Number(Math.max(0, Math.min(1, raw)).toFixed(3));
}

/** Context scale from the assembled context size (log scale, bounded). */
export function deriveContextScale(contextLength: number | undefined): number {
  if (!contextLength || contextLength <= 0) return 0;
  return Number(Math.min(1, Math.log10(1 + contextLength) / 6).toFixed(3));
}

/** Deterministic modality set from goal text (union with caller-provided). */
export function deriveModalities(goal: string | undefined, provided: string[] = []): string[] {
  const found = new Set(provided.map((item) => item.toLocaleLowerCase()));
  const text = goal ?? "";
  for (const { modality, pattern } of MODALITY_KEYWORDS) if (pattern.test(text)) found.add(modality);
  if (!found.size) found.add("text");
  return [...found].sort();
}

/** External-effect level: TaskIR risk plus explicit high-effect wording. */
export function deriveExternalEffectLevel(input: Pick<FingerprintInput, "executionRiskLevel" | "externalEffectLevel" | "goal">): number {
  if (typeof input.externalEffectLevel === "number") {
    return Number(Math.max(0, Math.min(1, input.externalEffectLevel)).toFixed(3));
  }
  const base = input.executionRiskLevel === "high" ? 0.9 : input.executionRiskLevel === "medium" ? 0.5 : 0.1;
  const boosted = HIGH_EFFECT_PATTERN.test(input.goal ?? "") ? Math.max(base, 0.9) : base;
  return Number(boosted.toFixed(3));
}

/**
 * Deterministic, embedding-free fingerprint (Phase 4 fallback). Always available
 * — the semantic vector is only an OPTIONAL refinement carried as a reference.
 */
export function buildStructuralFingerprint(input: FingerprintInput): TaskFingerprint {
  const capabilities = [...new Set(input.capabilities ?? [])].sort();
  const modality = deriveModalities(input.goal, input.modality);
  const specificity = deriveSpecificity(input.goal, capabilities, input.deliverables ?? []);
  const contextScale = deriveContextScale(input.contextLength);
  const autonomyLevel = typeof input.autonomyLevel === "number" ? Number(Math.max(0, Math.min(1, input.autonomyLevel)).toFixed(3)) : 0.5;
  const externalEffectLevel = deriveExternalEffectLevel(input);
  const structuralHash = structuralHashOf([
    TASK_FINGERPRINT_VERSION,
    input.role,
    capabilities.join("+"),
    modality.join("+"),
    specificity,
    contextScale,
    autonomyLevel,
    externalEffectLevel
  ]);
  return {
    schemaVersion: 1,
    fingerprintVersion: TASK_FINGERPRINT_VERSION,
    semanticVectorRef: input.semanticVectorRef,
    structuralHash,
    role: input.role,
    capabilities,
    modality,
    specificity,
    autonomyLevel,
    externalEffectLevel,
    contextScale,
    concepts: input.concepts
  };
}
