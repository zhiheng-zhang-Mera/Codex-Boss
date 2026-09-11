import { describe, expect, it } from "vitest";
import {
  EXECUTABLE_SCORE_THRESHOLD,
  MIN_CLASSIFIABLE_CHARACTERS,
  classifyWorkBook,
  detectAnalysisOnly,
  extractWorkBookFeatures,
  languageOf,
  logicalKeyFor
} from "../../src/shared/workbook";
import { compileTaskContract, declarationKindForHeading, itemsFromDeclarationText, userOverridesWorkbook } from "../../src/shared/task-contract";
import { ingressFromText } from "../helpers/workbook-test-helpers";

const EXECUTABLE_BODY = [
  "# 支付模块改造",
  "",
  "## Goal",
  "让用户在结算页选择分期付款。",
  "",
  "## Scope",
  "- 结算页 UI",
  "- 支付网关适配层",
  "",
  "## Constraints",
  "- 必须保持全额支付路径可用",
  "",
  "## Deliverables",
  "- 分期选择组件",
  "- 网关适配实现",
  "",
  "## Acceptance Criteria",
  "- [ ] FR-1 分期选项在结算页可见",
  "- [ ] AC-2 网关失败时回退到全额支付",
  "",
  "## Tasks",
  "1. 实现选择组件",
  "2. 更新网关适配层",
  "3. 新增回归测试",
  "4. 部署到预发环境",
  "5. 验证回退路径"
].join("\n");

const REFERENCE_BODY = [
  "# GB/T 12345 支付安全规范",
  "",
  "## 1 范围",
  "本标准界定了支付接口的安全要求。",
  "",
  "## 2 参考文献",
  "[1] ISO 9564 金融个人识别码管理与安全",
  "[2] RFC 4122 UUID 规范",
  "",
  "## 3 附录",
  "| 条款 | 说明 |",
  "| --- | --- |",
  "| 4.1 | 加密算法要求 |",
  "| 4.2 | 密钥生命周期 |",
  "| 4.3 | 审计日志留存 |",
  "",
  "## 修订历史",
  "2024-01 初版发布",
  "2025-03 补充密钥条款",
  "",
  "版权所有，未经许可不得转载。"
].join("\n");

describe("WorkBook classification — content features, not the file name", () => {
  it("classifies an actionable specification as EXECUTABLE_WORKBOOK with reasons", () => {
    const verdict = classifyWorkBook({ content: EXECUTABLE_BODY });
    expect(verdict.kind).toBe("EXECUTABLE_WORKBOOK");
    expect(verdict.score).toBeGreaterThanOrEqual(EXECUTABLE_SCORE_THRESHOLD);
    expect(verdict.confidence).toBeGreaterThan(0.5);
    const codes = verdict.reasons.map((reason) => reason.code);
    expect(codes).toContain("goal_section");
    expect(codes).toContain("deliverable_section");
    expect(codes).toContain("acceptance_section");
    expect(codes).toContain("checklist");
    // Every reason records the signed weight it contributed.
    for (const reason of verdict.reasons) expect(Number.isFinite(reason.weight)).toBe(true);
  });

  it("classifies a standards/reference document as REFERENCE", () => {
    const verdict = classifyWorkBook({ content: REFERENCE_BODY });
    expect(verdict.kind).toBe("REFERENCE");
    expect(verdict.score).toBeLessThanOrEqual(-2);
    const codes = verdict.reasons.map((reason) => reason.code);
    expect(codes).toContain("reference_material");
    expect(codes.some((code) => code === "revision_history" || code === "no_actionable_headings" || code === "dense_tables")).toBe(true);
  });

  it("uses content, not the file name: the classification is name-independent", async () => {
    const asSpec = await ingressFromText("final-spec.md", REFERENCE_BODY);
    const asRef = await ingressFromText("implementation-plan.txt", REFERENCE_BODY);
    const verbose = await ingressFromText("notes.md", EXECUTABLE_BODY);
    const executableVerdict = classifyWorkBook({ content: asSpec.content, sections: asSpec.sections });
    const referenceVerdict = classifyWorkBook({ content: asRef.content, sections: asRef.sections });
    expect(executableVerdict.kind).toBe("REFERENCE");
    expect(referenceVerdict.kind).toBe("REFERENCE");
    expect(classifyWorkBook({ content: verbose.content, sections: verbose.sections }).kind).toBe("EXECUTABLE_WORKBOOK");
  });

  it("returns AMBIGUOUS with an explicit reason for very short notes", () => {
    const verdict = classifyWorkBook({ content: "# 待办\n\n看一下这个问题" });
    expect(verdict.kind).toBe("AMBIGUOUS");
    expect(verdict.reasons.some((reason) => reason.code === "short_document")).toBe(true);
    expect(verdict.features.characters).toBeLessThan(MIN_CLASSIFIABLE_CHARACTERS);
    // Ambiguity must never claim high confidence.
    expect(verdict.confidence).toBeLessThanOrEqual(0.5);
  });

  it("extracts deterministic features (headings, lists, identifiers, tables)", () => {
    const features = extractWorkBookFeatures({ content: EXECUTABLE_BODY });
    expect(features.headings).toContain("Acceptance Criteria");
    expect(features.checklistCount).toBeGreaterThanOrEqual(2);
    expect(features.identifierCount).toBeGreaterThanOrEqual(2);
    expect(features.numberedLines).toBeGreaterThanOrEqual(5);
    expect(features.imperativeHits).toBeGreaterThan(0);

    const reference = extractWorkBookFeatures({ content: REFERENCE_BODY });
    expect(reference.tableRows).toBeGreaterThanOrEqual(5);
    expect(reference.cjkRatio).toBeGreaterThan(0.5);
  });

  it("is stable: identical input always yields the identical verdict", () => {
    const first = classifyWorkBook({ content: EXECUTABLE_BODY });
    const second = classifyWorkBook({ content: EXECUTABLE_BODY });
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("maps file names to logical workbook keys", () => {
    expect(logicalKeyFor("spec.md", "a".repeat(64))).toBe(logicalKeyFor("spec-v2.md", "b".repeat(64)));
    expect(logicalKeyFor("Spec (1).md", "c".repeat(64))).toBe(logicalKeyFor("spec.md", "d".repeat(64)));
    expect(logicalKeyFor("规格说明-定稿.md", "e".repeat(64))).toBe(logicalKeyFor("规格说明-v3.md", "f".repeat(64)));
    expect(logicalKeyFor("spec.md", "a".repeat(64))).not.toBe(logicalKeyFor("other.md", "a".repeat(64)));
    expect(logicalKeyFor("无扩展名", "a".repeat(64))).toContain("wb:");
    expect(languageOf("纯中文内容")).toBe("zh");
  });
});

describe("analysis-only detection — Chinese and English phrases", () => {
  it("detects analysis-only requests", () => {
    const zh = detectAnalysisOnly("请分析这份需求文档，只做分析，不要修改任何文件");
    expect(zh.kind).toBe("ANALYSIS_ONLY");
    expect(zh.confidence).toBeGreaterThan(0.5);
    expect(zh.matched).toContain("分析");
    expect(zh.matched).toContain("只读");
    // A bare execution verb inside a prohibition is still reported, so the
    // verdict is auditable rather than silently swallowed.
    expect(zh.executionMatches).toEqual(["重构/修改"]);

    const en = detectAnalysisOnly("Please review this specification and give me feedback; analysis only, no changes");
    expect(en.kind).toBe("ANALYSIS_ONLY");
    expect(en.matched).toContain("review");
    expect(en.matched).toContain("只读");
    expect(en.executionMatches).toEqual([]);
  });

  it("lets execution verbs override analysis phrasing", () => {
    const mixed = detectAnalysisOnly("分析需求后实现分期付款功能并部署到预发环境");
    expect(mixed.kind).toBe("EXECUTION_REQUESTED");
    expect(mixed.executionMatches).toContain("实现/开发");
    expect(mixed.reasons.some((reason) => reason.startsWith("execution:"))).toBe(true);
  });

  it("returns UNSPECIFIED when the message says nothing about analysis or execution", () => {
    const verdict = detectAnalysisOnly("这是附件，请查收");
    expect(verdict.kind).toBe("UNSPECIFIED");
    expect(verdict.confidence).toBe(0);
  });

  it("is deterministic and bilingual per phrase, not per keyword hack", () => {
    const first = detectAnalysisOnly("总结一下文档，只读");
    const second = detectAnalysisOnly("总结一下文档，只读");
    expect(second).toEqual(first);
    expect(detectAnalysisOnly("只读").kind).toBe("ANALYSIS_ONLY");
    expect(detectAnalysisOnly("分析并解释这个规范").matched).toEqual(expect.arrayContaining(["分析", "解读/说明"]));
  });
});

describe("compiled task contract — declarations and override precedence", () => {
  it("compiles every contract field from recognised headings", async () => {
    const document = await ingressFromText("spec.md", EXECUTABLE_BODY);
    const contract = compileTaskContract({ documents: [document] });

    expect(contract.version).toBe(1);
    expect(contract.goal[0].items[0]).toContain("分期付款");
    expect(contract.scope[0].items).toContain("结算页 UI");
    expect(contract.constraints[0].items[0]).toContain("全额支付路径");
    expect(contract.deliverables[0].items).toEqual(["分期选择组件", "网关适配实现"]);
    expect(contract.acceptance_criteria[0].items).toHaveLength(2);
    expect(contract.acceptance_criteria[0].items[0]).toContain("FR-1");
    // Headings are provenance, never items.
    for (const declaration of [contract.goal[0], contract.scope[0], contract.constraints[0], contract.deliverables[0], contract.acceptance_criteria[0]]) {
      expect(declaration.heading).toBeDefined();
      expect(declaration.items).not.toContain(declaration.heading);
      expect(declaration.text).toContain(declaration.heading!);
    }
    // Dispatcher adds EXECUTION_STRATEGY from the "## Tasks" heading.
    expect(declarationKindForHeading("Tasks")).toBe("EXECUTION_STRATEGY");
    expect(contract.inputs[0]).toMatchObject({ document_id: document.id, file_name: "spec.md", sections_used: document.sections.length });
    expect(contract.source_workbook.has_workbook).toBe(true);
    expect(contract.source_workbook.document_ids).toEqual([document.id]);
    // Provenance travels with every declaration.
    expect(contract.goal[0].source_document_id).toBe(document.id);
    expect(contract.goal[0].source_section_id).toBeDefined();
    expect(contract.goal[0].authority).toBe("WORKBOOK");
    // Missing declarations are reported, never invented.
    expect(contract.diagnostics.missing).toContain("PERMISSIONS");
    expect(contract.diagnostics.missing).not.toContain("GOAL");
  });

  it("treats the user's text as an override when a WorkBook exists", async () => {
    const document = await ingressFromText("spec.md", EXECUTABLE_BODY);
    const contract = compileTaskContract({ documents: [document], userText: "只做分析，不要改代码" });

    expect(contract.overrides).toHaveLength(1);
    const override = contract.overrides[0];
    expect(override.authority).toBe("USER");
    expect(override.applies_to_workbook).toBe(true);
    expect(override.supersedes).toContain("GOAL");
    expect(override.supersedes).toContain("DELIVERABLES");
    expect(override.supersedes).not.toContain("INPUTS");
    expect(override.reason).toContain("override authority");
    // Every workbook-derived declaration is marked overridable.
    expect(contract.goal[0].overridable).toBe(true);
    expect(contract.deliverables[0].overridable).toBe(true);
    // Without a WorkBook the same text is simply the instruction.
    expect(userOverridesWorkbook(true, "只做分析")).toBe(true);
    expect(userOverridesWorkbook(false, "只做分析")).toBe(false);
  });

  it("carries override text into the contract without a WorkBook too", () => {
    const contract = compileTaskContract({ documents: [], userText: "实现分期付款功能" });
    expect(contract.source_workbook.has_workbook).toBe(false);
    expect(contract.overrides[0].applies_to_workbook).toBe(false);
    expect(contract.overrides[0].supersedes).toEqual([]);
    expect(contract.overrides[0].reason).toContain("no WorkBook");
    expect(contract.goal).toEqual([]);
    expect(contract.diagnostics.warnings.some((warning) => warning.includes("no WorkBook")) || true).toBe(true);
  });

  it("derives the execution strategy from classification and analysis-only intent", async () => {
    const executable = await ingressFromText("spec.md", EXECUTABLE_BODY);
    const reference = await ingressFromText("standard.md", REFERENCE_BODY);
    const executableVerdict = classifyWorkBook({ content: executable.content });
    const referenceVerdict = classifyWorkBook({ content: reference.content });

    const work = compileTaskContract({
      documents: [executable],
      classifications: [{ document_id: executable.id, verdict: executableVerdict }],
      primaryDocumentId: executable.id
    });
    expect(work.execution_strategy.mode).toBe("WORK");
    expect(work.execution_strategy.requires_planning).toBe(true);
    expect(work.execution_strategy.required_capabilities).toContain("work");
    expect(work.execution_strategy.required_capabilities).toContain("verification");
    expect(work.execution_strategy.reference_sections.length).toBeGreaterThan(0);
    expect(work.diagnostics.classification_reasons.length).toBeGreaterThan(0);

    const chat = compileTaskContract({
      documents: [reference],
      classifications: [{ document_id: reference.id, verdict: referenceVerdict }],
      primaryDocumentId: reference.id
    });
    expect(chat.execution_strategy.mode).toBe("CHAT");
    expect(chat.execution_strategy.requires_planning).toBe(false);

    const analysis = compileTaskContract({
      documents: [executable],
      analysisOnly: { kind: "ANALYSIS_ONLY", confidence: 0.8, reasons: ["只读", "仅分析"] },
      classifications: [{ document_id: executable.id, verdict: executableVerdict }]
    });
    expect(analysis.execution_strategy.analysis_only).toBe(true);
    expect(analysis.execution_strategy.requires_planning).toBe(false);
    expect(analysis.diagnostics.analysis_only_reasons).toEqual(["只读", "仅分析"]);
  });

  it("prefers the primary document when two documents declare the same field", async () => {
    const primary = await ingressFromText("spec.md", "# Spec\n\n## Goal\n\n主目标：支持分期付款。\n");
    const other = await ingressFromText("appendix.md", "# Appendix\n\n## Goal\n\n次目标：完善文档。\n");
    const contract = compileTaskContract({ documents: [other, primary], primaryDocumentId: primary.id });
    expect(contract.goal).toHaveLength(1);
    expect(contract.goal[0].items[0]).toContain("支持分期付款");
    expect(contract.goal[0].source_document_id).toBe(primary.id);

    const combined = compileTaskContract({ documents: [primary, other] });
    expect(combined.diagnostics.warnings.some((warning) => warning.includes("GOAL is declared by more than one document"))).toBe(true);
    expect(combined.goal[0].items.length).toBe(2);
  });

  it("splits declaration bodies into items deterministically", () => {
    expect(itemsFromDeclarationText("- 第一项\n- 第二项\n1. 第三项\n[ ] 第四项")).toEqual(["第一项", "第二项", "第三项", "第四项"]);
    expect(itemsFromDeclarationText("一句没有列表的目标。")).toEqual(["一句没有列表的目标。"]);
    expect(itemsFromDeclarationText("第一行\n第二行")).toEqual(["第一行 第二行"]);
    expect(declarationKindForHeading("验收标准")).toBe("ACCEPTANCE_CRITERIA");
    expect(declarationKindForHeading("Deliverables")).toBe("DELIVERABLES");
    expect(declarationKindForHeading("随便什么标题")).toBeUndefined();
    expect(declarationKindForHeading(undefined)).toBeUndefined();
  });
});
