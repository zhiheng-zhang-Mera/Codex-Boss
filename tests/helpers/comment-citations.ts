import fs from "node:fs";
import path from "node:path";

/**
 * Phase Q's measurement: which comments cite a section number, and can a reader resolve it?
 *
 * The book's requirement is "no stale or plan-number-dependent comments", and the honest state of
 * this repository is that it has a large amount of the second kind: most of the section numbers in
 * comments point at supplied plan/convergence documents that are **not tracked here** ("plan §9",
 * "U6 §12.1", "Engine §18", "convergence book, Phase M"), so a reader of the code cannot look them
 * up. The policy that follows from that is the one the modules touched in this round already
 * follow: state the rule, or name a document that is in the repository.
 *
 * This helper counts both kinds so the debt can be frozen and reduced:
 *
 *   qualified   the same comment names a document (`*.md`), so the number has a referent here
 *   bare        the number stands alone, and nothing in the repository says what it means
 *
 * Limitation, stated rather than hidden: comments are found by scanning for `//` and `/*` without
 * parsing string literals, so a `//` inside a string can be reported as a comment. A hit that is not
 * really a comment costs one look; it cannot hide a real citation, because those live in comments.
 */

export interface Citation {
  file: string;
  line: number;
  text: string;
  qualified: boolean;
}

export interface CommentCitations {
  files: number;
  comments: number;
  citations: Citation[];
  bareByFile: Record<string, number>;
  bareTotal: number;
}

const DIRS = ["electron", "src", "scripts"];
const EXTENSIONS = [".ts", ".tsx", ".cjs", ".mjs", ".js"];
const CITATION = /§\s?\d+|section \d+(\.\d+)?/gi;

function walk(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (EXTENSIONS.includes(path.extname(entry.name))) out.push(full);
  }
  return out;
}

/** Line and block comments with their starting line. */
export function commentsOf(text: string): Array<{ line: number; text: string }> {
  const found: Array<{ line: number; text: string }> = [];
  const lines = text.split("\n");
  let inBlock = false;
  let blockStart = 0;
  let buffer: string[] = [];
  lines.forEach((line, index) => {
    if (inBlock) {
      buffer.push(line);
      if (line.includes("*/")) {
        found.push({ line: blockStart + 1, text: buffer.join("\n") });
        inBlock = false;
        buffer = [];
      }
      return;
    }
    const blockOpen = line.indexOf("/*");
    if (blockOpen >= 0) {
      if (line.includes("*/", blockOpen + 2)) {
        found.push({ line: index + 1, text: line.slice(blockOpen) });
      } else {
        inBlock = true;
        blockStart = index;
        buffer = [line.slice(blockOpen)];
      }
      const before = line.slice(0, blockOpen);
      const lineComment = before.indexOf("//");
      if (lineComment >= 0) found.push({ line: index + 1, text: before.slice(lineComment) });
      return;
    }
    const lineComment = line.indexOf("//");
    if (lineComment >= 0) found.push({ line: index + 1, text: line.slice(lineComment) });
  });
  return found;
}

export function scanCommentCitations(repoRoot: string): CommentCitations {
  const citations: Citation[] = [];
  const bareByFile: Record<string, number> = {};
  let files = 0;
  let comments = 0;

  for (const dir of DIRS) {
    for (const absolute of walk(path.join(repoRoot, dir))) {
      let text = "";
      try {
        text = fs.readFileSync(absolute, "utf8");
      } catch {
        continue;
      }
      files += 1;
      const relative = path.relative(repoRoot, absolute).split(path.sep).join("/");
      for (const comment of commentsOf(text)) {
        comments += 1;
        CITATION.lastIndex = 0;
        if (!CITATION.test(comment.text)) continue;
        // A citation is resolvable when the comment names a document that lives in this repository.
        const qualified = /\.md\b/.test(comment.text);
        citations.push({ file: relative, line: comment.line, text: comment.text.replace(/\s+/g, " ").trim().slice(0, 200), qualified });
        if (!qualified) bareByFile[relative] = (bareByFile[relative] ?? 0) + 1;
      }
    }
  }

  const bareTotal = Object.values(bareByFile).reduce((total, count) => total + count, 0);
  return { files, comments, citations, bareByFile, bareTotal };
}
