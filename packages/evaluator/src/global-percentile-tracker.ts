/**
 * GlobalPercentileTracker
 *
 * Maintains a sorted window of historical overall scores to compute the
 * percentile rank of a new score in O(log n) time via binary search.
 *
 * Backed by an in-memory sorted array; swap the backing store for Redis
 * sorted-sets when persistent cross-process tracking is required.
 */

export class GlobalPercentileTracker {
  private readonly scores: number[] = [];

  /**
   * Insert a score into the tracker and return the percentile rank
   * (0–100) of that score relative to all previously recorded scores.
   *
   * A percentile of 95 means the score beats 95 % of historical scores.
   */
  recordAndRank(score: number): number {
    const percentile = this.percentileOf(score);
    this.insert(score);
    return percentile;
  }

  /** Compute the percentile rank of `score` without inserting it. */
  percentileOf(score: number): number {
    if (this.scores.length === 0) return 100;

    const belowCount = this.lowerBound(score);
    return Math.round((belowCount / this.scores.length) * 100);
  }

  /** Total number of scores recorded. */
  get size(): number {
    return this.scores.length;
  }

  /** Insert score into the sorted array (binary-search insertion). */
  private insert(score: number): void {
    const pos = this.lowerBound(score);
    this.scores.splice(pos, 0, score);
  }

  /**
   * Return the index of the first element ≥ score (lower bound).
   * Equivalent to std::lower_bound in C++.
   */
  private lowerBound(score: number): number {
    let lo = 0;
    let hi = this.scores.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((this.scores[mid] as number) < score) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /**
   * Seed the tracker from an existing list of scores (e.g. on server startup).
   * The input does not need to be pre-sorted.
   */
  seed(historicalScores: number[]): void {
    this.scores.length = 0;
    this.scores.push(...[...historicalScores].sort((a, b) => a - b));
  }
}
