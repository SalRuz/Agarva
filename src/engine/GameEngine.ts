import { GameState, Player, Cell, EjectedMass, Virus } from '../types/game';
import { BotAI } from './BotAI';
import {
  generateId,
  randomColor,
  distance,
  getMass,
  getRadius,
  getSpeed,
  getTotalMass,
  canEat,
  canEatEjectedMass,
  lineCircleIntersect,
  createFood,
  createVirus,
  createBot,
  splitCell,
  clamp,
  getRandomBotName,
  WORLD_WIDTH,
  WORLD_HEIGHT,
  INITIAL_RADIUS,
  VIRUS_RADIUS,
  MAX_CELLS_PER_PLAYER,
  MERGE_TIME,
  EJECT_MASS_VALUE,
  EJECT_SPEED,
  EJECT_MIN_RADIUS,
  EJECT_COOLDOWN,
  EJECT_GRACE_PERIOD,
  EJECT_FRICTION,
  VIRUS_BONUS_MASS,
  VIRUS_MAX_CHARGE,
  SPLIT_DECELERATION,
  VIRUS_POP_SPEED,
  VIRUS_SPLIT_SPEED,
  distributeVirusPopMass
} from '../utils/gameUtils';

export class GameEngine {
  private state: GameState;
  private botAI: BotAI;
  private cellBirthTime: Map<string, number> = new Map();
  private lastUpdate: number = Date.now();
  private previousMassPositions: Map<string, { x: number; y: number }> = new Map();

  constructor(botCount: number = 20) {
    this.botAI = new BotAI();
    this.state = {
      players: [],
      food: createFood(1500),
      viruses: createVirus(30),
      ejectedMass: [],
      worldWidth: WORLD_WIDTH,
      worldHeight: WORLD_HEIGHT
    };

    for (let i = 0; i < botCount; i++) {
      const bot = createBot(getRandomBotName());
      this.state.players.push(bot);
      this.cellBirthTime.set(bot.cells[0].id, Date.now());
    }
  }

  getState(): GameState {
    return this.state;
  }

  addPlayer(name: string): Player {
    const player: Player = {
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
      isBot: false,
      targetX: WORLD_WIDTH / 2,
      targetY: WORLD_HEIGHT / 2,
      lastSplit: 0,
      lastEject: 0
    };
    this.cellBirthTime.set(player.cells[0].id, Date.now());
    this.state.players.push(player);
    return player;
  }

  updatePlayerName(playerId: string, newName: string) {
    const player = this.state.players.find(p => p.id === playerId);
    if (player && newName.trim()) {
      player.name = newName.trim().slice(0, 15);
    }
  }

  updatePlayerTarget(playerId: string, targetX: number, targetY: number) {
    const player = this.state.players.find(p => p.id === playerId);
    if (player) {
      player.targetX = targetX;
      player.targetY = targetY;
    }
  }

  splitPlayer(playerId: string) {
    const player = this.state.players.find(p => p.id === playerId);
    if (!player || player.cells.length >= MAX_CELLS_PER_PLAYER) return;
    const now = Date.now();

    const newCells: Cell[] = [];
    for (const cell of player.cells) {
      if (player.cells.length + newCells.length >= MAX_CELLS_PER_PLAYER) break;
      const newCell = splitCell(cell, player.targetX, player.targetY);
      if (newCell) {
        newCells.push(newCell);
        this.cellBirthTime.set(newCell.id, now);
      }
    }
    player.cells.push(...newCells);
    player.lastSplit = now;
  }

  ejectMass(playerId: string) {
    const player = this.state.players.find(p => p.id === playerId);
    if (!player) return;

    const now = Date.now();
    if (now - player.lastEject < EJECT_COOLDOWN) return;

    const newEjected: EjectedMass[] = [];

    for (const cell of player.cells) {
      if (cell.radius < EJECT_MIN_RADIUS) continue;

      const currentMass = getMass(cell.radius);
      const newMass = currentMass - EJECT_MASS_VALUE;
      if (newMass <= 0) continue;

      cell.radius = getRadius(newMass);
      cell.targetRadius = cell.radius;

      const dx = player.targetX - cell.x;
      const dy = player.targetY - cell.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1) continue;
      const dirX = dx / dist;
      const dirY = dy / dist;

      const spawnX = cell.x + dirX * (cell.radius + getRadius(EJECT_MASS_VALUE) + 2);
      const spawnY = cell.y + dirY * (cell.radius + getRadius(EJECT_MASS_VALUE) + 2);

      const massId = generateId();
      newEjected.push({
        id: massId,
        x: spawnX,
        y: spawnY,
        radius: getRadius(EJECT_MASS_VALUE),
        color: cell.color,
        velocityX: dirX * EJECT_SPEED,
        velocityY: dirY * EJECT_SPEED,
        dirX: dirX,
        dirY: dirY,
        ownerId: player.id,
        createdAt: now
      });
      this.previousMassPositions.set(massId, { x: spawnX, y: spawnY });
    }

    if (newEjected.length > 0) {
      player.lastEject = now;
      this.state.ejectedMass.push(...newEjected);
    }
  }

  addMass(playerId: string, amount: number) {
    const player = this.state.players.find(p => p.id === playerId);
    if (!player || player.cells.length === 0) return;
    
    const largestCell = player.cells.reduce((max, cell) => 
      cell.radius > max.radius ? cell : max, player.cells[0]);
    
    const newMass = getMass(largestCell.radius) + amount;
    largestCell.radius = getRadius(newMass);
    largestCell.targetRadius = largestCell.radius;
  }

  // Вспомогательная функция для взрыва клетки от колючки
  // Делит клетку до максимума (16) с неравномерным распределением масс
  private popCellFromVirus(player: Player, cell: Cell, bonusMass: number, now: number) {
    const totalMass = getMass(cell.radius) + bonusMass;
    const actualPopCount = MAX_CELLS_PER_PLAYER - player.cells.length;
    
    if (actualPopCount <= 0) {
      // Некуда делить — просто добавляем массу
      cell.radius = getRadius(totalMass);
      cell.targetRadius = cell.radius;
      return;
    }
    
    // Распределяем массы: 1 большая, 1 средняя, 2 меньше средних, остальные мелкие
    // Первая масса — для исходной клетки, остальные — для новых
    const masses = distributeVirusPopMass(totalMass, actualPopCount + 1);
    
    // Исходная клетка становится самой большой
    cell.radius = getRadius(masses[0]);
    cell.targetRadius = cell.radius;
    
    // Создаем новые клетки
    for (let p = 1; p < masses.length; p++) {
      const angle = (Math.PI * 2 * (p - 1)) / (masses.length - 1);
      const newCell: Cell = {
        id: generateId(),
        x: cell.x + Math.cos(angle) * cell.radius * 1.5,
        y: cell.y + Math.sin(angle) * cell.radius * 1.5,
        radius: getRadius(masses[p]),
        visualRadius: getRadius(masses[p]),
        targetRadius: getRadius(masses[p]),
        color: cell.color,
        velocityX: Math.cos(angle) * VIRUS_POP_SPEED,
        velocityY: Math.sin(angle) * VIRUS_POP_SPEED,
        splitDirX: Math.cos(angle),
        splitDirY: Math.sin(angle),
        splitMaxSpeed: VIRUS_POP_SPEED
      };
      player.cells.push(newCell);
      this.cellBirthTime.set(newCell.id, now);
    }
  }

  update() {
    const now = Date.now();
    const deltaTime = Math.min(50, now - this.lastUpdate);
    this.lastUpdate = now;
    const delta = deltaTime / 16.67;

    for (const player of this.state.players) {
      if (player.isBot && player.cells.length > 0) {
        const decision = this.botAI.updateBot(
          player,
          this.state.players,
          this.state.food,
          this.state.viruses,
          now
        );
        player.targetX = decision.targetX;
        player.targetY = decision.targetY;
        if (decision.shouldSplit && player.cells.length < MAX_CELLS_PER_PLAYER) {
          this.splitPlayer(player.id);
        }
      }
    }

    for (const player of this.state.players) {
      for (const cell of player.cells) {
        const speed = Math.sqrt(cell.velocityX ** 2 + cell.velocityY ** 2);
        if (cell.splitMaxSpeed > 0 && speed < cell.splitMaxSpeed) {
          cell.velocityX += cell.splitDirX * 0.75 * delta;
          cell.velocityY += cell.splitDirY * 0.75 * delta;
          const newSpeed = Math.sqrt(cell.velocityX ** 2 + cell.velocityY ** 2);
          if (newSpeed >= cell.splitMaxSpeed) {
            cell.velocityX = cell.splitDirX * cell.splitMaxSpeed;
            cell.velocityY = cell.splitDirY * cell.splitMaxSpeed;
            cell.splitMaxSpeed = 0;
          }
        } else {
          cell.velocityX *= SPLIT_DECELERATION;
          cell.velocityY *= SPLIT_DECELERATION;
        }

        cell.x += cell.velocityX * delta;
        cell.y += cell.velocityY * delta;

        const dx = player.targetX - cell.x;
        const dy = player.targetY - cell.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 5) {
          const speed = getSpeed(cell.radius) * delta;
          cell.x += (dx / dist) * speed;
          cell.y += (dy / dist) * speed;
        }

        cell.x = clamp(cell.x, cell.radius, WORLD_WIDTH - cell.radius);
        cell.y = clamp(cell.y, cell.radius, WORLD_HEIGHT - cell.radius);

        cell.visualRadius += (cell.targetRadius - cell.visualRadius) * 0.15 * delta;
      }

      for (let i = 0; i < player.cells.length; i++) {
        for (let j = i + 1; j < player.cells.length; j++) {
          const a = player.cells[i];
          const b = player.cells[j];
          const dist = distance(a, b);
          
          const aBirthTime = this.cellBirthTime.get(a.id) || 0;
          const bBirthTime = this.cellBirthTime.get(b.id) || 0;
          const canMerge = now - aBirthTime > MERGE_TIME && now - bBirthTime > MERGE_TIME;

          if (canMerge) {
            const minRadius = Math.min(a.radius, b.radius);
            const mergeDistance = Math.abs(a.radius - b.radius) + minRadius * 0.5;
            
            if (dist < mergeDistance) {
              const largerCell = a.radius >= b.radius ? a : b;
              const smallerIndex = a.radius >= b.radius ? j : i;

              const newMass = getMass(a.radius) + getMass(b.radius);
              largerCell.radius = getRadius(newMass);
              largerCell.targetRadius = largerCell.radius;
              
              const removedCell = player.cells[smallerIndex];
              player.cells.splice(smallerIndex, 1);
              this.cellBirthTime.delete(removedCell.id);
              j--;
            }
          } else {
            const minDist = a.radius + b.radius;
            if (dist < minDist) {
              const overlap = minDist - dist;
              const angle = Math.atan2(b.y - a.y, b.x - a.x);
              const pushX = Math.cos(angle) * overlap * 0.5;
              const pushY = Math.sin(angle) * overlap * 0.5;
              a.x -= pushX;
              a.y -= pushY;
              b.x += pushX;
              b.y += pushY;
            }
          }
        }
      }

      player.score = Math.floor(getTotalMass(player));
    }

    for (const player of this.state.players) {
      for (const cell of player.cells) {
        for (let i = this.state.food.length - 1; i >= 0; i--) {
          const food = this.state.food[i];
          if (canEat(cell, food)) {
            cell.radius = getRadius(getMass(cell.radius) + getMass(food.radius));
            cell.targetRadius = cell.radius;
            this.state.food.splice(i, 1);
          }
        }
      }
    }

    for (let i = 0; i < this.state.players.length; i++) {
      const hunter = this.state.players[i];
      for (let j = 0; j < this.state.players.length; j++) {
        if (i === j) continue;
        const prey = this.state.players[j];
        for (const hunterCell of hunter.cells) {
          for (let k = prey.cells.length - 1; k >= 0; k--) {
            const preyCell = prey.cells[k];
            if (canEat(hunterCell, preyCell)) {
              hunterCell.radius = getRadius(getMass(hunterCell.radius) + getMass(preyCell.radius));
              hunterCell.targetRadius = hunterCell.radius;
              prey.cells.splice(k, 1);
              this.cellBirthTime.delete(preyCell.id);
            }
          }
        }
      }
    }

    // Поглощение колючки клеткой игрока
    for (const player of this.state.players) {
      for (let i = player.cells.length - 1; i >= 0; i--) {
        const cell = player.cells[i];
        if (cell.radius < VIRUS_RADIUS * 1.1) continue;
        for (let j = this.state.viruses.length - 1; j >= 0; j--) {
          const virus = this.state.viruses[j];
          if (virus.splitMaxSpeed > 0) continue;
          
          if (canEat(cell, virus)) {
            this.popCellFromVirus(player, cell, VIRUS_BONUS_MASS, now);
            this.state.viruses.splice(j, 1);
            this.state.viruses.push(...createVirus(1));
            break;
          }
        }
      }
    }

    // Update ejected mass
    for (let i = this.state.ejectedMass.length - 1; i >= 0; i--) {
      const mass = this.state.ejectedMass[i];
      const prevPos = this.previousMassPositions.get(mass.id) || { x: mass.x, y: mass.y };

      mass.x += mass.velocityX * delta;
      mass.y += mass.velocityY * delta;
      // Новое трение — сильнее
      mass.velocityX *= EJECT_FRICTION;
      mass.velocityY *= EJECT_FRICTION;

      if (mass.x < 0 || mass.x > WORLD_WIDTH || mass.y < 0 || mass.y > WORLD_HEIGHT) {
        this.state.ejectedMass.splice(i, 1);
        this.previousMassPositions.delete(mass.id);
        continue;
      }

      let hitVirus = false;
      for (const virus of this.state.viruses) {
        if (virus.splitMaxSpeed > 0) continue;
        
        const dist = distance(mass, virus);
        if (dist < virus.radius + mass.radius) {
          virus.charge++;
          this.state.ejectedMass.splice(i, 1);
          this.previousMassPositions.delete(mass.id);
          
          if (virus.charge >= VIRUS_MAX_CHARGE) {
            virus.charge = 0;
            
            const moveDirX = mass.x - prevPos.x;
            const moveDirY = mass.y - prevPos.y;
            const moveLen = Math.sqrt(moveDirX ** 2 + moveDirY ** 2);
            
            const dirX = moveLen > 0 ? moveDirX / moveLen : 0;
            const dirY = moveLen > 0 ? moveDirY / moveLen : 1;
            
            const newVirus: Virus = {
              id: generateId(),
              x: virus.x + dirX * virus.radius * 2,
              y: virus.y + dirY * virus.radius * 2,
              radius: VIRUS_RADIUS,
              charge: 0,
              velocityX: 0,
              velocityY: 0,
              splitDirX: dirX,
              splitDirY: dirY,
              splitMaxSpeed: VIRUS_SPLIT_SPEED
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
        const isOwner = player.id === mass.ownerId;
        const inGracePeriod = (now - mass.createdAt) < EJECT_GRACE_PERIOD;
        if (isOwner && inGracePeriod) continue;
        
        for (const cell of player.cells) {
          if (canEatEjectedMass(cell, mass)) {
            cell.radius = getRadius(getMass(cell.radius) + getMass(mass.radius));
            cell.targetRadius = cell.radius;
            this.state.ejectedMass.splice(i, 1);
            this.previousMassPositions.delete(mass.id);
            eaten = true;
            break;
          }
          
          if (lineCircleIntersect(
            prevPos.x, prevPos.y,
            mass.x, mass.y,
            cell.x, cell.y,
            cell.radius + mass.radius * 0.3
          )) {
            cell.radius = getRadius(getMass(cell.radius) + getMass(mass.radius));
            cell.targetRadius = cell.radius;
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

    // Update viruses — летящие колючки исчезают при попадании
    const virusesToRemove: string[] = [];
    
    for (const virus of this.state.viruses) {
      const speed = Math.sqrt(virus.velocityX ** 2 + virus.velocityY ** 2);
      if (virus.splitMaxSpeed > 0 && speed < virus.splitMaxSpeed) {
        virus.velocityX += virus.splitDirX * 0.5 * delta;
        virus.velocityY += virus.splitDirY * 0.5 * delta;
        const newSpeed = Math.sqrt(virus.velocityX ** 2 + virus.velocityY ** 2);
        if (newSpeed >= virus.splitMaxSpeed) {
          virus.velocityX = virus.splitDirX * virus.splitMaxSpeed;
          virus.velocityY = virus.splitDirY * virus.splitMaxSpeed;
          virus.splitMaxSpeed = 0;
        }
      } else {
        virus.velocityX *= 0.95;
        virus.velocityY *= 0.95;
      }
      
      virus.x += virus.velocityX * delta;
      virus.y += virus.velocityY * delta;
      virus.x = clamp(virus.x, virus.radius, WORLD_WIDTH - virus.radius);
      virus.y = clamp(virus.y, virus.radius, WORLD_HEIGHT - virus.radius);
      
      // Летящий вирус лопает игроков и ИСЧЕЗАЕТ
      if (speed > 1) {
        let hit = false;
        for (const player of this.state.players) {
          if (hit) break;
          for (let i = player.cells.length - 1; i >= 0; i--) {
            const cell = player.cells[i];
            if (cell.radius < VIRUS_RADIUS * 1.1) continue;
            
            const dist = distance(cell, virus);
            if (dist < cell.radius + virus.radius * 0.5) {
              this.popCellFromVirus(player, cell, VIRUS_BONUS_MASS, now);
              virusesToRemove.push(virus.id);
              hit = true;
              break;
            }
          }
        }
      }
    }
    
    if (virusesToRemove.length > 0) {
      this.state.viruses = this.state.viruses.filter(v => !virusesToRemove.includes(v.id));
    }

    for (const player of this.state.players) {
      if (player.cells.length === 0) {
        if (player.isBot) {
          this.botAI.cleanup(player.id);
          player.cells.push({
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
          });
          this.cellBirthTime.set(player.cells[0].id, now);
        }
      }
    }

    if (this.state.food.length < 1000) {
      this.state.food.push(...createFood(50));
    }

    for (const player of this.state.players) {
      for (const cell of player.cells) {
        if (cell.radius > 50) {
          cell.radius *= 0.9998;
          cell.targetRadius = cell.radius;
        }
      }
    }
  }

  getLeaderboard(): { name: string; score: number; isBot: boolean }[] {
    return this.state.players
      .filter(p => p.cells.length > 0)
      .map(p => ({ name: p.name, score: p.score, isBot: p.isBot }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
  }
}