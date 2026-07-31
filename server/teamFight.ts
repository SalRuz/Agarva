import { GameEngine } from '../shared/GameEngine';
import {
  sanitizeGameplayConfig,
  type GameplayConfig,
  SOLO_FIGHT_START_MASS,
} from '../shared/gameConfig';
import type { FightTeam, TeamFightHudMessage, TeamFightTopMessage } from '../shared/protocol';
import type { SoloFightPhase } from './soloFight';

export type TeamFightMode = 'duoFight' | 'trioFight';
export const TEAM_FIGHT_WORLD_SIZE = 20000;
export const TEAM_FIGHT_COUNTDOWN_MS = 5000;
export const TEAM_FIGHT_RESET_MS = 5000;
export const TEAM_FIGHT_DURATION_MS = 5 * 60 * 1000;

export interface TeamFightState {
  phase: SoloFightPhase;
  countdownEndsAt: number;
  resetEndsAt: number;
  fightEndsAt: number;
  scores: Map<string, number>;
}

export function teamSizeFor(mode: TeamFightMode): number {
  return mode === 'duoFight' ? 2 : 3;
}

export function createTeamFightEngine(config: GameplayConfig): { engine: GameEngine; config: GameplayConfig } {
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

export function syncTeamFightFromClassic(classic: GameplayConfig): GameplayConfig {
  const density = (TEAM_FIGHT_WORLD_SIZE * TEAM_FIGHT_WORLD_SIZE) / Math.max(1, classic.worldWidth * classic.worldHeight);
  return sanitizeGameplayConfig({
    ...classic,
    worldWidth: TEAM_FIGHT_WORLD_SIZE,
    worldHeight: TEAM_FIGHT_WORLD_SIZE,
    botCountMp: 0,
    botCountSolo: 0,
    foodCountMp: Math.round(classic.foodCountMp * density),
    foodCountSolo: Math.round(classic.foodCountSolo * density),
    foodRespawnThreshold: Math.round(classic.foodRespawnThreshold * density),
    virusCount: Math.round(classic.virusCount * density),
  });
}

export function createEmptyTeamFightState(): TeamFightState {
  return { phase: 'waiting', countdownEndsAt: 0, resetEndsAt: 0, fightEndsAt: 0, scores: new Map() };
}

export function teamFightSpawnPoint(
  worldW: number,
  worldH: number,
  team: FightTeam,
  index: number,
  teamSize: number
): { x: number; y: number } {
  const ySpacing = 750;
  return {
    x: worldW / 2 + (team === 'blue' ? -2000 : 2000),
    y: worldH / 2 + (index - (teamSize - 1) / 2) * ySpacing,
  };
}

export function makeTeamFightHud(
  mode: TeamFightMode,
  state: TeamFightState,
  members: (team: FightTeam) => { name: string; alive: boolean }[]
): TeamFightHudMessage {
  const now = Date.now();
  const toSide = (team: FightTeam) => {
    const list = members(team);
    return { alive: list.filter((x) => x.alive).length, total: teamSizeFor(mode), members: list.map((x) => x.name) };
  };
  return {
    type: 'teamFightHud',
    mode,
    phase: state.phase,
    countdown:
      state.phase === 'countdown'
        ? Math.max(0, Math.ceil((state.countdownEndsAt - now) / 1000))
        : state.phase === 'ended'
          ? Math.max(0, Math.ceil((state.resetEndsAt - now) / 1000))
          : 0,
    fightSecondsLeft:
      state.phase === 'fighting' ? Math.max(0, Math.ceil((state.fightEndsAt - now) / 1000)) : undefined,
    blue: toSide('blue'),
    red: toSide('red'),
  };
}

export function makeTeamFightTop(mode: TeamFightMode, state: TeamFightState): TeamFightTopMessage {
  return {
    type: 'teamFightTop',
    mode,
    entries: [...state.scores.entries()]
      .map(([name, score]) => ({ name, score }))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .slice(0, 20),
  };
}

export { SOLO_FIGHT_START_MASS as TEAM_FIGHT_START_MASS };
