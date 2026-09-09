import fs from "node:fs";
import path from "node:path";
import { writeJson, readJson, validId } from "../commander/durable-json";
import type { ReviewRound } from "../../src/shared/research-review";

/** Durable per-run review rounds (R-703). */
export class ReviewRoundStore {
  constructor(private readonly root: string) {}

  save(runId: string, round: ReviewRound): ReviewRound {
    const dir = path.join(this.root, validId(runId));
    fs.mkdirSync(dir, { recursive: true });
    writeJson(path.join(dir, `review-round-${validId(round.roundId)}.json`), round);
    return round;
  }

  load(runId: string): ReviewRound[] {
    const dir = path.join(this.root, validId(runId));
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((name) => name.startsWith("review-round-") && name.endsWith(".json")).sort().map((name) => {
      const value = readJson<Partial<ReviewRound>>(path.join(dir, name));
      if (!value || typeof value.roundId !== "string") throw new Error("Invalid review round");
      return value as ReviewRound;
    });
  }
}
