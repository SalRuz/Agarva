export interface Position {
  x: number;
  y: number;
}

export interface Cell {
  id: string;
  x: number;
  y: number;
  radius: number;
  visualRadius: number;
  targetRadius: number;
  color: string;
  velocityX: number;
  velocityY: number;
  splitDirX: number;
  splitDirY: number;
  splitMaxSpeed: number;
}

export interface Player {
  id: string;
  name: string;
  cells: Cell[];
  color: string;
  score: number;
  isBot: boolean;
  targetX: number;
  targetY: number;
  lastSplit: number;
  lastEject: number;
  /** When true, cells stay put (ignore mouse target) */
  frozen?: boolean;
  /** Equipped skin id (filename), synced over network */
  skin?: string;
}

export interface Food {
  id: string;
  x: number;
  y: number;
  radius: number;
  color: string;
}

export interface Virus {
  id: string;
  x: number;
  y: number;
  radius: number;
  charge: number;
  velocityX: number;
  velocityY: number;
  splitDirX: number;
  splitDirY: number;
  splitMaxSpeed: number;
}

export interface EjectedMass {
  id: string;
  x: number;
  y: number;
  radius: number;
  color: string;
  velocityX: number;
  velocityY: number;
  dirX: number;
  dirY: number;
  ownerId: string;
  /** Cell that ejected this blob — only this cell is blocked during grace */
  ownerCellId: string;
  createdAt: number;
}

export interface GameState {
  players: Player[];
  food: Food[];
  viruses: Virus[];
  ejectedMass: EjectedMass[];
  worldWidth: number;
  worldHeight: number;
}

export interface BotBehavior {
  aggressiveness: number;
  caution: number;
  foodPriority: number;
  splitThreshold: number;
  virusAwareness: number;
}
