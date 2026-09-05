/**
 * Deterministic research statistics (plan 9-6 Phase 10). Pure and shareable.
 * Formal statistics are produced by deterministic code — the LLM only
 * interprets the numbers later. All functions are offline, seeded where random
 * (bootstrap), and unit-testable.
 */

export interface DescriptiveStats {
  n: number;
  mean: number;
  median: number;
  sd: number;
}

export function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : NaN;
}

export function median(values: number[]): number {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function standardDeviation(values: number[], sample = true): number {
  if (values.length < (sample ? 2 : 1)) return NaN;
  const average = mean(values);
  const squared = values.reduce((sum, value) => sum + (value - average) ** 2, 0);
  return Math.sqrt(squared / (sample ? values.length - 1 : values.length));
}

export function describe(values: number[]): DescriptiveStats {
  return { n: values.length, mean: mean(values), median: median(values), sd: standardDeviation(values) };
}

export interface ConfidenceInterval {
  lower: number;
  upper: number;
}

/** Normal-approximation CI (z=1.96 for 95%); deterministic. */
export function confidenceInterval(values: number[], z = 1.96): ConfidenceInterval {
  const stats = describe(values);
  if (stats.n < 2 || Number.isNaN(stats.sd)) return { lower: NaN, upper: NaN };
  const margin = z * (stats.sd / Math.sqrt(stats.n));
  return { lower: stats.mean - margin, upper: stats.mean + margin };
}

/** Deterministic LCG seedable PRNG (mulberry32) for bootstrap reproducibility. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bootstrap CI on the mean with a fixed seed (reproducible). */
export function bootstrapCi(values: number[], options: { seed?: number; samples?: number; alpha?: number } = {}): ConfidenceInterval {
  const seed = options.seed ?? 42;
  const samples = options.samples ?? 1000;
  const alpha = options.alpha ?? 0.05;
  if (values.length < 2) return { lower: NaN, upper: NaN };
  const random = mulberry32(seed);
  const means: number[] = [];
  for (let sample = 0; sample < samples; sample += 1) {
    let sum = 0;
    for (let index = 0; index < values.length; index += 1) sum += values[Math.floor(random() * values.length)];
    means.push(sum / values.length);
  }
  means.sort((a, b) => a - b);
  const lowerIndex = Math.max(0, Math.floor((alpha / 2) * samples));
  const upperIndex = Math.min(samples - 1, Math.ceil((1 - alpha / 2) * samples) - 1);
  return { lower: means[lowerIndex], upper: means[upperIndex] };
}

/** Cohen's d effect size (equal-n pooled). */
export function effectSize(left: number[], right: number[]): number {
  if (left.length < 2 || right.length < 2) return NaN;
  const pooled = Math.sqrt(((left.length - 1) * standardDeviation(left) ** 2 + (right.length - 1) * standardDeviation(right) ** 2) / (left.length + right.length - 2));
  if (pooled === 0) return NaN;
  return (mean(left) - mean(right)) / pooled;
}

/** Paired (sign-flip) permutation p-value: equal-n pairs, differences re-signed. */
function permutationPairedP(differences: number[], options: { seed?: number; permutations?: number }): number {
  const permutations = options.permutations ?? 5000;
  const random = mulberry32(options.seed ?? 7);
  const observed = Math.abs(mean(differences));
  let extreme = 0;
  for (let permutation = 0; permutation < permutations; permutation += 1) {
    // Each difference is kept or flipped with equal probability (deterministic
    // via the seeded PRNG) — a paired permutation test.
    let sum = 0;
    for (const difference of differences) sum += random() < 0.5 ? difference : -difference;
    if (Math.abs(sum / differences.length) >= observed) extreme += 1;
  }
  return (extreme + 1) / (permutations + 1);
}

/**
 * Paired/unpaired comparison p-value via permutation test (seedable,
 * deterministic). Paired requires equal-length samples and flips the signs of
 * the within-pair differences; unpaired repartitions the pooled groups.
 */
export function permutationP(left: number[], right: number[], options: { seed?: number; permutations?: number; paired?: boolean } = {}): number {
  const permutations = options.permutations ?? 5000;
  if (left.length < 2 || right.length < 2) return NaN;
  if (options.paired) {
    if (left.length !== right.length) return NaN;
    const differences = left.map((value, index) => value - right[index]);
    return permutationPairedP(differences, { seed: options.seed, permutations });
  }
  const random = mulberry32(options.seed ?? 7);
  const observed = Math.abs(mean(left) - mean(right));
  const combined = [...left, ...right];
  let extreme = 0;
  for (let permutation = 0; permutation < permutations; permutation += 1) {
    // Fisher–Yates shuffle over the combined pool.
    for (let index = combined.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(random() * (index + 1));
      [combined[index], combined[swap]] = [combined[swap], combined[index]];
    }
    const split = combined.slice(0, left.length);
    const rest = combined.slice(left.length);
    if (Math.abs(mean(split) - mean(rest)) >= observed) extreme += 1;
  }
  return (extreme + 1) / (permutations + 1);
}

export function proportion(value: number, of: number): number {
  return of > 0 ? value / of : NaN;
}
