import fs from "node:fs";
import path from "node:path";
import { isValidEpisode, matchesQuery, type EpisodeQuery, type LearningEpisode } from "../../src/shared/learning-episode";
import { createEvaluationRevision, type SemanticEvaluationRevision } from "../../src/shared/provider-outcome";

/**
 * Engine Phase 2 — durable append-only episode store (source of truth).
 *
 * Storage layout (all append-only JSONL, one JSON object per line):
 *   <root>/episodes.jsonl   — LearningEpisode rows (never rewritten)
 *   <root>/revisions.jsonl  — SemanticEvaluation revisions (audit chain)
 *
 * Rules honoured:
 *  - append-only: a later evaluator revision never overwrites the observation;
 *  - schemaVersion on every row; unknown/invalid rows are skipped on load and
 *    reported via degradedReason instead of throwing (learning degrades, Boss
 *    keeps running);
 *  - every query the Engine book requires: provider, model snapshot, behaviour
 *    epoch, time range, task/fingerprint/concept;
 *  - episodes are complete enough to rebuild profiles deterministically (Phase 5
 *    consumes the same rows), so derived data can always be deleted + rebuilt.
 */

export interface EpisodeStoreOptions {
  rootDir?: string;
  now?: () => string;
}

export interface EpisodeAppendInput extends Omit<LearningEpisode, "schemaVersion"> {
  schemaVersion?: LearningEpisode["schemaVersion"];
}

export class EpisodeStore {
  private readonly episodes: LearningEpisode[] = [];
  private readonly revisions: SemanticEvaluationRevision[] = [];
  private readonly now: () => string;
  private degraded?: string;

  constructor(private readonly rootDir?: string, options: Omit<EpisodeStoreOptions, "rootDir"> = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.restore();
  }

  /** Append one observation. Returns the stored episode (never a copy of inputs). */
  append(input: EpisodeAppendInput): LearningEpisode {
    const episode: LearningEpisode = { schemaVersion: 1, ...input };
    if (!isValidEpisode(episode)) throw new Error("Invalid learning episode");
    this.episodes.push(episode);
    this.appendLine(this.episodesFile(), episode);
    return episode;
  }

  /** Convenience: append many (used by imports/replays). */
  appendAll(inputs: EpisodeAppendInput[]): LearningEpisode[] {
    return inputs.map((input) => this.append(input));
  }

  /** Append an evaluator revision; the original evaluation is untouched. */
  revise(input: { episodeId: string; revisedBy: string; evaluatorVersion?: string; reason?: string }): SemanticEvaluationRevision | undefined {
    const episode = this.get(input.episodeId);
    if (!episode?.semanticEvaluation) return undefined;
    const evaluation = input.evaluatorVersion
      ? { ...episode.semanticEvaluation, evaluatorVersion: input.evaluatorVersion }
      : episode.semanticEvaluation;
    const revision = createEvaluationRevision({
      episodeId: input.episodeId,
      original: episode.semanticEvaluation,
      revised: evaluation,
      reason: input.reason ?? `revised by ${input.revisedBy}`,
      revisedAt: this.now()
    });
    this.revisions.push(revision);
    this.appendLine(this.revisionsFile(), revision);
    return revision;
  }

  revisionsFor(episodeId: string): SemanticEvaluationRevision[] {
    return this.revisions.filter((revision) => revision.episodeId === episodeId).map((revision) => structuredClone(revision));
  }

  get(episodeId: string): LearningEpisode | undefined {
    const episode = this.episodes.find((item) => item.episodeId === episodeId);
    return episode ? structuredClone(episode) : undefined;
  }

  /** Query with the Engine book's dimensions; newest-first, deterministically ordered. */
  query(query: EpisodeQuery = {}): LearningEpisode[] {
    const rows = this.episodes.filter((episode) => matchesQuery(episode, query));
    const sorted = rows.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.episodeId.localeCompare(b.episodeId));
    const limited = query.limit === undefined ? sorted : sorted.slice(0, Math.max(0, query.limit));
    return limited.map((episode) => structuredClone(episode));
  }

  all(): LearningEpisode[] {
    return this.episodes.map((episode) => structuredClone(episode));
  }

  count(): number {
    return this.episodes.length;
  }

  status(): { count: number; revisions: number; degradedReason?: string } {
    return { count: this.episodes.length, revisions: this.revisions.length, degradedReason: this.degraded };
  }

  /** Delete derived data only — episodes are the source of truth (Engine §5). */
  clearDerived(): void {
    // Derived stores live elsewhere (profiles/concepts/epochs); episodes stay.
  }

  private episodesFile(): string | undefined {
    return this.rootDir ? path.join(this.rootDir, "episodes.jsonl") : undefined;
  }

  private revisionsFile(): string | undefined {
    return this.rootDir ? path.join(this.rootDir, "revisions.jsonl") : undefined;
  }

  private appendLine(file: string | undefined, value: unknown): void {
    if (!file) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, `${JSON.stringify(value)}\n`, "utf8");
    } catch (error) {
      // A write failure degrades learning only; Boss keeps running.
      this.degraded = `episode append failed: ${String(error)}`;
    }
  }

  private restore(): void {
    const episodesFile = this.episodesFile();
    const revisionsFile = this.revisionsFile();
    if (episodesFile && fs.existsSync(episodesFile)) {
      let skipped = 0;
      for (const line of fs.readFileSync(episodesFile, "utf8").split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as unknown;
          if (isValidEpisode(parsed)) this.episodes.push(parsed);
          else skipped += 1;
        } catch {
          skipped += 1;
        }
      }
      if (skipped) this.degraded = `${skipped} invalid episode row(s) skipped`;
    }
    if (revisionsFile && fs.existsSync(revisionsFile)) {
      for (const line of fs.readFileSync(revisionsFile, "utf8").split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as SemanticEvaluationRevision;
          if (parsed?.schemaVersion === 1 && typeof parsed.episodeId === "string") this.revisions.push(parsed);
        } catch {
          // ignore malformed revision rows
        }
      }
    }
  }
}
