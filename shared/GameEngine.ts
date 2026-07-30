import type { GameState, Player, Cell, EjectedMass, Virus, Food } from './types';
import { BotAI } from './BotAI';
import { SpatialHash } from './SpatialHash';
import {
  generateId,
  randomColor,
  distance,
  getMass,
  getRadius,
  getSpeed,
  getTotalMass,
  getPlayerCenter,
  getMergeTimeMs,
  canEat,
  canEatEjectedMass,
  coversCell,
  lineCircleIntersect,
  createFood,
  createVirus,
  splitCell,
  clamp,
  applyMass,
  getRandomBotName,
  getEjectedRadius,
  distributeVirusPopMass,
  bounceOffWalls,
  getFoodRadius,
} from './physics';
import { SPATIAL_CELL_SIZE } from './constants';
import {
  cloneGameplayConfig,
  defaultGameplayConfig,
  sanitizeGameplayConfig,
  type GameplayConfig,
} from './gameConfig';

export interface GameEngineOptions {
  botCount?: number;
  foodCount?: number;
  virusCount?: number;
  /** When false, dead human players are not auto-respawned as bots */
  multiplayer?: boolean;
  worldWidth?: number;
  worldHeight?: number;
  config?: Partial<GameplayConfig>;
}

export class GameEngine {
  private state: GameState;
  private botAI: BotAI;
  private cellBirthTime: Map<string, number> = new Map();
  /** When each cell becomes eligible to merge (classic timer locked at birth) */
  private cellMergeReadyAt: Map<string, number> = new Map();
  /** Temporarily pin a cell position (so virus-pop main piece stays centered) */
  private cellPinnedUntil: Map<string, number> = new Map();
  private lastUpdate: number = Date.now();
  private previousMassPositions: Map<string, { x: number; y: number }> = new Map();
  private foodHash = new SpatialHash<Food>(SPATIAL_CELL_SIZE);
  private foodQueryBuf: Food[] = [];
  private foodHashDirty = true;
  private foodTargetCount: number;
  private config: GameplayConfig;
  private multiplayerMode: boolean;

  constructor(options: GameEngineOptions | number = defaultGameplayConfig.botCountSolo) {
    const opts: GameEngineOptions =
      typeof options === 'number' ? { botCount: options } : options;
    this.config = sanitizeGameplayConfig({ ...defaultGameplayConfig, ...opts.config });
    this.multiplayerMode = !!opts.multiplayer;

    const botCount = opts.botCount ?? this.config.botCountSolo;
    this.foodTargetCount = opts.foodCount ?? (this.multiplayerMode ? this.config.foodCountMp : this.config.foodCountSolo);
    const virusCount = opts.virusCount ?? this.config.virusCount;
    const worldW = opts.worldWidth ?? this.config.worldWidth;
    const worldH = opts.worldHeight ?? this.config.worldHeight;

    this.botAI = new BotAI(this.config);
    this.state = {
      players: [],
      food: createFood(this.foodTargetCount, worldW, worldH, this.config),
      viruses: createVirus(virusCount, [], worldW, worldH, [], this.config),
      ejectedMass: [],
      worldWidth: worldW,
      worldHeight: worldH,
    };

    for (let i = 0; i < botCount; i++) {
      this.addPlayer(getRandomBotName(), true);
    }
    this.rebuildFoodHash();
  }

  private markCellBirth(cellId: string, now: number, mass: number) {
    this.cellBirthTime.set(cellId, now);
    this.cellMergeReadyAt.set(cellId, now + getMergeTimeMs(mass, this.config));
  }

  private clearCellBirth(cellId: string) {
    this.cellBirthTime.delete(cellId);
    this.cellMergeReadyAt.delete(cellId);
    this.cellPinnedUntil.delete(cellId);
  }

  private isMergeReady(cellId: string, now: number): boolean {
    const readyAt = this.cellMergeReadyAt.get(cellId);
    if (readyAt === undefined) return true;
    return now >= readyAt;
  }

  private get WW() {
    return this.state.worldWidth;
  }

  private get WH() {
    return this.state.worldHeight;
  }

  private rebuildFoodHash() {
    this.foodHash.rebuild(this.state.food);
    this.foodHashDirty = false;
  }

  getState(): GameState {
    return this.state;
  }

  getConfig(): GameplayConfig {
    return cloneGameplayConfig(this.config);
  }

  setConfig(next: Partial<GameplayConfig> | GameplayConfig): GameplayConfig {
    this.config = sanitizeGameplayConfig({ ...this.config, ...next });
    this.botAI.setConfig(this.config);
    this.foodTargetCount = this.multiplayerMode ? this.config.foodCountMp : this.config.foodCountSolo;
    this.setWorldSize(this.config.worldWidth, this.config.worldHeight);
    return this.getConfig();
  }

  /**
   * Resize world, clamp entities, refill food/viruses for new bounds.
   * Returns new dimensions.
   */
  setWorldSize(width: number, height: number): { w: number; h: number } {
    this.state.worldWidth = width;
    this.state.worldHeight = height;

    for (const player of this.state.players) {
      for (const cell of player.cells) {
        cell.x = clamp(cell.x, cell.radius, width - cell.radius);
        cell.y = clamp(cell.y, cell.radius, height - cell.radius);
      }
      player.targetX = clamp(player.targetX, 0, width);
      player.targetY = clamp(player.targetY, 0, height);
    }

    for (const virus of this.state.viruses) {
      virus.x = clamp(virus.x, virus.radius, width - virus.radius);
      virus.y = clamp(virus.y, virus.radius, height - virus.radius);
    }

    this.state.ejectedMass = this.state.ejectedMass.filter(
      (m) => m.x >= 0 && m.x <= width && m.y >= 0 && m.y <= height
    );
    this.state.food = this.state.food.filter((f) => f.x >= 0 && f.x <= width && f.y >= 0 && f.y <= height);

    const foodMissing = Math.max(0, this.foodTargetCount - this.state.food.length);
    if (foodMissing > 0) {
      this.state.food.push(...createFood(foodMissing, width, height, this.config));
    }

    const virusMissing = Math.max(0, this.config.virusCount - this.state.viruses.length);
    if (virusMissing > 0) {
      this.state.viruses.push(...createVirus(virusMissing, [], width, height, this.state.players, this.config));
    }

    this.foodHashDirty = true;
    this.rebuildFoodHash();
    return { w: width, h: height };
  }

  removePlayer(playerId: string) {
    const idx = this.state.players.findIndex((p) => p.id === playerId);
    if (idx === -1) return;
    const player = this.state.players[idx];
    for (const cell of player.cells) {
      this.clearCellBirth(cell.id);
    }
    if (player.isBot) this.botAI.cleanup(playerId);
    this.state.players.splice(idx, 1);
  }

  addPlayer(name: string, isBot = false): Player {
    const color = randomColor();
    const r = getRadius(this.config.initialMass);
    let spawnX = Math.random() * this.WW;
    let spawnY = Math.random() * this.WH;
    let spawnColor = color;
    let usedEjectSpawn = false;

    if (!isBot && this.state.ejectedMass.length > 0 && Math.random() < 0.5) {
      const idx = Math.floor(Math.random() * this.state.ejectedMass.length);
      const picked = this.state.ejectedMass[idx];
      if (!this.isSpawnBlocked(picked.x, picked.y, r)) {
        spawnX = picked.x;
        spawnY = picked.y;
        spawnColor = picked.color;
        this.previousMassPositions.delete(picked.id);
        this.state.ejectedMass.splice(idx, 1);
        usedEjectSpawn = true;
      }
    }

    if (!usedEjectSpawn) {
      const safe = this.findSafeSpawn(r);
      spawnX = safe.x;
      spawnY = safe.y;
    }

    const player: Player = {
      id: generateId(),
      name: name.trim().slice(0, 15) || 'Player',
      cells: [
        {
          id: generateId(),
          x: spawnX,
          y: spawnY,
          radius: r,
          visualRadius: r,
          targetRadius: r,
          color: spawnColor,
          velocityX: 0,
          velocityY: 0,
          splitDirX: 0,
          splitDirY: 0,
          splitMaxSpeed: 0,
        },
      ],
      color: spawnColor,
      score: Math.floor(this.config.initialMass),
      isBot,
      targetX: this.WW / 2,
      targetY: this.WH / 2,
      lastSplit: 0,
      lastEject: 0,
      frozen: false,
    };
    this.markCellBirth(player.cells[0].id, Date.now(), this.config.initialMass);
    this.state.players.push(player);
    return player;
  }

  /** True if (x,y) would spawn inside/near an existing player cell. */
  private isSpawnBlocked(x: number, y: number, radius: number, margin = 1.35): boolean {
    const minDist = radius * margin;
    for (const other of this.state.players) {
      for (const cell of other.cells) {
        if (distance({ x, y }, cell) < cell.radius + minDist) return true;
      }
    }
    return false;
  }

  private findSafeSpawn(radius: number, attempts = 48): { x: number; y: number } {
    const pad = radius + 2;
    for (let i = 0; i < attempts; i++) {
      const x = pad + Math.random() * Math.max(1, this.WW - pad * 2);
      const y = pad + Math.random() * Math.max(1, this.WH - pad * 2);
      if (!this.isSpawnBlocked(x, y, radius)) return { x, y };
    }
    // Fallback: pick the least-overlapping random candidate
    let best = { x: this.WW / 2, y: this.WH / 2 };
    let bestClearance = -Infinity;
    for (let i = 0; i < 16; i++) {
      const x = pad + Math.random() * Math.max(1, this.WW - pad * 2);
      const y = pad + Math.random() * Math.max(1, this.WH - pad * 2);
      let clearance = Infinity;
      for (const other of this.state.players) {
        for (const cell of other.cells) {
          clearance = Math.min(clearance, distance({ x, y }, cell) - cell.radius - radius);
        }
      }
      if (clearance > bestClearance) {
        bestClearance = clearance;
        best = { x, y };
      }
    }
    return best;
  }

  setPlayerFrozen(playerId: string, frozen: boolean) {
    const player = this.state.players.find((p) => p.id === playerId);
    if (!player) return;
    player.frozen = frozen;
    if (frozen && player.cells.length > 0) {
      const c = getPlayerCenter(player);
      player.targetX = c.x;
      player.targetY = c.y;
    }
  }

  togglePlayerFrozen(playerId: string): boolean {
    const player = this.state.players.find((p) => p.id === playerId);
    if (!player) return false;
    const next = !player.frozen;
    this.setPlayerFrozen(playerId, next);
    return next;
  }

  updatePlayerName(playerId: string, newName: string) {
    const player = this.state.players.find((p) => p.id === playerId);
    if (player && newName.trim()) {
      player.name = newName.trim().slice(0, 15);
    }
  }

  updatePlayerTarget(playerId: string, targetX: number, targetY: number) {
    const player = this.state.players.find((p) => p.id === playerId);
    if (player) {
      player.targetX = targetX;
      player.targetY = targetY;
    }
  }

  /** Admin: move all cells so player center lands on (x, y). */
  teleportPlayer(playerId: string, x: number, y: number) {
    const player = this.state.players.find((p) => p.id === playerId);
    if (!player || player.cells.length === 0) return;

    const center = getPlayerCenter(player);
    const dx = x - center.x;
    const dy = y - center.y;
    for (const cell of player.cells) {
      cell.x = clamp(cell.x + dx, cell.radius, this.WW - cell.radius);
      cell.y = clamp(cell.y + dy, cell.radius, this.WH - cell.radius);
      cell.velocityX = 0;
      cell.velocityY = 0;
    }
    player.targetX = clamp(x, 0, this.WW);
    player.targetY = clamp(y, 0, this.WH);
  }

  /** Admin: instantly merge all pieces into one cell (ignores merge timer). */
  forceMergePlayer(playerId: string) {
    const player = this.state.players.find((p) => p.id === playerId);
    if (!player || player.cells.length <= 1) return;

    const center = getPlayerCenter(player);
    let totalMass = 0;
    const color = player.cells[0].color;
    for (const cell of player.cells) {
      totalMass += getMass(cell.radius);
      this.clearCellBirth(cell.id);
    }
    const r = getRadius(totalMass);
    const id = generateId();
    const x = clamp(center.x, r, this.WW - r);
    const y = clamp(center.y, r, this.WH - r);
    player.cells = [
      {
        id,
        x,
        y,
        radius: r,
        visualRadius: r,
        targetRadius: r,
        color,
        velocityX: 0,
        velocityY: 0,
        splitDirX: 0,
        splitDirY: 0,
        splitMaxSpeed: 0,
      },
    ];
    this.markCellBirth(id, Date.now(), totalMass);
    player.score = Math.floor(totalMass);
  }

  /** Player/bot whose cell covers world point (x, y), preferring the topmost (largest) cell. */
  findPlayerAt(x: number, y: number): Player | null {
    let best: Player | null = null;
    let bestR = -1;
    for (const player of this.state.players) {
      for (const cell of player.cells) {
        const dx = cell.x - x;
        const dy = cell.y - y;
        if (dx * dx + dy * dy > cell.radius * cell.radius) continue;
        if (cell.radius >= bestR) {
          bestR = cell.radius;
          best = player;
        }
      }
    }
    return best;
  }

  /** Admin: remove player or bot under a world point. Returns removed id or null. */
  removePlayerAt(x: number, y: number, exceptPlayerId?: string | null): string | null {
    const target = this.findPlayerAt(x, y);
    if (!target) return null;
    if (exceptPlayerId && target.id === exceptPlayerId) return null;
    this.removePlayer(target.id);
    return target.id;
  }

  /** Admin: spawn a one-shot bot at (x, y) with given starting mass. */
  spawnBotAt(x: number, y: number, mass = 500): Player {
    const startMass = Math.max(10, mass);
    const r = getRadius(startMass);
    const px = clamp(x, r, this.WW - r);
    const py = clamp(y, r, this.WH - r);
    const color = randomColor();
    const cellId = generateId();
    const bot: Player = {
      id: generateId(),
      name: `Bot${Math.floor(Math.random() * 9999)}`,
      cells: [
        {
          id: cellId,
          x: px,
          y: py,
          radius: r,
          visualRadius: r,
          targetRadius: r,
          color,
          velocityX: 0,
          velocityY: 0,
          splitDirX: 0,
          splitDirY: 0,
          splitMaxSpeed: 0,
        },
      ],
      color,
      score: Math.floor(startMass),
      isBot: true,
      targetX: px,
      targetY: py,
      lastSplit: 0,
      lastEject: 0,
      frozen: false,
    };
    this.markCellBirth(cellId, Date.now(), startMass);
    this.state.players.push(bot);
    return bot;
  }

  splitPlayer(playerId: string) {
    const player = this.state.players.find((p) => p.id === playerId);
    if (!player || player.frozen || player.cells.length >= this.config.maxCellsPerPlayer) return;
    const now = Date.now();

    const newCells: Cell[] = [];
    const toSplit = [...player.cells];
    for (const cell of toSplit) {
      if (player.cells.length + newCells.length >= this.config.maxCellsPerPlayer) break;
      const newCell = splitCell(cell, player.targetX, player.targetY, this.config);
      if (newCell) {
        newCells.push(newCell);
        this.markCellBirth(newCell.id, now, getMass(newCell.radius));
        this.markCellBirth(cell.id, now, getMass(cell.radius));
      }
    }
    player.cells.push(...newCells);
    player.lastSplit = now;
  }

  /**
   * Auto-split oversized cells by halving their *current* (true) mass.
   * Uses strict `>` so halves that land exactly on the threshold stay stable
   * (e.g. 45k merge → two 22.5k pieces, not an immediate re-split).
   */
  private applyAutoSplit(player: Player, now: number) {
    if (!(this.config.autoSplitEnabled > 0)) return;
    const threshold = this.config.autoSplitMassThreshold;
    // Keep splitting while any cell exceeds the threshold and we have room.
    while (player.cells.length < this.config.maxCellsPerPlayer) {
      let best: Cell | null = null;
      let bestMass = 0;
      for (const cell of player.cells) {
        const m = getMass(cell.radius);
        if (!(m > threshold)) continue;
        if (!best || m > bestMass) {
          best = cell;
          bestMass = m;
        }
      }
      if (!best) break;
      const half = bestMass / 2;
      // Bypass maxCellMass clamp so true halves are preserved for further splits.
      this.setCellMassRaw(best, half);
      const newCell = this.createAutoSplitPiece(best, half, player.targetX, player.targetY);
      player.cells.push(newCell);
      this.markCellBirth(newCell.id, now, half);
      this.markCellBirth(best.id, now, half);
      player.lastSplit = now;
    }
    // If still over max with no room to split, clamp leftovers.
    for (const cell of player.cells) {
      applyMass(cell, getMass(cell.radius), this.config);
    }
  }

  /** Set logical mass without maxCellMass clamp (auto-split path). */
  private setCellMassRaw(cell: Cell, mass: number) {
    const m = Math.max(0, mass);
    cell.radius = getRadius(m);
    cell.targetRadius = cell.radius;
  }

  /** Spawn the sister piece for an auto-split (mass already known). */
  private createAutoSplitPiece(parent: Cell, halfMass: number, targetX: number, targetY: number): Cell {
    const newRadius = getRadius(halfMass);
    const angle = Math.atan2(targetY - parent.y, targetX - parent.x);
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    const offset = Math.max(
      parent.radius * 0.65,
      newRadius * Math.max(this.config.splitSpawnOffset, 0.9)
    );
    return {
      id: generateId(),
      x: parent.x + dirX * offset,
      y: parent.y + dirY * offset,
      radius: newRadius,
      visualRadius: newRadius * 0.62,
      targetRadius: newRadius,
      color: parent.color,
      velocityX: dirX * this.config.splitBoost,
      velocityY: dirY * this.config.splitBoost,
      splitDirX: dirX,
      splitDirY: dirY,
      splitMaxSpeed: 0,
    };
  }

  /**
   * Add mass to a cell; if the combined mass reaches the auto-split
   * threshold, immediately become two halves of that combined mass.
   */
  private addMassWithAutoSplit(player: Player, cell: Cell, addedMass: number, now: number) {
    const total = getMass(cell.radius) + addedMass;
    const threshold = this.config.autoSplitMassThreshold;
    if (
      this.config.autoSplitEnabled > 0 &&
      total >= threshold &&
      player.cells.length < this.config.maxCellsPerPlayer
    ) {
      const half = total / 2;
      this.setCellMassRaw(cell, half);
      const newCell = this.createAutoSplitPiece(cell, half, player.targetX, player.targetY);
      player.cells.push(newCell);
      this.markCellBirth(newCell.id, now, half);
      this.markCellBirth(cell.id, now, half);
      player.lastSplit = now;
      // Further oversized halves (half still > threshold) are handled by applyAutoSplit.
      return;
    }
    applyMass(cell, total, this.config);
  }

  ejectMass(playerId: string) {
    const player = this.state.players.find((p) => p.id === playerId);
    if (!player || player.frozen) return;

    const now = Date.now();
    if (now - player.lastEject < this.config.ejectCooldown) return;

    const newEjected: EjectedMass[] = [];
    const ejectR = getEjectedRadius(this.config);

    for (const cell of player.cells) {
      const currentMass = getMass(cell.radius);
      if (currentMass < this.config.ejectMinMass) continue;
      if (currentMass - this.config.ejectLoss <= 0) continue;

      applyMass(cell, currentMass - this.config.ejectLoss, this.config);

      const dx = player.targetX - cell.x;
      const dy = player.targetY - cell.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      let dirX: number;
      let dirY: number;
      if (dist >= 1) {
        dirX = dx / dist;
        dirY = dy / dist;
      } else {
        const v = Math.sqrt(cell.velocityX ** 2 + cell.velocityY ** 2);
        if (v > 0.1) {
          dirX = cell.velocityX / v;
          dirY = cell.velocityY / v;
        } else {
          dirX = 1;
          dirY = 0;
        }
      }

      // Spawn at / slightly inside the cell edge so the blob visibly exits
      const spawnDist = Math.max(0, cell.radius - ejectR);
      const spawnX = cell.x + dirX * spawnDist;
      const spawnY = cell.y + dirY * spawnDist;

      const massId = generateId();
      newEjected.push({
        id: massId,
        x: spawnX,
        y: spawnY,
        radius: ejectR,
        color: cell.color,
        velocityX: dirX * this.config.ejectSpeed,
        velocityY: dirY * this.config.ejectSpeed,
        dirX,
        dirY,
        ownerId: player.id,
        ownerCellId: cell.id,
        createdAt: now,
      });
      this.previousMassPositions.set(massId, { x: spawnX, y: spawnY });
    }

    if (newEjected.length > 0) {
      player.lastEject = now;
      this.state.ejectedMass.push(...newEjected);
      this.trimEjectedMass();
    }
  }

  addMass(playerId: string, amount: number) {
    const player = this.state.players.find((p) => p.id === playerId);
    if (!player || player.cells.length === 0) return;

    const largestCell = player.cells.reduce(
      (max, cell) => (cell.radius > max.radius ? cell : max),
      player.cells[0]
    );

    this.addMassWithAutoSplit(player, largestCell, amount, Date.now());
  }

  /** Destroy all mass and become a single starter cell (keep name/color). */
  resetToStarter(playerId: string) {
    const player = this.state.players.find((p) => p.id === playerId);
    if (!player) return;

    for (const cell of player.cells) {
      this.clearCellBirth(cell.id);
    }

    const r = getRadius(this.config.initialMass);
    const cx =
      player.cells.length > 0
        ? player.cells.reduce((s, c) => s + c.x, 0) / player.cells.length
        : Math.random() * this.WW;
    const cy =
      player.cells.length > 0
        ? player.cells.reduce((s, c) => s + c.y, 0) / player.cells.length
        : Math.random() * this.WH;

    const id = generateId();
    player.cells = [
      {
        id,
        x: clamp(cx, r, this.WW - r),
        y: clamp(cy, r, this.WH - r),
        radius: r,
        visualRadius: r,
        targetRadius: r,
        color: player.color,
        velocityX: 0,
        velocityY: 0,
        splitDirX: 0,
        splitDirY: 0,
        splitMaxSpeed: 0,
      },
    ];
    player.score = Math.floor(this.config.initialMass);
    this.markCellBirth(id, Date.now(), this.config.initialMass);
  }

  /** Admin: spawn a virus at world position (may be inside players). */
  spawnVirusAt(x: number, y: number) {
    const r = getRadius(this.config.virusMass);
    const vx = clamp(x, r, this.WW - r);
    const vy = clamp(y, r, this.WH - r);
    this.state.viruses.push({
      id: generateId(),
      x: vx,
      y: vy,
      radius: r,
      charge: 0,
      velocityX: 0,
      velocityY: 0,
      splitDirX: 0,
      splitDirY: 0,
      splitMaxSpeed: 0,
    });
  }

  private trimEjectedMass() {
    const over = this.state.ejectedMass.length - this.config.ejectMaxCount;
    if (over <= 0) return;
    const removed = this.state.ejectedMass.splice(0, over);
    for (const m of removed) {
      this.previousMassPositions.delete(m.id);
    }
  }

  private popCellFromVirus(player: Player, cell: Cell, bonusMass: number, now: number) {
    const totalMass = Math.min(getMass(cell.radius) + bonusMass, this.config.maxCellMass);
    const actualPopCount = this.config.maxCellsPerPlayer - player.cells.length;

    if (actualPopCount <= 0) {
      applyMass(cell, totalMass, this.config);
      return;
    }

    let masses = distributeVirusPopMass(totalMass, actualPopCount + 1).sort((a, b) => b - a);
    if (totalMass >= 5000 && masses.length >= 2) {
      const tinyCount = Math.max(0, masses.length - 4);
      const weights = [12, 3, 1.5, 1.5, ...Array.from({ length: tinyCount }, () => 0.65)];
      const totalWeight = weights.slice(0, masses.length).reduce((s, w) => s + w, 0);
      masses = weights.slice(0, masses.length).map((w) => (totalMass * w) / totalWeight);
      // Ensure "main" piece is always masses[0] (largest)
      masses.sort((a, b) => b - a);
    }
    const cx = cell.x;
    const cy = cell.y;
    applyMass(cell, masses[0], this.config);
    cell.x = cx;
    cell.y = cy;
    cell.velocityX = 0;
    cell.velocityY = 0;
    // Pin the main piece for a short time so separation won't push it away from the center.
    this.cellPinnedUntil.set(cell.id, now + 220);

    for (let p = 1; p < masses.length; p++) {
      const angle = (Math.PI * 2 * (p - 1)) / (masses.length - 1);
      const r = getRadius(masses[p]);
      // Spawn from the central piece, then fly outward.
      const newCell: Cell = {
        id: generateId(),
        x: cx,
        y: cy,
        radius: r,
        visualRadius: r * 0.35,
        targetRadius: r,
        color: cell.color,
        // Increase spread amount as requested.
        velocityX: Math.cos(angle) * this.config.virusPopSpeed * 2,
        velocityY: Math.sin(angle) * this.config.virusPopSpeed * 2,
        splitDirX: Math.cos(angle),
        splitDirY: Math.sin(angle),
        splitMaxSpeed: 0,
      };
      player.cells.push(newCell);
      this.markCellBirth(newCell.id, now, masses[p]);
    }
    this.markCellBirth(cell.id, now, masses[0]);
  }

  private moveCell(cell: Cell, targetX: number, targetY: number, delta: number) {
    // Split momentum first (ИСХОДНИК-style decay), then cruise toward cursor
    cell.x += cell.velocityX * delta;
    cell.y += cell.velocityY * delta;
    cell.velocityX *= Math.pow(this.config.splitFriction, delta);
    cell.velocityY *= Math.pow(this.config.splitFriction, delta);

    const dx = targetX - cell.x;
    const dy = targetY - cell.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const stopDist = Math.max(this.config.moveStopBase, cell.radius * this.config.moveStopRadiusFrac);
    const maxSpeed = getSpeed(cell.radius, this.config);
    const boostSpd = Math.sqrt(cell.velocityX ** 2 + cell.velocityY ** 2);

    // While flying from split, lightly steer without fighting momentum
    if (boostSpd > maxSpeed * this.config.boostPassMult) {
      if (dist > stopDist) {
        const dirX = dx / dist;
        const dirY = dy / dist;
        cell.velocityX += (dirX * boostSpd - cell.velocityX) * this.config.boostSteer * delta;
        cell.velocityY += (dirY * boostSpd - cell.velocityY) * this.config.boostSteer * delta;
      }
      return;
    }

    // ИСХОДНИК-like: direct smooth move toward cursor (no velocity twitch)
    if (dist <= stopDist) {
      return;
    }

    let speedMult = 1;
    if (this.config.cursorSlowdownEnabled >= 0.5) {
      const slowR = cell.radius * this.config.cursorSlowdownRadiusMult;
      if (dist < slowR) {
        // Full creep near center → normal speed near outer edge of the zone
        const t = dist / Math.max(slowR, 1);
        const slow = this.config.cursorSlowdownFactor;
        speedMult = slow + (1 - slow) * t;
      }
    }

    const speed = maxSpeed * delta * speedMult;
    cell.x += (dx / dist) * speed;
    cell.y += (dy / dist) * speed;
  }

  update(nowMs?: number) {
    const now = nowMs ?? Date.now();
    const deltaTime = Math.min(50, now - this.lastUpdate);
    this.lastUpdate = now;
    const delta = deltaTime / 16.67;
    const dtSec = deltaTime / 1000;
    const WW = this.WW;
    const WH = this.WH;

    // Bots (AI cadence handled inside BotAI)
    for (const player of this.state.players) {
      if (player.isBot && player.cells.length > 0) {
        const decision = this.botAI.updateBot(
          player,
          this.state.players,
          this.state.food,
          this.state.viruses,
          now,
          WW,
          WH
        );
        player.targetX = decision.targetX;
        player.targetY = decision.targetY;
        if (decision.shouldSplit && player.cells.length < this.config.maxCellsPerPlayer) {
          this.splitPlayer(player.id);
        }
      }
    }

    // Movement
    for (const player of this.state.players) {
      for (const cell of player.cells) {
        if (!player.frozen) {
          this.moveCell(cell, player.targetX, player.targetY, delta);
        } else {
          // Still decay leftover split momentum while frozen
          cell.x += cell.velocityX * delta;
          cell.y += cell.velocityY * delta;
          cell.velocityX *= Math.pow(this.config.splitFriction, delta);
          cell.velocityY *= Math.pow(this.config.splitFriction, delta);
        }

        // Bounce off walls (especially important for split momentum into a wall)
        bounceOffWalls(cell, WW, WH);
        const vlen = Math.sqrt(cell.velocityX ** 2 + cell.velocityY ** 2);
        if (vlen > 0.05) {
          cell.splitDirX = cell.velocityX / vlen;
          cell.splitDirY = cell.velocityY / vlen;
        }

        // Smooth visual stretch toward logical radius
        const visualLerp =
          cell.visualRadius < cell.targetRadius ? this.config.visualGrowLerp : this.config.visualShrinkLerp;
        cell.visualRadius += (cell.targetRadius - cell.visualRadius) * visualLerp * delta;

        const mass = getMass(cell.radius);
        if (mass > this.config.massDecayMin) {
          applyMass(cell, mass * (1 - this.config.massDecayPerSec * dtSec), this.config);
        }
      }

      // Hard collisions between own cells — never nest/squeeze together.
      // (Bug before: after merge timer, separation was skipped until 75% eat → pile-up)
      for (let iter = 0; iter < this.config.separationIterations; iter++) {
        for (let i = 0; i < player.cells.length; i++) {
          for (let j = i + 1; j < player.cells.length; j++) {
            const a = player.cells[i];
            const b = player.cells[j];
            const dist = distance(a, b);

            const aReady = this.isMergeReady(a.id, now);
            const bReady = this.isMergeReady(b.id, now);
            const canMerge = aReady && bReady;

            if (canMerge) {
              const larger = a.radius >= b.radius ? a : b;
              const smaller = a.radius >= b.radius ? b : a;
              // After timer: allow overlap and merge at the same visual coverage threshold.
              const mergeHit = coversCell(larger, smaller, this.config.mergeCoverage);
              if (mergeHit) {
                const smallerIndex = a.radius >= b.radius ? j : i;
                const removedCell = player.cells[smallerIndex];
                const added = getMass(removedCell.radius);
                player.cells.splice(smallerIndex, 1);
                this.clearCellBirth(removedCell.id);
                this.addMassWithAutoSplit(player, larger, added, now);
                j--;
              }
              continue;
            }

            const massA = Math.max(getMass(a.radius), 1);
            const massB = Math.max(getMass(b.radius), 1);
            const spdA = Math.sqrt(a.velocityX ** 2 + a.velocityY ** 2);
            const spdB = Math.sqrt(b.velocityX ** 2 + b.velocityY ** 2);
            const cruiseA = getSpeed(a.radius, this.config);
            const cruiseB = getSpeed(b.radius, this.config);
            const boostA = spdA > cruiseA * this.config.boostPassMult;
            const boostB = spdB > cruiseB * this.config.boostPassMult;
            // While any piece is still flying from a split, pass through —
            // this keeps chain-splits as a clean line instead of a clump.
            if (boostA || boostB) continue;

            const aBirth = this.cellBirthTime.get(a.id) || 0;
            const bBirth = this.cellBirthTime.get(b.id) || 0;
            const youngBoostA = now - aBirth < 700 && spdA > cruiseA * 0.85;
            const youngBoostB = now - bBirth < 700 && spdB > cruiseB * 0.85;
            if (youngBoostA || youngBoostB) continue;

            // Solid circle collision while merge timer is active
            const minDist = a.radius + b.radius;
            if (dist >= minDist) continue;

            let shareA: number;
            let shareB: number;
            // Mass-weighted but always fully separates (shares sum to 1, stiffness 1)
            const invA = 1 / massA;
            const invB = 1 / massB;
            const invSum = invA + invB;
            shareA = invA / invSum;
            shareB = invB / invSum;

            // Soft squeeze: smaller pieces can nest into gaps between larger ones
            // and only gently part the heavy cells (not shove them hard).
            let effectiveMinDist = minDist;
            if (this.config.squeezeThroughEnabled >= 0.5) {
              const heavy = massA >= massB ? a : b;
              const light = massA >= massB ? b : a;
              const heavyMass = Math.max(massA, massB);
              const lightMass = Math.min(massA, massB);
              const ratio = heavyMass / Math.max(lightMass, 1);
              if (ratio >= 3.5 && light.radius < heavy.radius * 0.72) {
                // Allow deeper overlap for the small piece
                const allow = Math.min(light.radius * 0.92, heavy.radius * 0.35);
                effectiveMinDist = Math.max(heavy.radius + light.radius * 0.15, minDist - allow);
                if (dist >= effectiveMinDist) continue;
                // Almost all displacement goes to the light cell; heavy barely moves
                const heavyShare = Math.min(0.08, 0.35 / ratio);
                if (massA >= massB) {
                  shareA = heavyShare;
                  shareB = 1 - heavyShare;
                } else {
                  shareB = heavyShare;
                  shareA = 1 - heavyShare;
                }
              }
            }

            // If one of the cells is pinned (virus-pop main piece), keep it fixed
            // and push the other cell outward.
            const aPinned = now < (this.cellPinnedUntil.get(a.id) || 0);
            const bPinned = now < (this.cellPinnedUntil.get(b.id) || 0);
            if (aPinned && bPinned) continue;
            if (aPinned && !bPinned) {
              shareA = 0;
              shareB = 1;
            } else if (bPinned && !aPinned) {
              shareB = 0;
              shareA = 1;
            }

            const safeDist = dist < 0.01 ? 0.01 : dist;
            const overlap = effectiveMinDist - safeDist;
            if (overlap <= 0) continue;
            const push = overlap * this.config.separationStiffness;
            const nx = (b.x - a.x) / safeDist;
            const ny = (b.y - a.y) / safeDist;
            a.x -= nx * push * shareA;
            a.y -= ny * push * shareA;
            b.x += nx * push * shareB;
            b.y += ny * push * shareB;

            // Clamp inside world after each push
            a.x = clamp(a.x, a.radius, WW - a.radius);
            a.y = clamp(a.y, a.radius, WH - a.radius);
            b.x = clamp(b.x, b.radius, WW - b.radius);
            b.y = clamp(b.y, b.radius, WH - b.radius);
          }
        }
      }

      player.score = Math.floor(getTotalMass(player));
    }

    // Eat food (spatial hash)
    if (this.foodHashDirty) this.rebuildFoodHash();

    const eatenFoodIds = new Set<string>();
    for (const player of this.state.players) {
      for (const cell of player.cells) {
        const nearby = this.foodHash.queryRadius(
          cell.x,
          cell.y,
          cell.radius + getFoodRadius(this.config),
          this.foodQueryBuf
        );
        for (const food of nearby) {
          if (eatenFoodIds.has(food.id)) continue;
          // Classic pellet pickup: food center inside the cell
          if (distance(cell, food) < cell.radius) {
            this.addMassWithAutoSplit(player, cell, this.config.foodMass, now);
            eatenFoodIds.add(food.id);
          }
        }
      }
    }
    if (eatenFoodIds.size > 0) {
      this.state.food = this.state.food.filter((f) => !eatenFoodIds.has(f.id));
      this.foodHashDirty = true;
    }

    // Eat players
    for (let i = 0; i < this.state.players.length; i++) {
      const hunter = this.state.players[i];
      for (let j = 0; j < this.state.players.length; j++) {
        if (i === j) continue;
        const prey = this.state.players[j];
        for (const hunterCell of hunter.cells) {
          for (let k = prey.cells.length - 1; k >= 0; k--) {
            const preyCell = prey.cells[k];
            if (canEat(hunterCell, preyCell, this.config)) {
              this.addMassWithAutoSplit(hunter, hunterCell, getMass(preyCell.radius), now);
              prey.cells.splice(k, 1);
              this.clearCellBirth(preyCell.id);
            }
          }
        }
      }
    }

    // Eat / pop on viruses — ≥130 mass + coverage (same size or larger; no 1.25× rule)
    const virusesToRemove = new Set<string>();

    for (const player of this.state.players) {
      for (let i = player.cells.length - 1; i >= 0; i--) {
        const cell = player.cells[i];
        if (getMass(cell.radius) < this.config.virusMinEatMass) continue;

        for (const virus of this.state.viruses) {
          if (virusesToRemove.has(virus.id)) continue;
          if (coversCell(cell, virus, this.config.virusAbsorbCoverage)) {
            this.popCellFromVirus(player, cell, this.config.virusBonusMass, now);
            virusesToRemove.add(virus.id);
            break;
          }
        }
      }
    }

    // Ejected mass
    for (let i = this.state.ejectedMass.length - 1; i >= 0; i--) {
      const mass = this.state.ejectedMass[i];
      const prevPos = this.previousMassPositions.get(mass.id) || { x: mass.x, y: mass.y };

      mass.x += mass.velocityX * delta;
      mass.y += mass.velocityY * delta;
      mass.velocityX *= Math.pow(this.config.ejectFriction, delta);
      mass.velocityY *= Math.pow(this.config.ejectFriction, delta);

      bounceOffWalls(mass, WW, WH);

      let hitVirus = false;
      for (const virus of this.state.viruses) {
        if (virusesToRemove.has(virus.id)) continue;
        // Only feed relatively settled viruses
        if (Math.abs(virus.velocityX) + Math.abs(virus.velocityY) > 2) continue;

        // Absorb only when eject is ≥70% inside the virus (visually enters first)
        if (coversCell(virus, mass, this.config.virusEjectCoverage)) {
          virus.charge++;
          this.state.ejectedMass.splice(i, 1);
          this.previousMassPositions.delete(mass.id);

          if (virus.charge >= this.config.virusMaxCharge) {
            virus.charge = 0;

            const moveDirX = mass.x - prevPos.x;
            const moveDirY = mass.y - prevPos.y;
            const moveLen = Math.sqrt(moveDirX ** 2 + moveDirY ** 2);

            const dirX = moveLen > 0 ? moveDirX / moveLen : mass.dirX || 0;
            const dirY = moveLen > 0 ? moveDirY / moveLen : mass.dirY || 1;

            const newVirus: Virus = {
              id: generateId(),
              x: virus.x + dirX * virus.radius * 1.2,
              y: virus.y + dirY * virus.radius * 1.2,
              radius: virus.radius,
              charge: 0,
              velocityX: dirX * this.config.virusSplitSpeed,
              velocityY: dirY * this.config.virusSplitSpeed,
              splitDirX: dirX,
              splitDirY: dirY,
              splitMaxSpeed: 0,
            };
            this.state.viruses.push(newVirus);
          }

          hitVirus = true;
          break;
        }
      }

      if (hitVirus) continue;

      let eaten = false;
      for (const player of this.state.players) {
        for (const cell of player.cells) {
          // Only the ejecting cell is blocked during grace (other own pieces can feed)
          if (
            player.id === mass.ownerId &&
            cell.id === mass.ownerCellId &&
            now - mass.createdAt < this.config.ejectGracePeriod
          ) {
            continue;
          }

          // Inner radius: absorb only once W path enters well inside the cell
          const innerR = Math.max(cell.radius * 0.45, cell.radius - mass.radius);
          const hit =
            canEatEjectedMass(cell, mass, this.config) ||
            (getMass(cell.radius) >= this.config.ejectPickupMinMass &&
              lineCircleIntersect(
                prevPos.x,
                prevPos.y,
                mass.x,
                mass.y,
                cell.x,
                cell.y,
                innerR
              ));

          if (hit) {
            this.addMassWithAutoSplit(player, cell, this.config.ejectGain, now);
            this.state.ejectedMass.splice(i, 1);
            this.previousMassPositions.delete(mass.id);
            eaten = true;
            break;
          }
        }
        if (eaten) break;
      }

      if (!eaten) {
        this.previousMassPositions.set(mass.id, { x: mass.x, y: mass.y });
      }
    }

    // Flying viruses — smooth slide + always dangerous
    for (const virus of this.state.viruses) {
      if (virusesToRemove.has(virus.id)) continue;

      virus.velocityX *= Math.pow(this.config.virusFriction, delta);
      virus.velocityY *= Math.pow(this.config.virusFriction, delta);

      virus.x += virus.velocityX * delta;
      virus.y += virus.velocityY * delta;
      bounceOffWalls(virus, WW, WH);
      // Keep split direction aligned with bounce
      const vlen = Math.sqrt(virus.velocityX ** 2 + virus.velocityY ** 2);
      if (vlen > 0.05) {
        virus.splitDirX = virus.velocityX / vlen;
        virus.splitDirY = virus.velocityY / vlen;
      }

      let hit = false;
      for (const player of this.state.players) {
        if (hit) break;
        for (let i = player.cells.length - 1; i >= 0; i--) {
          const cell = player.cells[i];
          if (getMass(cell.radius) < this.config.virusMinEatMass) continue;

          if (coversCell(cell, virus, this.config.virusAbsorbCoverage)) {
            this.popCellFromVirus(player, cell, this.config.virusBonusMass, now);
            virusesToRemove.add(virus.id);
            hit = true;
            break;
          }
        }
      }
    }

    if (virusesToRemove.size > 0) {
      this.state.viruses = this.state.viruses.filter((v) => !virusesToRemove.has(v.id));
      const missing = this.config.virusCount - this.state.viruses.length;
      if (missing > 0) {
        this.state.viruses.push(...createVirus(missing, [], WW, WH, this.state.players, this.config));
      }
    }

    // Respawn bots
    for (const player of this.state.players) {
      if (player.cells.length === 0) {
        if (player.isBot) {
          this.botAI.cleanup(player.id);
          const r = getRadius(this.config.initialMass);
          const safe = this.findSafeSpawn(r);
          player.cells.push({
            id: generateId(),
            x: safe.x,
            y: safe.y,
            radius: r,
            visualRadius: r,
            targetRadius: r,
            color: player.color,
            velocityX: 0,
            velocityY: 0,
            splitDirX: 0,
            splitDirY: 0,
            splitMaxSpeed: 0,
          });
          this.markCellBirth(player.cells[0].id, now, this.config.initialMass);
          player.score = Math.floor(this.config.initialMass);
        }
      }
    }

    if (this.state.food.length < this.config.foodRespawnThreshold) {
      this.state.food.push(...createFood(this.config.foodRespawnBatch, WW, WH, this.config));
      this.foodHashDirty = true;
    }

    // Auto-split after all mass changes this tick
    for (const player of this.state.players) {
      if (player.cells.length > 0) this.applyAutoSplit(player, now);
    }

    if (this.foodHashDirty) this.rebuildFoodHash();
  }

  getLeaderboard(): { name: string; score: number; isBot: boolean }[] {
    return this.state.players
      .filter((p) => p.cells.length > 0)
      .map((p) => ({ name: p.name, score: p.score, isBot: p.isBot }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
  }
}
