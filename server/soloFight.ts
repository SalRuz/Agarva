import { GameEngine } from '../shared/GameEngine';
import {
  cloneGameplayConfig,
  defaultSoloFightConfig,
  sanitizeGameplayConfig,
  type GameplayConfig,
} from '../shared/gameConfig';
import type { SoloFightHudMessage } from '../shared/protocol';

export type RoomMode = 'classic' | 'soloFight';

export type SoloFightPhase = 'waiting' | 'countdown' | 'fighting' | 'between';

export const SOLO_FIGHT_COUNTDOWN_MS = 5000;
export const SOLO_FIGHT_BETWEEN_MS = 2500;
/** Half-distance from center to each fighter — medium gap for ~5k start mass (r≈707). */
const SPAWN_GAP = 1000;

export interface SoloFightState {
  phase: SoloFightPhase;
  countdownEndsAt: number;
  betweenEndsAt: number;
  /** session socket ids or player session refs tracked externally */
  fighterPlayerIds: string[];
  scores: Map<string, number>; // by player name
  names: string[];
}

export function createSoloFightEngine(config: GameplayConfig = defaultSoloFightConfig): {
  engine: GameEngine;
  config: GameplayConfig;
} {
  const cfg = sanitizeGameplayConfig(config);
  const engine = new GameEngine({
    botCount: cfg.botCountMp,
    foodCount: cfg.foodCountMp,
    virusCount: cfg.virusCount,
    multiplayer: true,
    worldWidth: cfg.worldWidth,
    worldHeight: cfg.worldHeight,
    config: cfg,
  });
  return { engine, config: cfg };
}

export function makeSoloFightHud(state: SoloFightState): SoloFightHudMessage {
  const now = Date.now();
  let countdown = 0;
  if (state.phase === 'countdown') {
    countdown = Math.max(0, Math.ceil((state.countdownEndsAt - now) / 1000));
  }
  const aName = state.names[0] || '—';
  const bName = state.names[1] || '—';
  return {
    type: 'soloFightHud',
    phase: state.phase,
    countdown,
    a: { name: aName, score: state.scores.get(aName) ?? 0 },
    b: { name: bName, score: state.scores.get(bName) ?? 0 },
  };
}

export function soloFightSpawnPoints(worldW: number, worldH: number): [{ x: number; y: number }, { x: number; y: number }] {
  const cx = worldW / 2;
  const cy = worldH / 2;
  return [
    { x: cx - SPAWN_GAP, y: cy },
    { x: cx + SPAWN_GAP, y: cy },
  ];
}

export function createEmptySoloFightState(): SoloFightState {
  return {
    phase: 'waiting',
    countdownEndsAt: 0,
    betweenEndsAt: 0,
    fighterPlayerIds: [],
    scores: new Map(),
    names: [],
  };
}

export function cloneSoloDefaults(): GameplayConfig {
  return cloneGameplayConfig(defaultSoloFightConfig);
}
