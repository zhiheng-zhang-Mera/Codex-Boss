import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { readJson, writeJson, validId } from "../../commander/durable-json";

/**
 * Research evidence graph + primary-run records (plan 9-6 Phase 10). Each
 * primary experiment run saves a provenance record (protocol hash, git commit,
 * dirty state, command/args, seed, input/output/stdout hashes, metrics,
 * duration, timestamp) and evidence graph edges
 * (RQ → Hypothesis → Protocol → Experiment → Run → Metric → Statistic →
 * Claim → Figure/Table → Paper Sentence). Deterministic + durable.
 */

export interface PrimaryRunRecord {
  runId: string;
  experimentId: string;
  protocolHash: string;
  gitCommit: string;
  gitDirty: boolean;
  command: string[];
  environmentFingerprint: string;
  dependencyLockHash: string;
  seed: number;
  inputHashes: string[];
  outputHash: string;
  stdoutStderrHash: string;
  metrics: Record<string, number>;
  durationMs: number;
  hardware: string;
  timestamp: string;
  /** True when the process completed successfully (exit 0 + expected markers); absent = legacy default true. */
  passed?: boolean;
}

export type EvidenceNodeKind = "research-question" | "hypothesis" | "protocol" | "experiment" | "run" | "metric" | "statistic" | "claim" | "figure-table" | "paper-sentence";

export interface EvidenceNode {
  id: string;
  kind: EvidenceNodeKind;
  label: string;
}

export interface EvidenceEdge {
  from: string;
  to: string;
}

export interface EvidenceGraphFile {
  schemaVersion: 1;
  nodes: EvidenceNode[];
  edges: EvidenceEdge[];
}

export class EvidenceGraph {
  constructor(private readonly root: string) {}

  addRun(id: string, record: PrimaryRunRecord): void {
    const file = this.read(id);
    file.nodes.push({ id: `run:${record.runId}`, kind: "run", label: `run ${record.runId}` });
    file.edges.push({ from: `experiment:${record.experimentId}`, to: `run:${record.runId}` });
    this.write(id, file);
    this.writeRun(id, record);
  }

  addNode(id: string, node: EvidenceNode): void {
    const file = this.read(id);
    if (!file.nodes.some((item) => item.id === node.id)) file.nodes.push(node);
    this.write(id, file);
  }

  /**
   * Idempotently materializes the head of the plan's evidence chain
   * (Question → Hypothesis → Protocol → Experiment) so no edge ever dangles:
   * `addRun` writes `experiment:<exp> → run:<run>` edges, so this guarantees the
   * experiment node exists, plus question/hypothesis/protocol anchors from the
   * run IR. Run → statistic/claim/figure/paper links are added by the analyzer /
   * figure / paper-section recorders.
   */
  syncChain(id: string, input: { questions: string[]; hypotheses: string[]; protocolHash?: string; experimentIds: string[] }): void {
    const questionNodes = input.questions.map((_, index) => `question:q${index}`);
    const hypothesisNodes = input.hypotheses.map((_, index) => `hypothesis:h${index}`);
    for (const nodeId of questionNodes) this.addNode(id, { id: nodeId, kind: "research-question", label: nodeId });
    for (const nodeId of hypothesisNodes) this.addNode(id, { id: nodeId, kind: "hypothesis", label: nodeId });
    for (let index = 0; index < Math.min(questionNodes.length, hypothesisNodes.length); index += 1) {
      this.addEdge(id, questionNodes[index], hypothesisNodes[index]);
    }
    if (input.protocolHash) {
      const protocolId = `protocol:${input.protocolHash.slice(0, 16)}`;
      this.addNode(id, { id: protocolId, kind: "protocol", label: input.protocolHash });
      for (const nodeId of hypothesisNodes) this.addEdge(id, nodeId, protocolId);
      for (const experimentId of input.experimentIds) {
        const experimentNode = `experiment:${experimentId}`;
        this.addNode(id, { id: experimentNode, kind: "experiment", label: experimentId });
        this.addEdge(id, protocolId, experimentNode);
      }
    }
  }

  addEdge(id: string, from: string, to: string): void {
    const file = this.read(id);
    if (!file.edges.some((edge) => edge.from === from && edge.to === to)) file.edges.push({ from, to });
    this.write(id, file);
  }

  /**
   * Registers a figure-table node (round 22) bound to the source run/metric
   * evidence nodes it plots, so a paper figure is traceable to the recorded
   * runs that produced it (plan chain … Run → Metric → Statistic → Claim →
   * Figure/Table → Paper Sentence).
   */
  addFigure(id: string, figureId: string, sourceNodeIds: string[], label = `figure ${figureId}`): string {
    const nodeId = `figure:${figureId}`;
    this.addNode(id, { id: nodeId, kind: "figure-table", label });
    for (const source of sourceNodeIds) this.addEdge(id, source, nodeId);
    return nodeId;
  }

  /**
   * Registers one paper-sentence node per manuscript section (round 28),
   * completing the plan chain: the section asserts its claims and illustrates
   * its figures, so every paper statement is traceable to the evidence nodes
   * behind it (Claim / Figure/Table → Paper Sentence). Deterministic — the
   * section is a real manuscript section recorded after assembly.
   */
  addPaperSection(id: string, sectionId: string, input: { claimNodeIds?: string[]; figureNodeIds?: string[] }, label = `paper ${sectionId}`): string {
    const nodeId = `paper:${sectionId}`;
    this.addNode(id, { id: nodeId, kind: "paper-sentence", label });
    for (const claim of input.claimNodeIds ?? []) this.addEdge(id, claim, nodeId);
    for (const figure of input.figureNodeIds ?? []) this.addEdge(id, figure, nodeId);
    return nodeId;
  }

  runs(id: string): PrimaryRunRecord[] {
    const dir = this.dir(id);
    return fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.startsWith("run-") && name.endsWith(".json")).map((name) => readJson<PrimaryRunRecord>(path.join(dir, name))!).filter(Boolean) : [];
  }

  graph(id: string): EvidenceGraphFile {
    return this.read(id);
  }

  static hashText(text: string): string {
    return createHash("sha256").update(text, "utf8").digest("hex");
  }

  private read(id: string): EvidenceGraphFile {
    const value = readJson<Partial<EvidenceGraphFile>>(this.graphPath(id));
    if (!value) return { schemaVersion: 1, nodes: [], edges: [] };
    if (value.schemaVersion !== 1 || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) throw new Error("Invalid evidence graph");
    return { schemaVersion: 1, nodes: value.nodes, edges: value.edges };
  }

  private write(id: string, file: EvidenceGraphFile): void {
    writeJson(this.graphPath(id), file);
  }

  private writeRun(id: string, record: PrimaryRunRecord): void {
    writeJson(path.join(this.dir(id), `run-${validId(record.runId)}.json`), record);
  }

  private dir(id: string): string {
    const safe = validId(id);
    fs.mkdirSync(path.join(this.root, safe), { recursive: true });
    return path.join(this.root, safe);
  }

  private graphPath(id: string): string {
    return path.join(this.dir(id), "evidence-graph.json");
  }
}
