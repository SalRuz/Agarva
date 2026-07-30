/**
 * Simple uniform grid spatial hash for O(k) neighborhood queries.
 */
export class SpatialHash<T extends { x: number; y: number }> {
  private cellSize: number;
  private buckets = new Map<number, T[]>();

  constructor(cellSize: number) {
    this.cellSize = cellSize;
  }

  clear() {
    this.buckets.clear();
  }

  private key(cx: number, cy: number): number {
    // Perfect hash for reasonable grid coords
    return ((cx * 73856093) ^ (cy * 19349663)) >>> 0;
  }

  private cellCoord(v: number): number {
    return Math.floor(v / this.cellSize);
  }

  insert(item: T) {
    const cx = this.cellCoord(item.x);
    const cy = this.cellCoord(item.y);
    const k = this.key(cx, cy);
    let bucket = this.buckets.get(k);
    if (!bucket) {
      bucket = [];
      this.buckets.set(k, bucket);
    }
    bucket.push(item);
  }

  rebuild(items: T[]) {
    this.clear();
    for (const item of items) {
      this.insert(item);
    }
  }

  /** Query items near (x,y) within radius (+ one cell padding). */
  queryRadius(x: number, y: number, radius: number, out: T[] = []): T[] {
    out.length = 0;
    const r = radius + this.cellSize;
    const minCx = this.cellCoord(x - r);
    const maxCx = this.cellCoord(x + r);
    const minCy = this.cellCoord(y - r);
    const maxCy = this.cellCoord(y + r);
    const r2 = radius * radius;

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const bucket = this.buckets.get(this.key(cx, cy));
        if (!bucket) continue;
        for (const item of bucket) {
          const dx = item.x - x;
          const dy = item.y - y;
          if (dx * dx + dy * dy <= r2) {
            out.push(item);
          }
        }
      }
    }
    return out;
  }
}
