/** Undrawn squares whose parent is drawn, each with a fixed queue weight. */
export class Frontier {
  private weights = new Map<string, number>();
  private total = 0;

  get size() { return this.weights.size; }
  has(k: string) { return this.weights.has(k); }
  keys() { return this.weights.keys(); }

  add(k: string, weight: number) {
    this.delete(k);
    this.weights.set(k, weight);
    this.total += weight;
  }

  delete(k: string) {
    const w = this.weights.get(k);
    if (w === undefined) return;
    this.weights.delete(k);
    this.total -= w;
    if (this.weights.size === 0) this.total = 0; // no float drift on an empty set
  }

  /** Weighted random pick, skipping `exclude`. A linear scan: fine below ~100k squares. */
  pick(rand: () => number, exclude: Set<string> = new Set()): string | null {
    let total = this.total, fallback: string | null = null;
    for (const k of exclude) total -= this.weights.get(k) ?? 0;
    let r = rand() * total;
    for (const [k, w] of this.weights) {
      if (exclude.has(k)) continue;
      if (fallback === null) fallback = k;
      if (w <= 0) continue;
      r -= w;
      if (r < 0) return k;
    }
    // Float rounding or all-zero weights: take the last positive one, else any.
    for (const [k, w] of [...this.weights].reverse()) if (!exclude.has(k) && w > 0) return k;
    return fallback;
  }
}
