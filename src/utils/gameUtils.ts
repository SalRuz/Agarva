import { Position, Cell, Player, Food, Virus, BotBehavior, EjectedMass } from '../types/game';

export const WORLD_WIDTH = 5000;
export const WORLD_HEIGHT = 5000;
export const INITIAL_RADIUS = 20;
export const MIN_SPLIT_RADIUS = 35;
export const MAX_CELLS_PER_PLAYER = 16;
export const MERGE_TIME = 30000;
export const FOOD_RADIUS = 8;
export const VIRUS_RADIUS = 40;
export const BASE_SPEED = 2.5;

// Физика выдачи массы: скорость выше старой (8), но дистанция как у старой
export const EJECT_MASS_VALUE = 10;
export const EJECT_SPEED = 12; // было 16, теперь 12 (старая была 8)
export const EJECT_MIN_RADIUS = 35;
export const EJECT_COOLDOWN = 150;
export const EJECT_GRACE_PERIOD = 150;
export const EJECT_FRICTION = 0.88; // было 0.92, теперь сильнее торможение

export const VIRUS_BONUS_MASS = 40;

export const VIRUS_MAX_CHARGE = 8;

export const SPLIT_MAX_SPEED = 10;
export const SPLIT_DECELERATION = 0.85;

export const VIRUS_POP_SPEED = 6.67;
// Колышки вылетают в 2 раза быстрее
export const VIRUS_SPLIT_SPEED = 10; // было 5, теперь 10

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

export function getMass(radius: number): number {
  return Math.PI * radius * radius / 100;
}

export function getRadius(mass: number): number {
  return Math.sqrt(mass * 100 / Math.PI);
}

export function getSpeed(radius: number): number {
  return BASE_SPEED * Math.pow(INITIAL_RADIUS / radius, 0.4);
}

export function getTotalMass(player: Player): number {
  return player.cells.reduce((sum, cell) => sum + getMass(cell.radius), 0);
}

export function getPlayerCenter(player: Player): Position {
  if (player.cells.length === 0) return { x: 0, y: 0 };
  const totalMass = getTotalMass(player);
  let cx = 0, cy = 0;
  for (const cell of player.cells) {
    const mass = getMass(cell.radius);
    cx += cell.x * mass;
    cy += cell.y * mass;
  }
  return { x: cx / totalMass, y: cy / totalMass };
}

export function canEat(eater: Cell, target: { x: number; y: number; radius: number }): boolean {
  const dist = distance(eater, target);
  return eater.radius > target.radius * 1.1 && dist < eater.radius - target.radius * 0.4;
}

export function canEatEjectedMass(cell: Cell, mass: EjectedMass): boolean {
  const dist = distance(cell, mass);
  return dist < cell.radius + mass.radius * 0.3;
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
  const hue = 120 * (1 - charge / VIRUS_MAX_CHARGE);
  const fill = `hsl(${hue}, 80%, 50%)`;
  const stroke = `hsl(${hue}, 80%, 35%)`;
  return { fill, stroke };
}

// Распределение масс при взрыве от колючки:
// 1 большая + 1 средняя + 2 меньше средних + остальные мелкие
// Большая = 8 единиц, Средняя = 4, 2 меньше средних = 2+2, мелкие = 1
export function distributeVirusPopMass(totalMass: number, newCellCount: number): number[] {
  if (newCellCount <= 0) return [];
  
  // Количество "особых" клеток
  const hasLarge = newCellCount >= 1;
  const hasMedium = newCellCount >= 2;
  const hasSmallMedium1 = newCellCount >= 3;
  const hasSmallMedium2 = newCellCount >= 4;
  const tinyCount = Math.max(0, newCellCount - 4);
  
  // Общее количество "условных единиц"
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

export function createFood(count: number): Food[] {
  const food: Food[] = [];
  for (let i = 0; i < count; i++) {
    food.push({
      id: generateId(),
      x: Math.random() * WORLD_WIDTH,
      y: Math.random() * WORLD_HEIGHT,
      radius: FOOD_RADIUS,
      color: randomColor()
    });
  }
  return food;
}

export function createVirus(count: number, existingViruses: Virus[] = []): Virus[] {
  const viruses: Virus[] = [...existingViruses];
  for (let i = 0; i < count; i++) {
    viruses.push({
      id: generateId(),
      x: Math.random() * WORLD_WIDTH,
      y: Math.random() * WORLD_HEIGHT,
      radius: VIRUS_RADIUS,
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

export function createBot(name: string): Player {
  return {
    id: generateId(),
    name,
    cells: [{
      id: generateId(),
      x: Math.random() * WORLD_WIDTH,
      y: Math.random() * WORLD_HEIGHT,
      radius: INITIAL_RADIUS,
      visualRadius: INITIAL_RADIUS,
      targetRadius: INITIAL_RADIUS,
      color: randomColor(),
      velocityX: 0,
      velocityY: 0,
      splitDirX: 0,
      splitDirY: 0,
      splitMaxSpeed: 0
    }],
    color: randomColor(),
    score: 0,
    isBot: true,
    targetX: Math.random() * WORLD_WIDTH,
    targetY: Math.random() * WORLD_HEIGHT,
    lastSplit: 0,
    lastEject: 0
  };
}

export function createBotBehavior(): BotBehavior {
  return {
    aggressiveness: Math.random() * 0.7 + 0.3,
    caution: Math.random() * 0.7 + 0.3,
    foodPriority: Math.random() * 0.6 + 0.2,
    splitThreshold: MIN_SPLIT_RADIUS * (1.5 + Math.random()),
    virusAwareness: Math.random() * 0.5 + 0.5
  };
}

export function splitCell(cell: Cell, targetX: number, targetY: number): Cell | null {
  if (cell.radius < MIN_SPLIT_RADIUS) return null;
  const newRadius = cell.radius / Math.sqrt(2);
  const angle = Math.atan2(targetY - cell.y, targetX - cell.x);
  const splitDistance = newRadius * 2;
  cell.radius = newRadius;
  cell.targetRadius = newRadius;
  return {
    id: generateId(),
    x: cell.x + Math.cos(angle) * splitDistance,
    y: cell.y + Math.sin(angle) * splitDistance,
    radius: newRadius,
    visualRadius: newRadius,
    targetRadius: newRadius,
    color: cell.color,
    velocityX: 0,
    velocityY: 0,
    splitDirX: Math.cos(angle),
    splitDirY: Math.sin(angle),
    splitMaxSpeed: SPLIT_MAX_SPEED
  };
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