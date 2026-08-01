import { GameEngine } from '../shared/GameEngine';
import {
  cloneGameplayConfig,
  defaultSoloFightConfig,
  sanitizeGameplayConfig,
  type GameplayConfig,
} from '../shared/gameConfig';
import type { SoloFightHudMessage, SoloFightTopMessage } from '../shared/protocol';

export type RoomMode = 'classic' | 'soloFight' | 'duoFight' | 'trioFight';

export type SoloFightPhase =
  | 'waiting'
  | 'countdown'
  | 'fighting'
  | 'ended'
  | 'resetting'
  | 'between';

export const SOLO_FIGHT_COUNTDOWN_MS = 5000;
/** Seconds after win before arena clear / return to waiting. */
export const SOLO_FIGHT_RESET_MS = 5000;
/** @deprecated kept for import compatibility — rematch between-rounds removed */
export const SOLO_FIGHT_BETWEEN_MS = SOLO_FIGHT_RESET_MS;
export const SOLO_FIGHT_DURATION_MS = 5 * 60 * 1000;
/** Half-distance from center to each fighter — wider gap for ~5k start mass. */
const SPAWN_GAP = 2000;

export interface SoloFightState {
  phase: SoloFightPhase;
  countdownEndsAt: number;
  betweenEndsAt: number;
  resetEndsAt: number;
  /** Absolute timestamp when the fight timer expires */
  fightEndsAt: number;
  /** session socket ids or player session refs tracked externally */
  fighterPlayerIds: string[];
  /** Career wins, persisted and used by menu/Telegram tops. */
  scores: Map<string, number>;
  /** Consecutive match wins, used only by the in-match HUD. */
  streaks: Map<string, number>;
  names: string[];
}

export function createSoloFightEngine(config: GameplayConfig = defaultSoloFightConfig): {
  engine: GameEngine;
  config: GameplayConfig;
} {
  const cfg = sanitizeGameplayConfig(config);
  const engine = new GameEngine({
    botCount: 0,
    foodCount: 0,
    virusCount: 0,
    multiplayer: true,
    worldWidth: cfg.worldWidth,
    worldHeight: cfg.worldHeight,
    config: cfg,
  });
  engine.clearArenaLoot();
  return { engine, config: cfg };
}

export function makeSoloFightHud(state: SoloFightState): SoloFightHudMessage {
  const now = Date.now();
  let countdown = 0;
  if (state.phase === 'countdown') {
    countdown = Math.max(0, Math.ceil((state.countdownEndsAt - now) / 1000));
  } else if (state.phase === 'ended' && state.resetEndsAt > 0) {
    countdown = Math.max(0, Math.ceil((state.resetEndsAt - now) / 1000));
  }
  let fightSecondsLeft: number | undefined;
  if (state.phase === 'fighting' && state.fightEndsAt > 0) {
    fightSecondsLeft = Math.max(0, Math.ceil((state.fightEndsAt - now) / 1000));
  }
  const aName = state.names[0] || '—';
  const bName = state.names[1] || '—';
  return {
    type: 'soloFightHud',
    phase: state.phase,
    countdown,
    fightSecondsLeft,
    a: { name: aName, score: state.streaks.get(aName) ?? 0 },
    b: { name: bName, score: state.streaks.get(bName) ?? 0 },
  };
}

export function makeSoloFightTop(state: SoloFightState, limit = 20): SoloFightTopMessage {
  const entries = [...state.scores.entries()]
    .map(([name, score]) => ({ name, score }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit);
  return { type: 'soloFightTop', entries };
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
    resetEndsAt: 0,
    fightEndsAt: 0,
    fighterPlayerIds: [],
    scores: new Map(),
    streaks: new Map(),
    names: [],
  };
}

export function cloneSoloDefaults(): GameplayConfig {
  return cloneGameplayConfig(defaultSoloFightConfig);
}

export function isSoloFightJoinBlocked(phase: SoloFightPhase): boolean {
  return (
    phase === 'fighting' ||
    phase === 'countdown'
  );
}
