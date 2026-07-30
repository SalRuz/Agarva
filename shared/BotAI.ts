import type { Player, Food, Virus, BotBehavior } from './types';
import {
  distance,
  getPlayerCenter,
  getTotalMass,
  createBotBehavior,
  WORLD_WIDTH,
  WORLD_HEIGHT,
  getRadius,
} from './physics';
import { defaultGameplayConfig, type GameplayConfig } from './gameConfig';

interface CachedDecision {
  targetX: number;
  targetY: number;
  shouldSplit: boolean;
  nextThink: number;
}

export class BotAI {
  private behaviors: Map<string, BotBehavior> = new Map();
  private decisionCooldown: Map<string, number> = new Map();
  private cached: Map<string, CachedDecision> = new Map();
  private config: GameplayConfig;

  constructor(config: GameplayConfig = defaultGameplayConfig) {
    this.config = config;
  }

  setConfig(config: GameplayConfig) {
    this.config = config;
  }

  getBehavior(playerId: string): BotBehavior {
    if (!this.behaviors.has(playerId)) {
      this.behaviors.set(playerId, createBotBehavior(this.config));
    }
    return this.behaviors.get(playerId)!;
  }

  updateBot(
    bot: Player,
    allPlayers: Player[],
    food: Food[],
    viruses: Virus[],
    currentTime: number,
    worldW: number = WORLD_WIDTH,
    worldH: number = WORLD_HEIGHT
  ): { targetX: number; targetY: number; shouldSplit: boolean } {
    const prev = this.cached.get(bot.id);
    if (prev && currentTime < prev.nextThink) {
      // Keep steering toward last target; clear one-shot split
      return {
        targetX: prev.targetX,
        targetY: prev.targetY,
        shouldSplit: false,
      };
    }

    const decision = this.think(bot, allPlayers, food, viruses, currentTime, worldW, worldH);
    this.cached.set(bot.id, {
      ...decision,
      nextThink: currentTime + this.config.botAiIntervalMs + Math.random() * 80,
    });
    return decision;
  }

  private think(
    bot: Player,
    allPlayers: Player[],
    food: Food[],
    viruses: Virus[],
    currentTime: number,
    worldW: number = WORLD_WIDTH,
    worldH: number = WORLD_HEIGHT
  ): { targetX: number; targetY: number; shouldSplit: boolean } {
    const behavior = this.getBehavior(bot.id);
    const center = getPlayerCenter(bot);
    const botMass = getTotalMass(bot);
    const largestCell = bot.cells.reduce(
      (max, cell) => (cell.radius > max.radius ? cell : max),
      bot.cells[0]
    );

    const threats: { player: Player; distance: number; mass: number }[] = [];
    const prey: { player: Player; distance: number; mass: number }[] = [];

    for (const player of allPlayers) {
      if (player.id === bot.id || player.cells.length === 0) continue;

      const playerCenter = getPlayerCenter(player);
      const playerMass = getTotalMass(player);
      const dist = distance(center, playerCenter);

      // Cheap distance cull before sorting
      if (dist > 900) continue;

      if (playerMass > botMass * 1.25) {
        threats.push({ player, distance: dist, mass: playerMass });
      } else if (botMass > playerMass * 1.25) {
        prey.push({ player, distance: dist, mass: playerMass });
      }
    }

    threats.sort((a, b) => a.distance - b.distance);
    prey.sort((a, b) => a.distance - b.distance);

    // Sample food instead of sorting all pellets every think
    let closestFood: Food | null = null;
    let closestFoodDist = Infinity;
    const foodLen = food.length;
    const sample = Math.min(foodLen, 80);
    const step = foodLen > sample ? Math.floor(foodLen / sample) : 1;
    for (let i = 0; i < foodLen; i += step) {
      const f = food[i];
      const dx = f.x - center.x;
      const dy = f.y - center.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < closestFoodDist) {
        closestFoodDist = d2;
        closestFood = f;
      }
    }

    const nearbyViruses: { virus: Virus; distance: number }[] = [];
    for (const v of viruses) {
      const dist = distance(center, v);
      if (dist < 300) nearbyViruses.push({ virus: v, distance: dist });
    }
    nearbyViruses.sort((a, b) => a.distance - b.distance);

    let targetX = bot.targetX;
    let targetY = bot.targetY;
    let shouldSplit = false;

    const closestThreat = threats[0];
    const closestPrey = prey[0];
    const minSplitR = getRadius(this.config.minSplitMass);

    if (closestThreat && closestThreat.distance < 400 * behavior.caution) {
      const threatCenter = getPlayerCenter(closestThreat.player);
      const fleeAngle = Math.atan2(center.y - threatCenter.y, center.x - threatCenter.x);
      targetX = center.x + Math.cos(fleeAngle) * 500;
      targetY = center.y + Math.sin(fleeAngle) * 500;
    } else if (closestPrey && closestPrey.distance < 500 && Math.random() < behavior.aggressiveness) {
      const preyCenter = getPlayerCenter(closestPrey.player);
      targetX = preyCenter.x;
      targetY = preyCenter.y;

      if (
        largestCell.radius > minSplitR * 1.5 &&
        closestPrey.distance < 300 &&
        closestPrey.distance > 100 &&
        botMass > closestPrey.mass * 2.5 &&
        bot.cells.length < 4 &&
        currentTime - bot.lastSplit > 3000 &&
        Math.random() < behavior.aggressiveness * 0.5
      ) {
        shouldSplit = true;
      }
    } else if (closestFood && Math.random() < behavior.foodPriority + 0.3) {
      targetX = closestFood.x;
      targetY = closestFood.y;
    } else {
      const cooldown = this.decisionCooldown.get(bot.id) || 0;
      if (currentTime > cooldown) {
        targetX = Math.random() * worldW;
        targetY = Math.random() * worldH;
        this.decisionCooldown.set(bot.id, currentTime + 2000 + Math.random() * 3000);
      }
    }

    if (largestCell.radius > 50) {
      for (const { virus, distance: virusDist } of nearbyViruses) {
        if (virusDist < 150 * behavior.virusAwareness) {
          const avoidAngle = Math.atan2(center.y - virus.y, center.x - virus.x);
          targetX = center.x + Math.cos(avoidAngle) * 200;
          targetY = center.y + Math.sin(avoidAngle) * 200;
          shouldSplit = false;
          break;
        }
      }
    }

    targetX = Math.max(100, Math.min(worldW - 100, targetX));
    targetY = Math.max(100, Math.min(worldH - 100, targetY));

    return { targetX, targetY, shouldSplit };
  }

  cleanup(playerId: string) {
    this.behaviors.delete(playerId);
    this.decisionCooldown.delete(playerId);
    this.cached.delete(playerId);
  }
}
