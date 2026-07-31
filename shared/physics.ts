import type { Position, Cell, Player, Food, Virus, BotBehavior, EjectedMass } from './types';
import {
  WORLD_WIDTH,
  WORLD_HEIGHT,
  ADMIN_NAMES,
} from './constants';
import { defaultGameplayConfig, type GameplayConfig } from './gameConfig';

export function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

export function randomColor(): string {
  const colors = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
    '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
    '#F8B500', '#FF6F61', '#6B5B95', '#88B04B', '#F7CAC9',
    '#92A8D1', '#955251', '#B565A7', '#009B77', '#DD4124'
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

export function distance(a: Position, b: Position): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

/** Classic-style mass = size² / 100 (size ≈ radius) */
export function getMass(radius: number): number {
  return (radius * radius) / 100;
}

export function getRadius(mass: number): number {
  return Math.sqrt(Math.max(0, mass) * 100);
}

export function getFoodRadius(config: GameplayConfig = defaultGameplayConfig): number {
  return getRadius(config.foodMass);
}

/**
 * Restored classic agar base (8.5/r^0.439) for size ordering.
 * Slowdown-with-growth is SPEED_PROGRESSION_SOFTEN× gentler; small cells boosted;
 * at max mass (22.5k) speed approaches SPEED_MIN; then ×SPEED_GLOBAL_MULT.
 */
export function getSpeed(radius: number, config: GameplayConfig = defaultGameplayConfig): number {
  const r = Math.max(radius, 1);
  const rRef = Math.max(getRadius(config.initialMass), 1);
  const rMax = Math.max(getRadius(config.maxCellMass), rRef + 1);
  const classic = (rr: number) => config.speedCoeff * Math.pow(rr, -config.speedExponent);
  const c = classic(r);
  const cRef = classic(rRef);
  const cMax = classic(rMax);
  const t = Math.min(1, Math.max(0, (cRef - c) / Math.max(cRef - cMax, 1e-6)));
  const softExp = config.speedExponent / config.speedProgressionSoften;
  const spawnSpeed = cRef * config.speedSmallBoost;
  const softSpeed = spawnSpeed * Math.pow(rRef / r, softExp);
  const base = Math.max(config.speedMin, softSpeed * (1 - t) + config.speedMin * t);
  return base * config.speedGlobalMult;
}

/** FOV grows with player size so large cells see food/W farther away. */
export function getPlayerViewRadius(
  player: Player | undefined | null,
  config: GameplayConfig = defaultGameplayConfig
): number {
  if (!player || player.cells.length === 0) return config.foodViewRadius;
  let sumR = 0;
  let maxR = 0;
  for (const cell of player.cells) {
    sumR += cell.radius;
    if (cell.radius > maxR) maxR = cell.radius;
  }
  return Math.min(
    config.foodViewMax,
    config.foodViewRadius + sumR * config.foodViewPerSumRadius + maxR * config.foodViewPerMaxRadius
  );
}

export function isAdminName(name: string): boolean {
  const n = name.trim().toLowerCase();
  return (ADMIN_NAMES as readonly string[]).some((a) => a.toLowerCase() === n);
}

/** Bounce circle entity off world bounds (ricochet). */
export function bounceOffWalls(
  obj: { x: number; y: number; radius: number; velocityX: number; velocityY: number; dirX?: number; dirY?: number },
  worldW: number,
  worldH: number
) {
  const r = Math.max(obj.radius, 1);
  if (obj.x < r) {
    obj.x = r;
    obj.velocityX = Math.abs(obj.velocityX);
    if (obj.dirX !== undefined) obj.dirX = Math.abs(obj.dirX);
  } else if (obj.x > worldW - r) {
    obj.x = worldW - r;
    obj.velocityX = -Math.abs(obj.velocityX);
    if (obj.dirX !== undefined) obj.dirX = -Math.abs(obj.dirX);
  }
  if (obj.y < r) {
    obj.y = r;
    obj.velocityY = Math.abs(obj.velocityY);
    if (obj.dirY !== undefined) obj.dirY = Math.abs(obj.dirY);
  } else if (obj.y > worldH - r) {
    obj.y = worldH - r;
    obj.velocityY = -Math.abs(obj.velocityY);
    if (obj.dirY !== undefined) obj.dirY = -Math.abs(obj.dirY);
  }
}

export function getMergeTimeMs(mass: number, config: GameplayConfig = defaultGameplayConfig): number {
  // Classic: 30s + 0.02×mass seconds
  return config.mergeBaseMs + mass * config.mergeMassFactor;
}

export function getTotalMass(player: Player): number {
  return player.cells.reduce((sum, cell) => sum + getMass(cell.radius), 0);
}

export function getPlayerCenter(player: Player): Position {
  if (player.cells.length === 0) return { x: 0, y: 0 };
  const totalMass = getTotalMass(player);
  if (totalMass <= 0) {
    return { x: player.cells[0].x, y: player.cells[0].y };
  }
  let cx = 0;
  let cy = 0;
  for (const cell of player.cells) {
    const mass = getMass(cell.radius);
    cx += cell.x * mass;
    cy += cell.y * mass;
  }
  return { x: cx / totalMass, y: cy / totalMass };
}

/**
 * Eat when eater is strictly heavier than target × EAT_MASS_MULT
 * (750 vs 950 equal; 951 eats 750) and covers > EAT_COVERAGE of target.
 */
export function canEat(
  eater: Cell,
  target: { x: number; y: number; radius: number; visualRadius?: number },
  config: GameplayConfig = defaultGameplayConfig
): boolean {
  const eaterMass = getMass(eater.radius);
  const targetMass = getMass(target.radius);
  // Strict >: at exact 950/750 ratio cells are "equal" and cannot eat
  if (!(eaterMass > targetMass * config.eatMassMult)) return false;
  return coversCell(eater, target, config.eatCoverage);
}

/**
 * True if this much of the smaller disk is visually inside the larger.
 * visualFraction 0.7 ≈ "more than half / ~70% inside" along the center line:
 *   fraction ≈ (larger.r - dist + smaller.r) / (2 * smaller.r)
 * (Old bug: treated 0.7 as center-depth coeff, which forced nearly full overlap.)
 */
export function coversCell(
  larger: { x: number; y: number; radius: number },
  smaller: { x: number; y: number; radius: number },
  visualFraction: number = defaultGameplayConfig.eatCoverage
): boolean {
  const dist = distance(larger, smaller);
  const sr = Math.max(smaller.radius, 1e-6);
  const fractionInside = (larger.radius - dist + sr) / (2 * sr);
  return fractionInside > visualFraction;
}

export function canEatEjectedMass(
  cell: Cell,
  mass: EjectedMass,
  config: GameplayConfig = defaultGameplayConfig
): boolean {
  if (getMass(cell.radius) < config.ejectPickupMinMass) return false;
  // Require W mostly inside the cell so it doesn't vanish on contact
  return coversCell(cell, mass, config.ejectPickupCoverage);
}

export function clampMass(mass: number, config: GameplayConfig = defaultGameplayConfig): number {
  return Math.min(mass, config.maxCellMass);
}

/** Updates logical radius; visualRadius eases separately for smooth stretch. */
export function applyMass(cell: Cell, mass: number, config: GameplayConfig = defaultGameplayConfig) {
  const capped = clampMass(mass, config);
  cell.radius = getRadius(capped);
  cell.targetRadius = cell.radius;
}

export function lineCircleIntersect(
  x1: number, y1: number,
  x2: number, y2: number,
  cx: number, cy: number,
  r: number
): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const fx = x1 - cx;
  const fy = y1 - cy;

  const a = dx * dx + dy * dy;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - r * r;

  if (a === 0) {
    return Math.sqrt(fx * fx + fy * fy) < r;
  }

  let discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return false;

  discriminant = Math.sqrt(discriminant);
  const t1 = (-b - discriminant) / (2 * a);
  const t2 = (-b + discriminant) / (2 * a);

  return (t1 >= 0 && t1 <= 1) || (t2 >= 0 && t2 <= 1) || (t1 < 0 && t2 > 1);
}

export function getVirusColor(charge: number): { fill: string; stroke: string } {
  const hue = 120 * (1 - charge / 7);
  const fill = `hsl(${hue}, 80%, 50%)`;
  const stroke = `hsl(${hue}, 80%, 35%)`;
  return { fill, stroke };
}

export function distributeVirusPopMass(totalMass: number, newCellCount: number): number[] {
  if (newCellCount <= 0) return [];

  const hasLarge = newCellCount >= 1;
  const hasMedium = newCellCount >= 2;
  const hasSmallMedium1 = newCellCount >= 3;
  const hasSmallMedium2 = newCellCount >= 4;
  const tinyCount = Math.max(0, newCellCount - 4);

  const totalUnits =
    (hasLarge ? 8 : 0) +
    (hasMedium ? 4 : 0) +
    (hasSmallMedium1 ? 2 : 0) +
    (hasSmallMedium2 ? 2 : 0) +
    tinyCount;

  const unitMass = totalMass / totalUnits;
  const masses: number[] = [];
  if (hasLarge) masses.push(8 * unitMass);
  if (hasMedium) masses.push(4 * unitMass);
  if (hasSmallMedium1) masses.push(2 * unitMass);
  if (hasSmallMedium2) masses.push(2 * unitMass);
  for (let i = 0; i < tinyCount; i++) {
    masses.push(unitMass);
  }
  return masses;
}

export function createFood(
  count: number,
  worldW: number = WORLD_WIDTH,
  worldH: number = WORLD_HEIGHT,
  config: GameplayConfig = defaultGameplayConfig
): Food[] {
  const food: Food[] = [];
  const r = getFoodRadius(config);
  for (let i = 0; i < count; i++) {
    food.push({
      id: generateId(),
      x: Math.random() * worldW,
      y: Math.random() * worldH,
      radius: r,
      color: randomColor()
    });
  }
  return food;
}

export function createVirus(
  count: number,
  existingViruses: Virus[] = [],
  worldW: number = WORLD_WIDTH,
  worldH: number = WORLD_HEIGHT,
  avoidPlayers: Player[] = [],
  config: GameplayConfig = defaultGameplayConfig
): Virus[] {
  const viruses: Virus[] = [...existingViruses];
  const r = getRadius(config.virusMass);
  const margin = 8;

  const overlapsPlayer = (x: number, y: number) => {
    for (const p of avoidPlayers) {
      for (const cell of p.cells) {
        if (distance({ x, y }, cell) < cell.radius + r + margin) return true;
      }
    }
    return false;
  };

  for (let i = 0; i < count; i++) {
    let x = Math.random() * worldW;
    let y = Math.random() * worldH;
    for (let attempt = 0; attempt < 50; attempt++) {
      x = r + Math.random() * Math.max(1, worldW - 2 * r);
      y = r + Math.random() * Math.max(1, worldH - 2 * r);
      if (!overlapsPlayer(x, y)) break;
    }
    // If still overlapping after retries, skip this spawn (prefer no virus-in-player)
    if (overlapsPlayer(x, y)) continue;

    viruses.push({
      id: generateId(),
      x,
      y,
      radius: r,
      charge: 0,
      velocityX: 0,
      velocityY: 0,
      splitDirX: 0,
      splitDirY: 0,
      splitMaxSpeed: 0
    });
  }
  return viruses;
}

export function createBot(
  name: string,
  worldW: number = WORLD_WIDTH,
  worldH: number = WORLD_HEIGHT,
  config: GameplayConfig = defaultGameplayConfig
): Player {
  const r = getRadius(config.initialMass);
  return {
    id: generateId(),
    name,
    cells: [{
      id: generateId(),
      x: Math.random() * worldW,
      y: Math.random() * worldH,
      radius: r,
      visualRadius: r,
      targetRadius: r,
      color: randomColor(),
      velocityX: 0,
      velocityY: 0,
      splitDirX: 0,
      splitDirY: 0,
      splitMaxSpeed: 0
    }],
    color: randomColor(),
    score: Math.floor(config.initialMass),
    isBot: true,
    targetX: Math.random() * worldW,
    targetY: Math.random() * worldH,
    lastSplit: 0,
    lastEject: 0
  };
}

export function createBotBehavior(config: GameplayConfig = defaultGameplayConfig): BotBehavior {
  return {
    aggressiveness: Math.random() * 0.7 + 0.3,
    caution: Math.random() * 0.7 + 0.3,
    foodPriority: Math.random() * 0.6 + 0.2,
    splitThreshold: getRadius(config.minSplitMass) * (1.5 + Math.random()),
    virusAwareness: Math.random() * 0.5 + 0.5
  };
}

/**
 * Split without teleport — slight offset + impulse toward cursor.
 * Min mass 40 → two cells of 20.
 */
export function getSplitLaunchSpeed(
  pieceMass: number,
  config: GameplayConfig = defaultGameplayConfig
): number {
  const global = Math.max(0, config.splitLaunchSharpness);
  const small = Math.max(0, config.splitLaunchSharpnessSmall);
  const large = Math.max(0, config.splitLaunchSharpnessLarge);
  const minM = Math.max(1, config.minSplitMass * 0.5);
  const maxM = Math.max(minM + 1, config.maxCellMass);
  const t = Math.max(0, Math.min(1, (pieceMass - minM) / (maxM - minM)));
  const sizeBias = small * (1 - t) + large * t;
  return config.splitBoost * global * sizeBias;
}

export function splitCell(
  cell: Cell,
  targetX: number,
  targetY: number,
  config: GameplayConfig = defaultGameplayConfig
): Cell | null {
  if (getMass(cell.radius) < config.minSplitMass) return null;

  const oldRadius = cell.radius;
  const halfMass = getMass(cell.radius) / 2;
  const newRadius = getRadius(halfMass);
  const angle = Math.atan2(targetY - cell.y, targetX - cell.x);
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  // Spawn far enough ahead so chain-splits form a line instead of nesting
  const offset = Math.max(oldRadius * 0.65, newRadius * Math.max(config.splitSpawnOffset, 0.9));
  const launch = getSplitLaunchSpeed(halfMass, config);

  cell.radius = newRadius;
  cell.targetRadius = newRadius;
  // Parent visual eases down; new piece starts at half visual

  return {
    id: generateId(),
    x: cell.x + dirX * offset,
    y: cell.y + dirY * offset,
    radius: newRadius,
    visualRadius: newRadius * 0.62,
    targetRadius: newRadius,
    color: cell.color,
    velocityX: dirX * launch,
    velocityY: dirY * launch,
    splitDirX: dirX,
    splitDirY: dirY,
    splitMaxSpeed: 0
  };
}

export function getEjectedRadius(config: GameplayConfig = defaultGameplayConfig): number {
  return getRadius(config.ejectGain);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const botNames = [
  'AgarioMaster', 'CellHunter', 'BlobKing', 'MassEater', 'ProGamer',
  'NomNom', 'BigBlob', 'FastFood', 'SplitMaster', 'VirusKiller',
  'EatEmAll', 'CellDestroyer', 'BlobWarrior', 'MassCollector', 'TopPlayer',
  'Hungry', 'Devourer', 'CellChaser', 'BlobRuler', 'MassHunter',
  'Predator', 'Apex', 'GiantCell', 'SpeedyBlob', 'SneakyCell',
  'BigEater', 'SmallFry', 'CellMaster', 'BlobLord', 'MassKing'
];

export function getRandomBotName(): string {
  return botNames[Math.floor(Math.random() * botNames.length)] + Math.floor(Math.random() * 100);
}

/** Re-export commonly used constants for convenience */
export {
  WORLD_WIDTH,
  WORLD_HEIGHT,
  INITIAL_RADIUS,
  INITIAL_MASS,
  MIN_SPLIT_MASS,
  VIRUS_RADIUS,
  VIRUS_MASS,
} from './constants';
