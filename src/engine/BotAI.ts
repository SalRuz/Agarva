import { Player, Food, Virus, BotBehavior } from '../types/game';
import { 
  distance, 
  getPlayerCenter, 
  getTotalMass, 
  createBotBehavior,
  WORLD_WIDTH,
  WORLD_HEIGHT,
  MIN_SPLIT_RADIUS
} from '../utils/gameUtils';

export class BotAI {
  private behaviors: Map<string, BotBehavior> = new Map();
  private decisionCooldown: Map<string, number> = new Map();

  getBehavior(playerId: string): BotBehavior {
    if (!this.behaviors.has(playerId)) {
      this.behaviors.set(playerId, createBotBehavior());
    }
    return this.behaviors.get(playerId)!;
  }

  updateBot(
    bot: Player, 
    allPlayers: Player[], 
    food: Food[], 
    viruses: Virus[],
    currentTime: number
  ): { targetX: number; targetY: number; shouldSplit: boolean } {
    const behavior = this.getBehavior(bot.id);
    const center = getPlayerCenter(bot);
    const botMass = getTotalMass(bot);
    const largestCell = bot.cells.reduce((max, cell) => 
      cell.radius > max.radius ? cell : max, bot.cells[0]);

    // Find threats (larger players)
    const threats: { player: Player; distance: number; mass: number }[] = [];
    // Find prey (smaller players)
    const prey: { player: Player; distance: number; mass: number }[] = [];

    for (const player of allPlayers) {
      if (player.id === bot.id || player.cells.length === 0) continue;
      
      const playerCenter = getPlayerCenter(player);
      const playerMass = getTotalMass(player);
      const dist = distance(center, playerCenter);
      
      if (playerMass > botMass * 1.2) {
        threats.push({ player, distance: dist, mass: playerMass });
      } else if (botMass > playerMass * 1.2) {
        prey.push({ player, distance: dist, mass: playerMass });
      }
    }

    // Sort by distance
    threats.sort((a, b) => a.distance - b.distance);
    prey.sort((a, b) => a.distance - b.distance);

    // Find nearest food
    const nearbyFood = food
      .map(f => ({ food: f, distance: distance(center, f) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 10);

    // Find nearby viruses
    const nearbyViruses = viruses
      .map(v => ({ virus: v, distance: distance(center, v) }))
      .filter(v => v.distance < 300)
      .sort((a, b) => a.distance - b.distance);

    let targetX = bot.targetX;
    let targetY = bot.targetY;
    let shouldSplit = false;

    // Decision making
    const closestThreat = threats[0];
    const closestPrey = prey[0];
    const closestFood = nearbyFood[0];

    // Priority 1: Flee from threats
    if (closestThreat && closestThreat.distance < 400 * behavior.caution) {
      const threatCenter = getPlayerCenter(closestThreat.player);
      // Run away from threat
      const fleeAngle = Math.atan2(center.y - threatCenter.y, center.x - threatCenter.x);
      targetX = center.x + Math.cos(fleeAngle) * 500;
      targetY = center.y + Math.sin(fleeAngle) * 500;
    }
    // Priority 2: Hunt prey (if aggressive enough)
    else if (closestPrey && closestPrey.distance < 500 && Math.random() < behavior.aggressiveness) {
      const preyCenter = getPlayerCenter(closestPrey.player);
      targetX = preyCenter.x;
      targetY = preyCenter.y;

      // Consider splitting to catch prey
      if (
        largestCell.radius > MIN_SPLIT_RADIUS * 1.5 &&
        closestPrey.distance < 300 &&
        closestPrey.distance > 100 &&
        botMass > closestPrey.mass * 2.5 &&
        bot.cells.length < 4 &&
        currentTime - bot.lastSplit > 3000 &&
        Math.random() < behavior.aggressiveness * 0.5
      ) {
        shouldSplit = true;
      }
    }
    // Priority 3: Eat food
    else if (closestFood && Math.random() < behavior.foodPriority + 0.3) {
      targetX = closestFood.food.x;
      targetY = closestFood.food.y;
    }
    // Priority 4: Wander
    else {
      const cooldown = this.decisionCooldown.get(bot.id) || 0;
      if (currentTime > cooldown) {
        targetX = Math.random() * WORLD_WIDTH;
        targetY = Math.random() * WORLD_HEIGHT;
        this.decisionCooldown.set(bot.id, currentTime + 2000 + Math.random() * 3000);
      }
    }

    // Avoid viruses if large enough to pop
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

    // Keep within bounds
    targetX = Math.max(100, Math.min(WORLD_WIDTH - 100, targetX));
    targetY = Math.max(100, Math.min(WORLD_HEIGHT - 100, targetY));

    return { targetX, targetY, shouldSplit };
  }

  cleanup(playerId: string) {
    this.behaviors.delete(playerId);
    this.decisionCooldown.delete(playerId);
  }
}
