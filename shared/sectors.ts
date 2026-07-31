/** 5×5 map sectors: A1–A5 … E1–E5 (rows A–E top→bottom, cols 1–5 left→right) */

export const SECTOR_COLS = 5;
export const SECTOR_ROWS = 5;
export const SECTOR_ROW_LABELS = ['A', 'B', 'C', 'D', 'E'] as const;

export interface SectorCoord {
  row: number;
  col: number;
}

function clampIndex(v: number, max: number): number {
  if (v < 0) return 0;
  if (v > max) return max;
  return v;
}

export function getSectorSize(worldW: number, worldH: number): { sw: number; sh: number } {
  return { sw: worldW / SECTOR_COLS, sh: worldH / SECTOR_ROWS };
}

export function getSectorAt(x: number, y: number, worldW: number, worldH: number): SectorCoord {
  const { sw, sh } = getSectorSize(worldW, worldH);
  return {
    col: clampIndex(Math.floor(x / sw), SECTOR_COLS - 1),
    row: clampIndex(Math.floor(y / sh), SECTOR_ROWS - 1),
  };
}

export function getSectorLabel(row: number, col: number): string {
  const letter = SECTOR_ROW_LABELS[clampIndex(row, SECTOR_ROWS - 1)] ?? 'A';
  return `${letter}${clampIndex(col, SECTOR_COLS - 1) + 1}`;
}

export function getSectorLabelAt(x: number, y: number, worldW: number, worldH: number): string {
  const s = getSectorAt(x, y, worldW, worldH);
  return getSectorLabel(s.row, s.col);
}

/**
 * Entity draw/sync FOV: same reach as old "1 sector + 70% neighbors",
 * but as a circle that follows the player (not grid-locked).
 * Default mult 1.2 ≈ sectorSize × (0.5 + 0.7).
 * Sector contribution is capped so large maps (20k+) don't explode
 * bandwidth/CPU while keeping ~classic 15k FOV feel.
 */
export function getEntityViewRadius(
  worldW: number,
  worldH: number,
  mult: number = 1.2
): number {
  const { sw, sh } = getSectorSize(worldW, worldH);
  const sector = Math.min(Math.max(sw, sh), 3200);
  return sector * Math.max(0.05, mult);
}

export function isWithinViewRadius(
  x: number,
  y: number,
  cx: number,
  cy: number,
  viewR: number
): boolean {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= viewR * viewR;
}

/**
 * True if a circular entity intersects the view circle
 * (center may be outside FOV, but the blob edge still peeks in).
 */
export function isEntityNearView(
  x: number,
  y: number,
  radius: number,
  cx: number,
  cy: number,
  viewR: number
): boolean {
  const dx = x - cx;
  const dy = y - cy;
  const limit = viewR + Math.max(0, radius);
  return dx * dx + dy * dy <= limit * limit;
}

/**
 * Visible if in viewer's full sector, or in the nearest 70% of an adjacent sector
 * that faces the viewer (including diagonal quarters).
 * @deprecated Prefer getEntityViewRadius + isWithinViewRadius for gameplay FOV.
 */
export function isVisibleFromSector(
  x: number,
  y: number,
  viewer: SectorCoord,
  worldW: number,
  worldH: number
): boolean {
  const { sw, sh } = getSectorSize(worldW, worldH);
  const col = clampIndex(Math.floor(x / sw), SECTOR_COLS - 1);
  const row = clampIndex(Math.floor(y / sh), SECTOR_ROWS - 1);
  const dRow = row - viewer.row;
  const dCol = col - viewer.col;

  if (dRow === 0 && dCol === 0) return true;
  if (Math.abs(dRow) > 1 || Math.abs(dCol) > 1) return false;

  const localX = x - col * sw;
  const localY = y - row * sh;
  /** Fraction of neighbor sector that is visible (toward the viewer) */
  const visibleFrac = 0.7;
  const hiddenStart = visibleFrac; // for positive direction neighbors
  const hiddenEnd = 1 - visibleFrac; // for negative direction neighbors

  if (dCol === 1 && localX >= sw * hiddenStart) return false;
  if (dCol === -1 && localX < sw * hiddenEnd) return false;
  if (dRow === 1 && localY >= sh * hiddenStart) return false;
  if (dRow === -1 && localY < sh * hiddenEnd) return false;

  return true;
}

/** True if any of the points is in sector visibility. */
export function anyPointVisibleFromSector(
  points: Array<{ x: number; y: number }>,
  viewer: SectorCoord,
  worldW: number,
  worldH: number
): boolean {
  for (const p of points) {
    if (isVisibleFromSector(p.x, p.y, viewer, worldW, worldH)) return true;
  }
  return false;
}
