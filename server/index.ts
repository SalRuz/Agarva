import { WebSocketServer, WebSocket } from 'ws';
import { execSync } from 'node:child_process';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomInt, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import 'dotenv/config';
import { GameEngine } from '../shared/GameEngine';
import {
  defaultGameplayConfig,
  sanitizeGameplayConfig,
  syncSoloFightFromClassic,
  SOLO_FIGHT_START_MASS,
  type GameplayConfig,
} from '../shared/gameConfig';
import {
  DEFAULT_SERVER_PORT,
  CHAT_MAX_LENGTH,
  CHAT_RATE_LIMIT_MS,
  ADMIN_PASSWORD,
} from '../shared/constants';
import {
  getPlayerCenter,
  isAdminName,
  createFood,
  getTotalMass,
} from '../shared/physics';
import { getEntityViewRadius, isEntityNearView } from '../shared/sectors';
import type { ClientMessage, ServerMessage, NetPlayer, StateMessage } from '../shared/protocol';
import type { FightTeam } from '../shared/protocol';
import type { Player } from '../shared/types';
import {
  applyQuestProgressValue,
  createDefaultQuestProgress,
  emptyQuestRunStats,
  questValueFromRun,
  sanitizeQuestProgress,
  toQuestPublicView,
  QUEST_DEFS,
  type QuestProgress,
  type QuestRunStats,
} from '../shared/quests';
import {
  type RoomMode,
  createSoloFightEngine,
  createEmptySoloFightState,
  makeSoloFightHud,
  makeSoloFightTop,
  soloFightSpawnPoints,
  SOLO_FIGHT_COUNTDOWN_MS,
  SOLO_FIGHT_RESET_MS,
  SOLO_FIGHT_DURATION_MS,
  isSoloFightJoinBlocked,
  type SoloFightState,
} from './soloFight';
import {
  type TeamFightMode,
  type TeamFightState,
  createEmptyTeamFightState,
  createTeamFightEngine,
  makeTeamFightHud,
  makeTeamFightTop,
  syncTeamFightFromClassic,
  teamFightSpawnPoint,
  teamSizeFor,
  TEAM_FIGHT_COUNTDOWN_MS,
  TEAM_FIGHT_DURATION_MS,
  TEAM_FIGHT_RESET_MS,
  TEAM_FIGHT_START_MASS,
} from './teamFight';
import { PersistentStore, type FightMode } from './persistentStore';
import { BotLogBuffer } from './botLogs';
import { startTelegramBot } from '../bot/index';

const PORT = Number(process.env.PORT) || DEFAULT_SERVER_PORT;
/** Physics stays at 30 Hz; mobile snapshots are sent at 10 Hz. */
const STATE_SEND_MODULO = 3;
/** Retain virus snapshots briefly across a circular-FOV boundary. */
const SNAPSHOT_STICKY_MS = 900;
const SNAPSHOT_STICKY_VIEW_MULT = 1.28;
const CUSTOM_SKIN_MAX_BYTES = 10 * 1024 * 1024;
const customSkinDir = join(process.cwd(), 'data', 'skins');
const STATE_BACKPRESSURE_BYTES = 32_000;
const BOT_CHAT_BUFFER_SIZE = 200;
const PASSWORD_RESET_TTL_MS = 10 * 60 * 1000;
const QUEST_PROFILE_PUSH_MS = 10_000;

interface ClientSession {
  ws: WebSocket;
  /** All player entities owned by this WS (multibox, max 2) */
  playerIds: string[];
  /** Index into playerIds for input routing / camera */
  activeIndex: number;
  joined: boolean;
  isAdmin: boolean;
  /** True after correct admin password for an admin nickname */
  adminAuthed: boolean;
  /** Menu watcher — only receives roomInfo, not game state */
  lobbyOnly: boolean;
  /** Spectating room (receives state, no player body) */
  spectating: boolean;
  /** Which engine/room this session belongs to */
  room: RoomMode;
  team?: FightTeam;
  /** Fixed Duo/Trio spawn slot; released immediately on leave. */
  spawnSlot?: number;
  /** View center for FOV when not controlling a live player */
  viewX: number;
  viewY: number;
  lastChatAt: number;
  lastName: string;
  lastColor: string;
  lastSkin: string;
  /** Stable device profile id */
  deviceId: string;
  /** Room we already announced join for (no re-announce on respawn). */
  joinAnnouncedRoom: RoomMode | null;
  /** Tick counter for throttling heavy extras */
  tickCount: number;
  lastSfHudKey: string;
  /** Last skin per entity sent to this client; removed when it leaves this FOV. */
  sentSkins: Map<string, string>;
  /** Virus ids recently included in this client's circular snapshots. */
  sentVirusUntil: Map<string, number>;
  /** Every entity id this client can still render until explicitly destroyed. */
  knownFoodIds: Set<string>;
  knownEjectIds: Set<string>;
  knownVirusIds: Set<string>;
  /** Per-life quest counters while playing */
  questRun: QuestRunStats | null;
  /** In-memory quest state for the connected device (avoids reload lag). */
  questProgress: QuestProgress | null;
  lastQuestPushAt: number;
  /** Last minute-quest condition sent to the client. */
  questTimerRunning: boolean;
  /** Account key for which this websocket is the quest-progress primary tab. */
  questAccountKey: string | null;
}

interface BotChatLine {
  id: number;
  room: RoomMode;
  name: string;
  text: string;
  t: number;
}

interface BotOutboxMessage {
  id: number;
  chatId: string;
  text: string;
}

interface PasswordResetCode {
  code: string;
  expiresAt: number;
}

function parseMode(mode?: string): RoomMode {
  return mode === 'soloFight' || mode === 'duoFight' || mode === 'trioFight' ? mode : 'classic';
}

function activePlayerId(session: ClientSession): string | null {
  return session.playerIds[session.activeIndex] ?? session.playerIds[0] ?? null;
}

function clearSessionPlayers(session: ClientSession, engine: GameEngine) {
  for (const id of session.playerIds) {
    engine.removePlayer(id);
  }
  session.playerIds = [];
  session.activeIndex = 0;
}

function checkAdminPassword(password: unknown): boolean {
  return String(password ?? '') === ADMIN_PASSWORD;
}

function refreshAdmin(session: ClientSession) {
  session.isAdmin = isAdminName(session.lastName) && session.adminAuthed;
}

function tryFreePort(port: number): boolean {
  if (process.platform !== 'win32') return false;
  try {
    const out = execSync(`netstat -ano | findstr :${port}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const pids = new Set<string>();
    for (const line of out.split(/\r?\n/)) {
      if (!/LISTENING/i.test(line)) continue;
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && /^\d+$/.test(pid) && pid !== '0') pids.add(pid);
    }
    let killed = false;
    for (const pid of pids) {
      try {
        const task = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        if (!/node\.exe/i.test(task)) continue;
        execSync(`taskkill /PID ${pid} /F`, { stdio: ['pipe', 'pipe', 'pipe'] });
        console.log(`[agar-server] Freed port ${port} (old node PID ${pid})`);
        killed = true;
      } catch {
        // ignore
      }
    }
    return killed;
  } catch {
    return false;
  }
}

function printEaddrInUseHelp(port: number) {
  console.error('');
  console.error(`[agar-server] Error: port ${port} already in use (EADDRINUSE).`);
  console.error('Possible causes: server already running, or leftover node process.');
  console.error('');
  console.error('Windows - find and kill process:');
  console.error(`  netstat -ano | findstr :${port}`);
  console.error('  taskkill /PID <pid> /F');
  console.error('');
  console.error('Or set another port:');
  console.error(`  set PORT=3002 && npm run server`);
  console.error('');
}

function sanitizeChat(text: string): string {
  return text
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, CHAT_MAX_LENGTH);
}

function startServer(attempt = 0) {
  const persistentStore = new PersistentStore();
  const botLogs = new BotLogBuffer();
  const getCustomLevelSkinRewards = () => {
    const rewards: Record<number, { id: string; name: string }[]> = {};
    for (const skin of persistentStore.getCustomSkins()) {
      if (skin.kind !== 'level' || !skin.level) continue;
      (rewards[skin.level] ??= []).push({ id: skin.id, name: skin.name });
    }
    return rewards;
  };
  let classicConfig: GameplayConfig = sanitizeGameplayConfig(
    persistentStore.getConfig() ?? defaultGameplayConfig
  );
  const classicEngine = new GameEngine({
    botCount: classicConfig.botCountMp,
    foodCount: classicConfig.foodCountMp,
    virusCount: classicConfig.virusCount,
    multiplayer: true,
    worldWidth: classicConfig.worldWidth,
    worldHeight: classicConfig.worldHeight,
    config: classicConfig,
  });

  const sfCreated = createSoloFightEngine(syncSoloFightFromClassic(classicConfig));
  let soloFightConfig: GameplayConfig = sfCreated.config;
  const soloFightEngine = sfCreated.engine;
  const sfState: SoloFightState = createEmptySoloFightState();
  sfState.scores = persistentStore.getScores('soloFight');
  /** Registered duelists (kept through death until leave / both gone) */
  let sfDuelists: ClientSession[] = [];
  /** Joins received while the finished arena is being cleared. */
  const pendingSoloFightJoins: { session: ClientSession; name: string; skin: string }[] = [];
  /** Guard against re-entrant match end (death + timeout same tick) */
  let sfMatchEnding = false;
  const duoCreated = createTeamFightEngine(syncTeamFightFromClassic(classicConfig));
  const trioCreated = createTeamFightEngine(syncTeamFightFromClassic(classicConfig));
  let duoFightConfig = duoCreated.config;
  let trioFightConfig = trioCreated.config;
  const duoFightEngine = duoCreated.engine;
  const trioFightEngine = trioCreated.engine;
  const teamStates: Record<TeamFightMode, TeamFightState> = {
    duoFight: { ...createEmptyTeamFightState(), scores: persistentStore.getScores('duoFight') },
    trioFight: { ...createEmptyTeamFightState(), scores: persistentStore.getScores('trioFight') },
  };
  const teamFighters: Record<TeamFightMode, ClientSession[]> = { duoFight: [], trioFight: [] };
  /** Team selections received while the finished arena is being cleared. */
  const pendingTeamFightJoins: Record<
    TeamFightMode,
    { session: ClientSession; name: string; skin: string; team: FightTeam }[]
  > = { duoFight: [], trioFight: [] };

  const clients = new Map<WebSocket, ClientSession>();
  /** First connected websocket per account is allowed to advance quests. */
  const questPrimaryByAccount = new Map<string, WebSocket>();
  const botChatLines: Record<RoomMode, BotChatLine[]> = {
    classic: [],
    soloFight: [],
    duoFight: [],
    trioFight: [],
  };
  let nextBotChatId = 1;
  const botOutbox: BotOutboxMessage[] = [];
  let nextBotOutboxId = 1;
  const passwordResetCodes = new Map<string, PasswordResetCode>();
  let lastClassicRecordAnnouncement = 0;

  function removePendingFightJoin(session: ClientSession) {
    for (let i = pendingSoloFightJoins.length - 1; i >= 0; i--) {
      if (pendingSoloFightJoins[i].session === session) pendingSoloFightJoins.splice(i, 1);
    }
    for (const mode of ['duoFight', 'trioFight'] as TeamFightMode[]) {
      pendingTeamFightJoins[mode] = pendingTeamFightJoins[mode].filter((entry) => entry.session !== session);
    }
  }

  function engineFor(room: RoomMode): GameEngine {
    if (room === 'soloFight') return soloFightEngine;
    if (room === 'duoFight') return duoFightEngine;
    if (room === 'trioFight') return trioFightEngine;
    return classicEngine;
  }

  function configFor(room: RoomMode): GameplayConfig {
    if (room === 'soloFight') return soloFightConfig;
    if (room === 'duoFight') return duoFightConfig;
    if (room === 'trioFight') return trioFightConfig;
    return classicConfig;
  }

  function sendSerialized(ws: WebSocket, serialized: string, bypassBackpressure = false) {
    if (ws.readyState !== WebSocket.OPEN) return;
    // Drop when client can't drain - prevents ping spikes from queue growth
    if (!bypassBackpressure && ws.bufferedAmount > 128_000) return;
    ws.send(serialized);
  }

  function send(ws: WebSocket, msg: ServerMessage) {
    sendSerialized(ws, JSON.stringify(msg));
  }

  /** Pongs must not be discarded merely because a state packet is queued. */
  function sendPong(ws: WebSocket, t: number) {
    sendSerialized(ws, JSON.stringify({ type: 'pong', t }), true);
  }

  function claimQuestPrimary(session: ClientSession, accountLogin?: string): boolean {
    const key = accountLogin?.trim().toLowerCase();
    if (!key) {
      session.questAccountKey = null;
      return false;
    }
    session.questAccountKey = key;
    const current = questPrimaryByAccount.get(key);
    if (!current || current.readyState !== WebSocket.OPEN) {
      questPrimaryByAccount.set(key, session.ws);
      return true;
    }
    return current === session.ws;
  }

  function isQuestPrimary(session: ClientSession, accountLogin?: string): boolean {
    return claimQuestPrimary(session, accountLogin) && questPrimaryByAccount.get(session.questAccountKey!) === session.ws;
  }

  function beginQuestLife(session: ClientSession) {
    session.questRun = emptyQuestRunStats();
    session.questRun.startedFromZero = true;
  }

  function broadcastToRoom(room: RoomMode, msg: ServerMessage) {
    const serialized = JSON.stringify(msg);
    for (const [ws, session] of clients) {
      if (session.room !== room) continue;
      sendSerialized(ws, serialized);
    }
  }

  function queueGameChat(room: RoomMode, name: string, text: string, t: number) {
    const queue = botChatLines[room];
    queue.push({ id: nextBotChatId++, room, name, text, t });
    if (queue.length > BOT_CHAT_BUFFER_SIZE) queue.splice(0, queue.length - BOT_CHAT_BUFFER_SIZE);
  }

  function broadcastGameChat(
    room: RoomMode,
    name: string,
    text: string,
    color: string,
    badge?: { level?: number; hideLevel?: boolean }
  ) {
    const t = Date.now();
    broadcastToRoom(room, { type: 'chat', name, text, t, color, ...badge });
    queueGameChat(room, name, text, t);
  }

  const weeklyEntries = (mode: RoomMode) =>
    mode === 'classic'
      ? persistentStore.getClassicRecords().map((record) => ({ name: record.name, score: record.mass }))
      : [...persistentStore.getScores(mode).entries()]
          .map(([name, score]) => ({ name, score }))
          .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
          .slice(0, 20);

  function centerLeaderFor(room: RoomMode): { name: string; skin?: string; score: number } | undefined {
    if (room === 'classic') {
      const record = persistentStore.getClassicRecords()[0];
      if (record) return { name: record.name, skin: record.skin, score: record.mass };
    }
    return weeklyEntries(room)[0];
  }

  function processWeeklyTops(now = Date.now()) {
    for (const mode of ['classic', 'soloFight', 'duoFight', 'trioFight'] as RoomMode[]) {
      if (persistentStore.getWeeklyTopEndsAt(mode) > now) continue;
      const winner = weeklyEntries(mode)[0];
      let awarded = false;
      if (winner) {
        const deviceId = mode === 'classic'
          ? persistentStore.getClassicRecords()[0]?.deviceId
          : persistentStore.findAccountDeviceByNick(winner.name);
        const prize = persistentStore.getWeeklyTopPrize(mode);
        awarded = !!(deviceId && persistentStore.awardAgarviki(deviceId, prize));
        if (awarded) {
          broadcastGameChat(mode, '🏆 Система', `Игрок ${winner.name} получил ${prize} агарвиков за недельный топ!`, '#facc15');
        }
      }
      persistentStore.resetWeeklyTop(mode, now);
      if (!awarded && winner) {
        broadcastGameChat(mode, '🏆 Система', `Недельный топ завершён. Награда не выдана: лидер без привязанного аккаунта.`, '#facc15');
      }
    }
  }

  function queueBotMessage(chatId: string, text: string) {
    botOutbox.push({ id: nextBotOutboxId++, chatId, text });
  }

  function toNetPlayer(
    p: Player,
    cellFilter?: (c: Player['cells'][0]) => boolean,
    includeSkin = false
  ): NetPlayer {
    const cells = cellFilter ? p.cells.filter(cellFilter) : p.cells;
    const net: NetPlayer = {
      id: p.id,
      name: p.name,
      color: p.color,
      score: p.score,
      cells: cells.map((c) => ({
        id: c.id,
        x: Math.round(c.x),
        y: Math.round(c.y),
        r: Math.round(c.radius * 2) / 2,
        c: c.color,
      })),
      fr: p.frozen ? 1 : 0,
    };
    if (includeSkin) net.skin = p.skin || '';
    return net;
  }

  /**
   * Leaderboard data is identical for every viewer in a room. Building it once
   * per snapshot cycle avoids repeating the sort and profile lookup for every
   * connected client without altering any state packet's contents.
   */
  function buildLeaderboardFor(engine: GameEngine): NonNullable<StateMessage['leaderboard']> {
    const state = engine.getState();
    return engine.getLeaderboard().map((row) => {
      if (row.isBot) return row;
      const pl = state.players.find((p) => p.name === row.name && p.cells.length > 0);
      if (!pl) return row;
      let level: number | undefined;
      let hideLevel = false;
      for (const s of clients.values()) {
        if (!s.playerIds.includes(pl.id)) continue;
        const profile = s.deviceId ? persistentStore.getPlayer(s.deviceId) : undefined;
        hideLevel = profile?.prefs?.hideLevel === true;
        if (!hideLevel) {
          if (s.questProgress) level = toQuestPublicView(s.questProgress).level;
          else if (profile?.accountLogin) level = toQuestPublicView(sanitizeQuestProgress(profile.quests)).level;
        }
        break;
      }
      return hideLevel ? { ...row, hideLevel: true } : level === undefined ? row : { ...row, level };
    });
  }

  /**
   * Restore the classic view: the nearest real food/W inside the FOV are sent
   * first. Recently sent entities get a short expanded-FOV grace period only
   * to avoid boundary flicker between snapshots.
   */
  function collectStableInView<T extends { id: string; x: number; y: number }>(
    items: T[],
    cx: number,
    cy: number,
    viewR: number,
    max: number,
    stickyUntil: Map<string, number>,
    priority?: (item: T) => number
  ): T[] {
    if (max <= 0 || items.length === 0) return [];
    const now = Date.now();
    const viewR2 = viewR * viewR;
    const expandedR = viewR * SNAPSHOT_STICKY_VIEW_MULT;
    const expandedR2 = expandedR * expandedR;
    const byId = new Map(items.map((item) => [item.id, item]));
    const distanceSq = (item: T) => {
      const dx = item.x - cx;
      const dy = item.y - cy;
      return dx * dx + dy * dy;
    };
    const isExpanded = (item: T) => {
      return distanceSq(item) <= expandedR2;
    };
    for (const [id, until] of stickyUntil) {
      const item = byId.get(id);
      if (!item || until < now || !isExpanded(item)) stickyUntil.delete(id);
    }

    const selected: T[] = [];
    const selectedIds = new Set<string>();
    const add = (item: T) => {
      if (selected.length >= max || selectedIds.has(item.id) || !isExpanded(item)) return;
      selected.push(item);
      selectedIds.add(item.id);
    };

    const compare = (a: T, b: T) =>
      (priority?.(b) ?? 0) - (priority?.(a) ?? 0) ||
      distanceSq(a) - distanceSq(b) ||
      a.id.localeCompare(b.id);
    for (const item of [...items]
      .filter((item) => stickyUntil.has(item.id))
      .sort(compare)) {
      add(item);
    }
    if (selected.length < max) {
      for (const item of [...items]
        .filter((item) => !selectedIds.has(item.id) && distanceSq(item) <= viewR2)
        .sort(compare)) {
        add(item);
        if (selected.length === max) break;
      }
    }
    for (const item of selected) stickyUntil.set(item.id, now + SNAPSHOT_STICKY_MS);
    return selected;
  }

  /**
   * A cap/FOV omission is not a despawn. Only ids that were previously sent
   * and no longer exist in the authoritative engine state are tombstoned.
   */
  function collectDestroyedIds<T extends { id: string }>(knownIds: Set<string>, live: T[]): string[] {
    const liveIds = new Set(live.map((entity) => entity.id));
    const removed: string[] = [];
    for (const id of knownIds) {
      if (liveIds.has(id)) continue;
      knownIds.delete(id);
      removed.push(id);
    }
    return removed;
  }

  function buildStateFor(
    session: ClientSession,
    leaderboard?: NonNullable<StateMessage['leaderboard']>
  ): StateMessage {
    const engine = engineFor(session.room);
    const cfg = configFor(session.room);
    const state = engine.getState();
    const ww = state.worldWidth;
    const wh = state.worldHeight;
    const ownedSet = new Set(session.playerIds);
    const activeId = activePlayerId(session);
    let youPlayer = activeId ? state.players.find((p) => p.id === activeId) : undefined;
    if (youPlayer && youPlayer.cells.length === 0) youPlayer = undefined;
    if (!youPlayer) {
      for (const id of session.playerIds) {
        const p = state.players.find((x) => x.id === id && x.cells.length > 0);
        if (p) {
          youPlayer = p;
          break;
        }
      }
    }
    const playing = !!(youPlayer && youPlayer.cells.length > 0);
    const youId = youPlayer?.id;
    const center = playing
      ? getPlayerCenter(youPlayer!)
      : {
          x: Number.isFinite(session.viewX) ? session.viewX : ww / 2,
          y: Number.isFinite(session.viewY) ? session.viewY : wh / 2,
        };

    const viewMult = playing ? cfg.playViewRadiusMult : cfg.spectateViewRadiusMult;
    const viewR = getEntityViewRadius(ww, wh, viewMult);
    const cellInView = (x: number, y: number, r: number) =>
      isEntityNearView(x, y, r, center.x, center.y, viewR);
    // A continuous camera-centered FOV replaces sector-neighborhood loading.
    // Every entity class uses this same reach; client-side screen culling stays separate.
    const particleInView = (x: number, y: number, radius = 0) =>
      isEntityNearView(x, y, radius, center.x, center.y, viewR);
    // Food is static and plentiful. In low-traffic mode send a complete
    // sector snapshot every third state packet (about 3.3 Hz), while cells,
    // viruses, and flying W remain authoritative at the normal 10 Hz.
    const includeFood = cfg.lowTrafficMode < 0.5 || session.tickCount % 9 === 0;
    const removedFoodIds = includeFood
      ? collectDestroyedIds(session.knownFoodIds, state.food)
      : [];
    const removedVirusIds = collectDestroyedIds(session.knownVirusIds, state.viruses);
    const removedEjectedIds = collectDestroyedIds(session.knownEjectIds, state.ejectedMass);

    const food = includeFood
      ? state.food.filter((f) => particleInView(f.x, f.y)).map((f) => ({
          id: f.id,
          x: Math.round(f.x),
          y: Math.round(f.y),
          c: f.color,
        }))
      : undefined;

    // Viruses are not part of the food cap, but still receive the same
    // expanded-FOV grace. A moving or boundary-adjacent spike must not vanish
    // simply because one 10 Hz snapshot lands just outside the circle.
    const viruses = collectStableInView(
      state.viruses,
      center.x,
      center.y,
      viewR,
      Number.MAX_SAFE_INTEGER,
      session.sentVirusUntil,
      (virus) => Math.hypot(virus.velocityX, virus.velocityY) > 2 ? 1 : 0
    ).map((v) => ({
        id: v.id,
        x: Math.round(v.x),
        y: Math.round(v.y),
        r: Math.round(v.radius),
        ch: v.charge,
      }));

    const ejected = state.ejectedMass.filter((e) => particleInView(e.x, e.y, e.radius)).map((e) => ({
        id: e.id,
        x: Math.round(e.x),
        y: Math.round(e.y),
        r: Math.round(e.radius * 2) / 2,
        c: e.color,
      }));
    for (const entity of food ?? []) session.knownFoodIds.add(entity.id);
    for (const entity of viruses) session.knownVirusIds.add(entity.id);
    for (const entity of ejected) session.knownEjectIds.add(entity.id);

    const visibleIds = new Set<string>();
    const includeSkin = (p: Player) => {
      visibleIds.add(p.id);
      const skin = p.skin || '';
      const shouldSend = skin.length <= 80 && session.sentSkins.get(p.id) !== skin;
      if (shouldSend) session.sentSkins.set(p.id, skin);
      return shouldSend;
    };
    const players = state.players
      .filter((p) => p.cells.length > 0 && p.id !== youId)
      .map((p) => {
        if (ownedSet.has(p.id)) return toNetPlayer(p, undefined, includeSkin(p));
        const filteredCells = (c: Player['cells'][0]) => cellInView(c.x, c.y, c.radius);
        if (!p.cells.some(filteredCells)) return null;
        return toNetPlayer(p, filteredCells, includeSkin(p));
      })
      .filter((p): p is NetPlayer => p !== null);
    for (const id of session.sentSkins.keys()) {
      if (!visibleIds.has(id) && id !== youId) session.sentSkins.delete(id);
    }

    const msg: StateMessage = {
      type: 'state',
      t: Date.now(),
      you: playing ? toNetPlayer(youPlayer!, undefined, includeSkin(youPlayer!)) : null,
      players,
      food,
      viruses,
      ejected,
      removedFoodIds: removedFoodIds.length > 0 ? removedFoodIds : undefined,
      removedVirusIds: removedVirusIds.length > 0 ? removedVirusIds : undefined,
      removedEjectedIds: removedEjectedIds.length > 0 ? removedEjectedIds : undefined,
      ownedIds: session.playerIds.length > 0 ? [...session.playerIds] : undefined,
      centerLeader: centerLeaderFor(session.room),
    };
    if (leaderboard) msg.leaderboard = leaderboard;
    return msg;
  }

  // Try to free leftover node listener once before bind
  if (attempt === 0) {
    tryFreePort(PORT);
  }

  const httpServer = createServer((req, res) => {
    void handleHttpApi(req, res);
  });
  const wss = new WebSocketServer({
    noServer: true,
    // Compression spikes zlib CPU under concurrent mobile clients. Small,
    // capped JSON snapshots are cheaper and more latency-stable uncompressed.
    perMessageDeflate: false,
  });
  httpServer.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  let listening = false;
  let tickTimer: ReturnType<typeof setInterval> | null = null;
  const getTickMs = () =>
    1000 / Math.max(1, Math.max(classicConfig.serverTickHz, soloFightConfig.serverTickHz));

  function syncWorldAndPopulation(engine: GameEngine, config: GameplayConfig) {
    engine.setConfig(config);
    engine.setWorldSize(config.worldWidth, config.worldHeight);
    const state = engine.getState();
    while (state.viruses.length > config.virusCount) state.viruses.pop();
    while (state.food.length > config.foodCountMp) state.food.pop();
    while (state.players.filter((p) => p.isBot).length > config.botCountMp) {
      const bot = state.players.find((p) => p.isBot);
      if (!bot) break;
      engine.removePlayer(bot.id);
    }
    while (state.players.filter((p) => p.isBot).length < config.botCountMp) {
      engine.addPlayer(`Bot${Math.floor(Math.random() * 9999)}`, true);
    }
    // Only refill when arena loot is enabled (SF waiting keeps targets at 0)
    if (engine.isArenaLootEnabled()) {
      if (state.food.length < config.foodCountMp) {
        state.food.push(
          ...createFood(
            config.foodCountMp - state.food.length,
            state.worldWidth,
            state.worldHeight,
            config
          )
        );
      }
    } else {
      engine.clearArenaLoot();
    }
  }

  function applyClassicConfigAndSyncSf(next: GameplayConfig) {
    classicConfig = sanitizeGameplayConfig(next);
    syncWorldAndPopulation(classicEngine, classicConfig);
    soloFightConfig = syncSoloFightFromClassic(classicConfig);
    syncWorldAndPopulation(soloFightEngine, soloFightConfig);
    duoFightConfig = syncTeamFightFromClassic(classicConfig);
    trioFightConfig = syncTeamFightFromClassic(classicConfig);
    syncWorldAndPopulation(duoFightEngine, duoFightConfig);
    syncWorldAndPopulation(trioFightEngine, trioFightConfig);
    if (sfState.phase !== 'countdown' && sfState.phase !== 'fighting') {
      soloFightEngine.clearArenaLoot();
    }
  }

  function wipePersistentGameData() {
    persistentStore.wipeAll();
    applyClassicConfigAndSyncSf(defaultGameplayConfig);
    sfState.scores = persistentStore.getScores('soloFight');
    teamStates.duoFight.scores = persistentStore.getScores('duoFight');
    teamStates.trioFight.scores = persistentStore.getScores('trioFight');
    passwordResetCodes.clear();
    for (const session of clients.values()) {
      session.questProgress = null;
      // Prevent a browser-cached skin id from being synced back after a wipe.
      send(session.ws, {
        type: 'playerProfile',
        deviceId: session.deviceId || '',
        skinId: '',
        accountLogin: null,
        quest: toQuestPublicView(sanitizeQuestProgress(undefined)),
      });
    }
    broadcastToRoom('classic', { type: 'settings', settings: classicConfig, mode: 'classic' });
    broadcastToRoom('soloFight', { type: 'settings', settings: soloFightConfig, mode: 'soloFight' });
    for (const mode of ['duoFight', 'trioFight'] as TeamFightMode[]) {
      broadcastToRoom(mode, { type: 'settings', settings: configFor(mode), mode });
    }
    broadcastSoloFightTop();
    broadcastTeamMeta('duoFight');
    broadcastTeamMeta('trioFight');
    broadcastRoomInfo();
  }

  /** Reset Classic only. Other rooms and persisted settings are untouched. */
  function restartClassicRoom() {
    const state = classicEngine.getState();
    for (const session of clients.values()) {
      if (session.room !== 'classic') continue;
      const wasPlaying = session.joined || session.playerIds.length > 0;
      session.playerIds = [];
      session.activeIndex = 0;
      session.joined = false;
      session.spectating = !session.lobbyOnly;
      session.sentVirusUntil.clear();
      session.knownFoodIds.clear();
      session.knownEjectIds.clear();
      session.knownVirusIds.clear();
      if (wasPlaying) send(session.ws, { type: 'died' });
    }
    state.players.splice(0);
    state.food.splice(0);
    state.viruses.splice(0);
    state.ejectedMass.splice(0);
    syncWorldAndPopulation(classicEngine, classicConfig);
    broadcastRoomInfo();
  }

  function getRoomInfo(mode: RoomMode): {
    type: 'roomInfo';
    players: number;
    lobby: number;
    mode: RoomMode;
    blue?: number;
    red?: number;
    blueMembers?: string[];
    redMembers?: string[];
  } {
    let players = 0;
    let lobby = 0;
    const engine = engineFor(mode);
    const state = engine.getState();
    // A session's room flags are authoritative. `teamFighters` is match-state
    // bookkeeping and can briefly lag a disconnect or a mode transition.
    const roomSessions = [...clients.values()].filter(
      (session) => session.room === mode && session.ws.readyState === WebSocket.OPEN
    );
    const activeTeamMembers = isTeamFight(mode)
      ? roomSessions.filter(
          (session) =>
            session.joined &&
            !session.lobbyOnly &&
            !session.spectating &&
            (session.team === 'blue' || session.team === 'red')
        )
      : [];
    for (const session of roomSessions) {
      // Menu watchers are not counted at all
      if (session.lobbyOnly) continue;
      if (mode === 'soloFight') {
        if (session.joined && !session.spectating) players += 1;
        else if (session.spectating) lobby += 1;
        continue;
      }
      if (isTeamFight(mode)) {
        if (activeTeamMembers.includes(session)) players += 1;
        else if (session.spectating) lobby += 1;
        continue;
      }
      const alive = session.playerIds.some((id) => {
        const p = state.players.find((x) => x.id === id);
        return !!(p && p.cells.length > 0 && !p.isBot);
      });
      if (alive) players += 1;
      else if (session.spectating) lobby += 1;
    }
    if (isTeamFight(mode)) {
      return {
        type: 'roomInfo',
        players,
        lobby,
        mode,
        blue: activeTeamMembers.filter((s) => s.team === 'blue').length,
        red: activeTeamMembers.filter((s) => s.team === 'red').length,
        blueMembers: activeTeamMembers.filter((s) => s.team === 'blue').map((s) => s.lastName),
        redMembers: activeTeamMembers.filter((s) => s.team === 'red').map((s) => s.lastName),
      };
    }
    return { type: 'roomInfo', players, lobby, mode };
  }

  function writeBotApi(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  }

  function writeSkinApi(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    });
    res.end(JSON.stringify(body));
  }

  function isSkinAdminAuthorized(name: unknown, password: unknown) {
    const adminName = String(name ?? '').trim();
    const adminPassword = String(password ?? '');
    return isAdminName(adminName) && checkAdminPassword(adminPassword);
  }

  function sniffImageMime(data: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
    if (
      data.length >= 8 &&
      data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    ) {
      return 'image/png';
    }
    if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
      return 'image/jpeg';
    }
    if (
      data.length >= 12 &&
      data.subarray(0, 4).toString('ascii') === 'RIFF' &&
      data.subarray(8, 12).toString('ascii') === 'WEBP'
    ) {
      return 'image/webp';
    }
    return null;
  }

  async function readLimitedBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of req) {
      const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += part.length;
      if (bytes > maxBytes) throw new Error('Файл слишком большой (максимум 10 МБ)');
      chunks.push(part);
    }
    return Buffer.concat(chunks);
  }

  function parseMultipartSkinUpload(data: Buffer, contentType: string) {
    const boundary = /boundary=([^;]+)/i.exec(contentType)?.[1]?.trim().replace(/^"|"$/g, '');
    if (!boundary) throw new Error('Некорректная форма загрузки');
    const fields = new Map<string, string>();
    let file: Buffer | null = null;
    const delimiter = `--${boundary}`;
    for (const part of data.toString('latin1').split(delimiter)) {
      const bodyStart = part.indexOf('\r\n\r\n');
      if (bodyStart < 0) continue;
      const headers = part.slice(0, bodyStart);
      const disposition = /content-disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="[^"]*")?/i.exec(headers);
      if (!disposition) continue;
      const value = part.slice(bodyStart + 4).replace(/\r\n$/, '');
      if (/;\s*filename="/i.test(headers)) {
        file = Buffer.from(value, 'latin1');
      } else {
        fields.set(disposition[1], Buffer.from(value, 'latin1').toString('utf8'));
      }
    }
    if (!file) throw new Error('Файл не выбран');
    return { file, fields };
  }

  async function handleHttpApi(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/api/public-config') {
      writeSkinApi(res, 200, { telegramChannelUrl: persistentStore.getTelegramChannelUrl(), weeklyTopPrizes: {
        classic: persistentStore.getWeeklyTopPrize('classic'), soloFight: persistentStore.getWeeklyTopPrize('soloFight'),
        duoFight: persistentStore.getWeeklyTopPrize('duoFight'), trioFight: persistentStore.getWeeklyTopPrize('trioFight'),
      } });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/public-config') {
      try {
        const body = JSON.parse((await readLimitedBody(req, 64 * 1024)).toString('utf8')) as {
          adminNick?: unknown; adminPassword?: unknown; telegramChannelUrl?: unknown; weeklyTopPrizes?: Partial<Record<RoomMode, unknown>>;
        };
        if (!isSkinAdminAuthorized(body.adminNick, body.adminPassword)) {
          writeSkinApi(res, 401, { error: 'Требуются права администратора' });
          return;
        }
        const channel = String(body.telegramChannelUrl ?? '').trim();
        if (channel && !/^https?:\/\/(t\.me|telegram\.me)\//i.test(channel)) {
          writeSkinApi(res, 400, { error: 'Укажите корректную ссылку t.me или оставьте поле пустым' });
          return;
        }
        persistentStore.setTelegramChannelUrl(channel);
        for (const mode of ['classic', 'soloFight', 'duoFight', 'trioFight'] as RoomMode[]) {
          if (body.weeklyTopPrizes?.[mode] !== undefined) persistentStore.setWeeklyTopPrize(mode, Number(body.weeklyTopPrizes[mode]));
        }
        writeSkinApi(res, 200, { ok: true, telegramChannelUrl: channel, weeklyTopPrizes: {
          classic: persistentStore.getWeeklyTopPrize('classic'), soloFight: persistentStore.getWeeklyTopPrize('soloFight'),
          duoFight: persistentStore.getWeeklyTopPrize('duoFight'), trioFight: persistentStore.getWeeklyTopPrize('trioFight'),
        } });
      } catch (error) {
        writeSkinApi(res, 400, { error: error instanceof Error ? error.message : 'Не удалось сохранить ссылку' });
      }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/wipe') {
      try {
        const body = JSON.parse((await readLimitedBody(req, 64 * 1024)).toString('utf8')) as {
          adminNick?: unknown; adminPassword?: unknown; confirmation?: unknown;
        };
        if (!isSkinAdminAuthorized(body.adminNick, body.adminPassword)) {
          writeSkinApi(res, 401, { error: 'Требуются права администратора' });
          return;
        }
        if (!/^(confirm|конфирм)$/iu.test(String(body.confirmation ?? '').trim())) {
          writeSkinApi(res, 400, { error: 'Подтверждение не принято' });
          return;
        }
        wipePersistentGameData();
        writeSkinApi(res, 200, { ok: true, message: 'Вся база данных стёрта и сброшена к значениям по умолчанию' });
      } catch (error) {
        writeSkinApi(res, 400, { error: error instanceof Error ? error.message : 'Не удалось очистить базу' });
      }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/shop/buy') {
      try {
        const body = JSON.parse((await readLimitedBody(req, 64 * 1024)).toString('utf8')) as { deviceId?: string; skinId?: string };
        const result = persistentStore.purchaseShopSkin(String(body.deviceId || '').trim(), String(body.skinId || '').trim());
        if (!result.ok) {
          writeSkinApi(res, 400, result);
          return;
        }
        writeSkinApi(res, 200, {
          ok: true,
          quest: toQuestPublicView(sanitizeQuestProgress(result.profile.quests), {
            pendingLevelRewards: result.profile.pendingLevelRewards,
          }),
        });
      } catch (error) {
        writeSkinApi(res, 400, { error: error instanceof Error ? error.message : 'Не удалось купить скин' });
      }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/level-rewards/ack') {
      try {
        const body = JSON.parse((await readLimitedBody(req, 64 * 1024)).toString('utf8')) as { deviceId?: string; level?: number };
        const level = Math.max(1, Math.floor(Number(body.level) || 0));
        persistentStore.acknowledgeLevelReward(String(body.deviceId || '').trim(), level);
        writeSkinApi(res, 200, { ok: true });
      } catch {
        writeSkinApi(res, 400, { error: 'Некорректное подтверждение награды' });
      }
      return;
    }
    if (!url.pathname.startsWith('/api/skins')) {
      await handleBotApi(req, res);
      return;
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
        'access-control-allow-headers': 'content-type',
      });
      res.end();
      return;
    }

    const skinPath = url.pathname.match(/^\/api\/skins\/([^/]+)$/)?.[1];
    if (req.method === 'GET' && url.pathname === '/api/skins') {
      writeSkinApi(res, 200, {
        skins: persistentStore.getCustomSkins().map((skin) => ({
          id: skin.id,
          name: skin.name,
          url: `/api/skins/${encodeURIComponent(skin.fileName)}`,
          kind: skin.kind ?? 'global',
          price: skin.price,
          level: skin.level,
        })),
      });
      return;
    }
    if (req.method === 'GET' && skinPath) {
      const skin = persistentStore.getSkin(skinPath);
      if (!skin) {
        writeSkinApi(res, 404, { error: 'Скин не найден' });
        return;
      }
      res.writeHead(200, {
        'content-type': skin.mime,
        'cache-control': 'public, max-age=3600',
        'x-content-type-options': 'nosniff',
        'access-control-allow-origin': '*',
      });
      if (skin.dataBase64) {
        res.end(Buffer.from(skin.dataBase64, 'base64'));
      } else {
        const path = join(customSkinDir, skin.fileName);
        if (!existsSync(path)) {
          writeSkinApi(res, 404, { error: 'Изображение скина не найдено' });
          return;
        }
        res.end(readFileSync(path));
      }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/skins') {
      try {
        const multipart = parseMultipartSkinUpload(
          await readLimitedBody(req, CUSTOM_SKIN_MAX_BYTES + 128 * 1024),
          String(req.headers['content-type'] ?? '')
        );
        if (!isSkinAdminAuthorized(multipart.fields.get('adminNick'), multipart.fields.get('adminPassword'))) {
          writeSkinApi(res, 401, { error: 'Требуются права администратора' });
          return;
        }
        const data = multipart.file;
        if (data.length > CUSTOM_SKIN_MAX_BYTES) {
          writeSkinApi(res, 400, { error: 'Файл слишком большой (максимум 10 МБ)' });
          return;
        }
        const mime = sniffImageMime(data);
        if (!mime) {
          writeSkinApi(res, 400, { error: 'Разрешены только PNG, JPG и WEBP' });
          return;
        }
        const ext = mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : 'webp';
        const id = `custom-${randomUUID()}`;
        const fileName = `${id}.${ext}`;
        const name = String(multipart.fields.get('name') ?? 'Свой скин')
          .replace(/[\u0000-\u001F<>]/g, '')
          .trim()
          .slice(0, 40) || 'Свой скин';
        const kindField = multipart.fields.get('kind');
        const kind = kindField === 'shop' || kindField === 'level' ? kindField : 'global';
        const price = Math.max(0, Math.floor(Number(multipart.fields.get('price')) || 0));
        const level = Math.max(1, Math.floor(Number(multipart.fields.get('level')) || 1));
        // DB owns the binary. This cache is deliberately optional and may be
        // deleted without affecting exports/backups or future image serving.
        persistentStore.addCustomSkin({
          id, name, fileName, mime, dataBase64: data.toString('base64'), kind,
          price: kind === 'shop' ? price : undefined,
          level: kind === 'level' ? level : undefined,
          createdAt: Date.now(),
        });
        writeSkinApi(res, 201, { id, name, url: `/api/skins/${encodeURIComponent(fileName)}` });
      } catch (error) {
        writeSkinApi(res, 400, { error: error instanceof Error ? error.message : 'Не удалось загрузить скин' });
      }
      return;
    }
    if (req.method === 'DELETE' && skinPath) {
      let credentials: { adminNick?: unknown; adminPassword?: unknown };
      try {
        credentials = JSON.parse((await readLimitedBody(req, 64 * 1024)).toString('utf8') || '{}') as {
          adminNick?: unknown;
          adminPassword?: unknown;
        };
      } catch {
        writeSkinApi(res, 400, { error: 'Некорректные данные авторизации' });
        return;
      }
      if (!isSkinAdminAuthorized(credentials.adminNick, credentials.adminPassword)) {
        writeSkinApi(res, 401, { error: 'Требуются права администратора' });
        return;
      }
      const skin = persistentStore.getCustomSkins().find((item) => item.fileName === skinPath || item.id === skinPath);
      if (!skin) {
        writeSkinApi(res, 404, { error: 'Скин не найден' });
        return;
      }
      persistentStore.removeCustomSkin(skin.id);
      try {
        await unlink(join(customSkinDir, skin.fileName));
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.error('[skins] failed to remove image:', error);
        }
      }
      writeSkinApi(res, 200, { ok: true });
      return;
    }
    writeSkinApi(res, 405, { error: 'Метод не поддерживается' });
  }

  function isBotApiAuthorized(req: IncomingMessage) {
    const expected = process.env.GAME_API_SECRET?.trim();
    const received = req.headers['x-game-api-secret'];
    return !!expected && typeof received === 'string' && received === expected;
  }

  async function readBotApiBody(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of req) {
      const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += part.length;
      // A portable DB embeds custom skin binaries as base64. One permitted
      // 10 MB image expands past 13 MB, so the old 5 MB cap rejected valid
      // full backups and bot skin approvals.
      if (bytes > 50_000_000) throw new Error('Body is too large');
      chunks.push(part);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  }

  async function handleBotApi(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (!url.pathname.startsWith('/api/bot/')) {
      writeBotApi(res, 404, { error: 'Not found' });
      return;
    }
    if (!isBotApiAuthorized(req)) {
      writeBotApi(res, 401, { error: 'Unauthorized' });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/bot/online') {
      const counts = (['classic', 'soloFight', 'duoFight', 'trioFight'] as RoomMode[]).reduce(
        (result, mode) => {
          const info = getRoomInfo(mode);
          result[mode] = { players: info.players, spectators: info.lobby };
          return result;
        },
        {} as Record<RoomMode, { players: number; spectators: number }>
      );
      writeBotApi(res, 200, counts);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/bot/tops') {
      const mode = url.searchParams.get('mode');
      if (mode !== 'soloFight' && mode !== 'duoFight' && mode !== 'trioFight') {
        writeBotApi(res, 400, { error: 'Invalid fight mode' });
        return;
      }
      const top = [...persistentStore.getScores(mode).entries()]
        .map(([name, score]) => ({ name, score }))
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
      writeBotApi(res, 200, top);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/bot/chat-out') {
      const room = parseMode(url.searchParams.get('room') || undefined);
      const since = Math.max(0, Number(url.searchParams.get('since')) || 0);
      const lines = botChatLines[room].filter((line) => line.id > since);
      writeBotApi(res, 200, { lines, lastId: lines.at(-1)?.id ?? since });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/bot/outbox') {
      // Drain atomically from the single game process. The bot polls frequently
      // and retries on its next request if the API call itself fails.
      const messages = botOutbox.splice(0, botOutbox.length);
      writeBotApi(res, 200, { messages });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/bot/profile') {
      const login = url.searchParams.get('login') || '';
      const account = persistentStore.getAccount(login);
      if (!account) {
        writeBotApi(res, 404, { error: 'Аккаунт не найден' });
        return;
      }
      const profile = account.deviceId ? persistentStore.getPlayer(account.deviceId) : undefined;
      const quest = sanitizeQuestProgress(profile?.quests);
      writeBotApi(res, 200, {
        login: account.login,
        deviceId: account.deviceId || null,
        quest: toQuestPublicView(quest),
      });
      return;
    }
    try {
      const body = await readBotApiBody(req);
      if (req.method === 'POST' && url.pathname === '/api/bot/unlink-device') {
        const login = String((body as { login?: unknown }).login || '');
        const result = persistentStore.unlinkAccountDevice(login);
        writeBotApi(res, result.ok ? 200 : 400, result);
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/bot/chat') {
        const input = body as { room?: string; name?: string; text?: string };
        const room = parseMode(input.room);
        const name = String(input.name || 'Telegram').trim().slice(0, 30) || 'Telegram';
        const text = sanitizeChat(String(input.text || ''));
        if (!text) {
          writeBotApi(res, 400, { error: 'Empty chat message' });
          return;
        }
        broadcastToRoom(room, { type: 'chat', name, text, t: Date.now(), color: '#27a9ff', fromTg: true });
        writeBotApi(res, 200, { ok: true });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/bot/db/merge') {
        const json = typeof (body as { json?: unknown }).json === 'string' ? (body as { json: string }).json : '';
        const result = persistentStore.mergeBotSnapshot(json);
        if (!result.ok) {
          writeBotApi(res, 400, result);
          return;
        }
        writeBotApi(res, 200, { ok: true });
        return;
      }
      if (url.pathname === '/api/bot/db') {
        if (req.method === 'GET') {
          writeBotApi(res, 200, { json: persistentStore.exportJson() });
          return;
        }
        if (req.method === 'POST') {
          const json = typeof (body as { json?: unknown }).json === 'string' ? (body as { json: string }).json : '';
          const result = persistentStore.importJson(json);
          if (!result.ok) {
            writeBotApi(res, 400, result);
            return;
          }
          sfState.scores = persistentStore.getScores('soloFight');
          teamStates.duoFight.scores = persistentStore.getScores('duoFight');
          teamStates.trioFight.scores = persistentStore.getScores('trioFight');
          const config = persistentStore.getConfig();
          if (config) applyClassicConfigAndSyncSf(config);
          broadcastSoloFightTop();
          broadcastTeamMeta('duoFight');
          broadcastTeamMeta('trioFight');
          writeBotApi(res, 200, { ok: true });
          return;
        }
      }
    } catch (error) {
      writeBotApi(res, 400, { error: error instanceof Error ? error.message : 'Invalid request' });
      return;
    }
    writeBotApi(res, 405, { error: 'Method not allowed' });
  }

  function broadcastRoomInfo() {
    const rooms = {
      classic: getRoomInfo('classic'),
      soloFight: getRoomInfo('soloFight'),
      duoFight: getRoomInfo('duoFight'),
      trioFight: getRoomInfo('trioFight'),
    };
    const lobbySnapshot = JSON.stringify({
      type: 'lobbySnapshot',
      rooms,
      tops: {
        classic: weeklyEntries('classic'),
        soloFight: weeklyEntries('soloFight'),
        duoFight: weeklyEntries('duoFight'),
        trioFight: weeklyEntries('trioFight'),
      },
      weeklyTopEndsAt: {
        classic: persistentStore.getWeeklyTopEndsAt('classic'),
        soloFight: persistentStore.getWeeklyTopEndsAt('soloFight'),
        duoFight: persistentStore.getWeeklyTopEndsAt('duoFight'),
        trioFight: persistentStore.getWeeklyTopEndsAt('trioFight'),
      },
    } satisfies ServerMessage);
    const roomInfo = {
      classic: JSON.stringify(rooms.classic),
      soloFight: JSON.stringify(rooms.soloFight),
      duoFight: JSON.stringify(rooms.duoFight),
      trioFight: JSON.stringify(rooms.trioFight),
    };
    const soloTop = JSON.stringify(makeSoloFightTop(sfState));
    const teamTops = {
      duoFight: JSON.stringify(makeTeamFightTop('duoFight', teamStates.duoFight)),
      trioFight: JSON.stringify(makeTeamFightTop('trioFight', teamStates.trioFight)),
    };
    for (const [ws, session] of clients) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      // One snapshot is deliberately complete: one menu socket updates all
      // cards and cannot overwrite one mode with another observer's data.
      sendSerialized(ws, lobbySnapshot);
      // Retained for the live room HUD / older clients.
      sendSerialized(ws, roomInfo[session.room]);
      if (session.room === 'soloFight') {
        sendSerialized(ws, soloTop);
      }
      if (isTeamFight(session.room)) {
        sendSerialized(ws, teamTops[session.room]);
      }
    }
  }

  function broadcastSoloFightTop() {
    const top = makeSoloFightTop(sfState);
    broadcastToRoom('soloFight', top);
  }

  function syncSfMetaFromDuelists() {
    sfDuelists = sfDuelists.filter((s) => s.ws.readyState === WebSocket.OPEN);
    sfState.names = sfDuelists.map((s) => s.lastName);
    sfState.fighterPlayerIds = sfDuelists.flatMap((s) => s.playerIds);
  }

  function freezeSfFighters(frozen: boolean) {
    for (const session of sfDuelists) {
      for (const id of session.playerIds) {
        soloFightEngine.setPlayerFrozen(id, frozen);
      }
    }
  }

  function broadcastSfHud() {
    const hud = makeSoloFightHud(sfState);
    broadcastToRoom('soloFight', hud);
  }

  /** End fight: award winner, freeze fighters, delay arena clear 5s. */
  function endSoloFightMatch(winnerName: string | null, _loserName?: string | null) {
    if (sfMatchEnding) return;
    if (
      sfState.phase === 'ended' ||
      sfState.phase === 'resetting' ||
      sfState.phase === 'waiting'
    ) {
      return;
    }
    sfMatchEnding = true;

    for (const session of sfDuelists) {
      const won = winnerName !== null && session.lastName === winnerName;
      sfState.streaks.set(session.lastName, won ? (sfState.streaks.get(session.lastName) ?? 0) + 1 : 0);
      if (won) {
        const score = persistentStore.recordWin('soloFight', session.deviceId, session.lastName);
        if (score !== undefined) sfState.scores.set(normalizeNick(session.lastName), score);
      }
    }

    freezeSfFighters(true);
    sfState.phase = 'ended';
    sfState.fightEndsAt = 0;
    sfState.countdownEndsAt = 0;
    sfState.betweenEndsAt = 0;
    sfState.resetEndsAt = Date.now() + SOLO_FIGHT_RESET_MS;
    syncSfMetaFromDuelists();

    for (const session of sfDuelists) {
      session.joined = false;
      session.activeIndex = 0;
      send(session.ws, { type: 'died' });
      send(session.ws, makeSoloFightHud(sfState));
    }

    broadcastSfHud();
    broadcastRoomInfo();
    broadcastSoloFightTop();
    sfMatchEnding = false;
  }

  function clearSoloFightAfterEnded() {
    for (const session of [...sfDuelists]) {
      clearSessionPlayers(session, soloFightEngine);
      session.joined = false;
      session.activeIndex = 0;
    }
    soloFightEngine.clearArenaLoot();
    sfDuelists = [];
    sfState.names = [];
    sfState.fighterPlayerIds = [];
    sfState.phase = 'waiting';
    sfState.countdownEndsAt = 0;
    sfState.betweenEndsAt = 0;
    sfState.resetEndsAt = 0;
    sfState.fightEndsAt = 0;
    applyPendingSoloFightJoins();
  }

  function applyPendingSoloFightJoins() {
    const pending = pendingSoloFightJoins.splice(0);
    for (const { session, name, skin } of pending) {
      if (session.ws.readyState === WebSocket.OPEN) joinSoloFight(session, name, skin);
    }
  }

  function handleSoloFightDeath(deadSession: ClientSession) {
    if (!sfDuelists.includes(deadSession)) return;
    if (sfState.phase !== 'fighting') {
      syncSfMetaFromDuelists();
      return;
    }
    const othersAlive = sfDuelists.filter(
      (s) => s !== deadSession && s.joined && s.playerIds.length > 0
    );
    if (othersAlive.length === 1) {
      endSoloFightMatch(othersAlive[0].lastName, deadSession.lastName);
    } else {
      endSoloFightMatch(null);
    }
  }

  function handleSoloFightLeave(session: ClientSession) {
    if (!sfDuelists.includes(session)) return;
    const wasFighting = sfState.phase === 'fighting';
    const wasCountdown = sfState.phase === 'countdown';
    const wasEnded = sfState.phase === 'ended' || sfState.phase === 'resetting';
    const remaining = sfDuelists.filter((s) => s !== session);

    if (wasFighting && remaining.length === 1 && remaining[0].joined) {
      endSoloFightMatch(remaining[0].lastName, session.lastName);
      return;
    }

    sfDuelists = remaining;

    if (sfDuelists.length === 0) {
      // If rematch joins were queued while the post-win timer ran, apply them now.
      // Previously phase jumped to waiting and pending joins were dropped forever.
      soloFightEngine.clearArenaLoot();
      sfState.names = [];
      sfState.fighterPlayerIds = [];
      sfState.countdownEndsAt = 0;
      sfState.betweenEndsAt = 0;
      sfState.resetEndsAt = 0;
      sfState.fightEndsAt = 0;
      sfState.phase = 'waiting';
      applyPendingSoloFightJoins();
      broadcastSfHud();
      broadcastRoomInfo();
      return;
    }

    if (sfDuelists.length === 1) {
      if (wasCountdown) {
        sfState.phase = 'waiting';
        sfState.countdownEndsAt = 0;
        sfState.fightEndsAt = 0;
        soloFightEngine.clearArenaLoot();
      }
      if (wasEnded) {
        // Stay in ended until reset timer; just refresh meta
      }
      sfState.betweenEndsAt = 0;
      if (!wasEnded) sfState.resetEndsAt = 0;
      syncSfMetaFromDuelists();
      freezeSfFighters(true);
    }
  }

  function checkSoloFightTimeout(now: number) {
    if (sfState.phase !== 'fighting' || sfState.fightEndsAt <= 0) return;
    if (now < sfState.fightEndsAt) return;

    const entries = sfDuelists.map((s) => {
      let mass = 0;
      for (const id of s.playerIds) {
        const p = soloFightEngine.getState().players.find((x) => x.id === id);
        if (p) mass += getTotalMass(p);
      }
      return { name: s.lastName, mass };
    });

    if (entries.length >= 2) {
      if (entries[0].mass > entries[1].mass) {
        endSoloFightMatch(entries[0].name, entries[1].name);
      } else if (entries[1].mass > entries[0].mass) {
        endSoloFightMatch(entries[1].name, entries[0].name);
      } else {
        endSoloFightMatch(null);
      }
    } else if (entries.length === 1) {
      endSoloFightMatch(entries[0].name);
    } else {
      endSoloFightMatch(null);
    }
  }

  function tickSoloFightPhases() {
    const now = Date.now();

    if (
      sfState.phase === 'waiting' ||
      sfState.phase === 'countdown' ||
      sfState.phase === 'ended'
    ) {
      freezeSfFighters(true);
    }

    if (sfState.phase === 'countdown' && now >= sfState.countdownEndsAt) {
      freezeSfFighters(false);
      sfState.phase = 'fighting';
      sfState.fightEndsAt = now + SOLO_FIGHT_DURATION_MS;
    }

    if (sfState.phase === 'fighting') {
      checkSoloFightTimeout(now);
    }

    if (sfState.phase === 'ended' && sfState.resetEndsAt > 0 && now >= sfState.resetEndsAt) {
      clearSoloFightAfterEnded();
      broadcastSfHud();
      broadcastRoomInfo();
    }
  }

  function isTeamFight(room: RoomMode): room is TeamFightMode {
    return room === 'duoFight' || room === 'trioFight';
  }

  function teamMembers(mode: TeamFightMode, team: FightTeam) {
    const engine = engineFor(mode);
    return [...clients.values()]
      .filter(
        (s) =>
          s.room === mode &&
          s.joined &&
          !s.lobbyOnly &&
          !s.spectating &&
          s.team === team &&
          s.ws.readyState === WebSocket.OPEN
      )
      .map((s) => ({
        name: s.lastName,
        alive: s.playerIds.some((id) => {
          const p = engine.getState().players.find((x) => x.id === id);
          return !!p && p.cells.length > 0;
        }),
      }));
  }

  function broadcastTeamMeta(mode: TeamFightMode) {
    const state = teamStates[mode];
    const hud = makeTeamFightHud(
      mode,
      state,
      (team) => teamMembers(mode, team),
      getRoomInfo(mode).lobby
    );
    broadcastToRoom(mode, hud);
    broadcastToRoom(mode, makeTeamFightTop(mode, state));
  }

  function freezeTeamFighters(mode: TeamFightMode, frozen: boolean) {
    const engine = engineFor(mode);
    for (const session of teamFighters[mode]) {
      for (const id of session.playerIds) engine.setPlayerFrozen(id, frozen);
    }
  }

  function clearTeamFightAfterEnded(mode: TeamFightMode) {
    const engine = engineFor(mode);
    for (const session of teamFighters[mode]) {
      clearSessionPlayers(session, engine);
      session.joined = false;
      session.team = undefined;
    }
    teamFighters[mode] = [];
    engine.clearArenaLoot();
    teamStates[mode] = {
      ...createEmptyTeamFightState(),
      scores: persistentStore.getScores(mode),
      streaks: teamStates[mode].streaks,
    };
    applyPendingTeamFightJoins(mode);
  }

  function endTeamFight(mode: TeamFightMode, winner: FightTeam | null) {
    const state = teamStates[mode];
    if (state.phase !== 'fighting') return;
    for (const session of teamFighters[mode]) {
      const won = winner !== null && session.team === winner;
      state.streaks.set(session.lastName, won ? (state.streaks.get(session.lastName) ?? 0) + 1 : 0);
      if (won) {
        const score = persistentStore.recordWin(mode as FightMode, session.deviceId, session.lastName);
        if (score !== undefined) state.scores.set(normalizeNick(session.lastName), score);
      }
    }
    freezeTeamFighters(mode, true);
    state.phase = 'ended';
    state.fightEndsAt = 0;
    state.countdownEndsAt = 0;
    state.resetEndsAt = Date.now() + TEAM_FIGHT_RESET_MS;
    for (const session of teamFighters[mode]) {
      session.joined = false;
      send(session.ws, { type: 'died' });
    }
    broadcastTeamMeta(mode);
    broadcastRoomInfo();
  }

  function applyPendingTeamFightJoins(mode: TeamFightMode) {
    const pending = pendingTeamFightJoins[mode].splice(0);
    for (const { session, name, skin, team } of pending) {
      if (session.ws.readyState === WebSocket.OPEN) joinTeamFight(session, mode, name, skin, team);
    }
  }

  function checkTeamFightWinner(mode: TeamFightMode) {
    const aliveTeams = (['blue', 'red'] as FightTeam[]).filter((team) =>
      teamMembers(mode, team).some((member) => member.alive)
    );
    if (aliveTeams.length === 1) endTeamFight(mode, aliveTeams[0]);
    else if (aliveTeams.length === 0) endTeamFight(mode, null);
  }

  function tickTeamFight(mode: TeamFightMode, now: number) {
    const state = teamStates[mode];
    if (state.phase === 'waiting' || state.phase === 'countdown' || state.phase === 'ended') {
      freezeTeamFighters(mode, true);
    }
    if (state.phase === 'countdown' && now >= state.countdownEndsAt) {
      state.phase = 'fighting';
      state.fightEndsAt = now + TEAM_FIGHT_DURATION_MS;
      freezeTeamFighters(mode, false);
    }
    if (state.phase === 'fighting') {
      if (now >= state.fightEndsAt) {
        const masses = (['blue', 'red'] as FightTeam[]).map((team) => ({
          team,
          mass: teamFighters[mode]
            .filter((s) => s.team === team)
            .reduce((sum, s) => sum + s.playerIds.reduce((n, id) => {
              const p = engineFor(mode).getState().players.find((x) => x.id === id);
              return n + (p ? getTotalMass(p) : 0);
            }, 0), 0),
        }));
        endTeamFight(mode, masses[0].mass === masses[1].mass ? null : masses[0].mass > masses[1].mass ? 'blue' : 'red');
      } else {
        checkTeamFightWinner(mode);
      }
    }
    if (state.phase === 'ended' && now >= state.resetEndsAt) {
      clearTeamFightAfterEnded(mode);
      broadcastTeamMeta(mode);
      broadcastRoomInfo();
    }
  }

  function joinTeamFight(session: ClientSession, mode: TeamFightMode, name: string, skin: string, team?: FightTeam) {
    let state = teamStates[mode];
    let fighters = teamFighters[mode].filter((s) => s.ws.readyState === WebSocket.OPEN);
    teamFighters[mode] = fighters;
    const size = teamSizeFor(mode);
    if (!team || (team !== 'blue' && team !== 'red')) {
      session.room = mode;
      session.lobbyOnly = true;
      send(session.ws, { type: 'error', message: 'Выберите команду' });
      send(session.ws, { type: 'roomInfo', players: fighters.length, lobby: 0, mode });
      broadcastTeamMeta(mode);
      return;
    }
    if (state.phase === 'ended' || state.phase === 'resetting') {
      pendingTeamFightJoins[mode] = pendingTeamFightJoins[mode].filter((entry) => entry.session !== session);
      const engine = engineFor(mode);
      for (const s of teamFighters[mode]) {
        clearSessionPlayers(s, engine);
        s.joined = false;
        s.team = undefined;
      }
      teamFighters[mode] = [];
      engine.clearArenaLoot();
      teamStates[mode] = {
        ...createEmptyTeamFightState(),
        scores: persistentStore.getScores(mode),
        streaks: teamStates[mode].streaks,
      };
      state = teamStates[mode];
      fighters = [];
    }
    if (isFightNickTaken(mode, name, session)) {
      send(session.ws, {
        type: 'error',
        message: 'Этот ник уже в этом файте — смените ник и нажмите «Войти» снова',
      });
      session.room = mode;
      session.lobbyOnly = true;
      session.spectating = false;
      session.joined = false;
      session.team = undefined;
      clearSessionPlayers(session, engineFor(mode));
      return;
    }
    const onTeam = fighters.filter((s) => s.team === team);
    if (state.phase !== 'waiting' || onTeam.length >= size || fighters.length >= size * 2) {
      session.room = mode;
      session.lobbyOnly = false;
      session.spectating = true;
      const st = engineFor(mode).getState();
      session.viewX = st.worldWidth / 2;
      session.viewY = st.worldHeight / 2;
      sendWelcome(session, `spec-${Date.now().toString(36)}`, engineFor(mode), false);
      send(session.ws, { type: 'settings', settings: configFor(mode), mode });
      send(session.ws, { type: 'error', message: 'Команда или бой уже заполнены — режим наблюдения' });
      broadcastTeamMeta(mode);
      broadcastRoomInfo();
      return;
    }
    session.room = mode;
    session.team = team;
    session.lobbyOnly = false;
    session.spectating = false;
    clearSessionPlayers(session, engineFor(mode));
    const st = engineFor(mode).getState();
    // A slot is not a list position: a member leaving the middle must free
    // that exact position, while surviving teammates keep their fixed spawn.
    const occupied = new Set(
      onTeam.map((fighter) => fighter.spawnSlot).filter((slot): slot is number => slot !== undefined)
    );
    const slot = Array.from({ length: size }, (_, index) => index).find((index) => !occupied.has(index));
    if (slot === undefined) {
      session.spectating = true;
      send(session.ws, { type: 'error', message: 'Команда заполнена — режим наблюдения' });
      broadcastRoomInfo();
      return;
    }
    const spawn = teamFightSpawnPoint(st.worldWidth, st.worldHeight, team, slot, size);
    const player = engineFor(mode).addPlayer(name, false, { ...spawn, skin: skin || undefined, mass: TEAM_FIGHT_START_MASS });
    engineFor(mode).setPlayerFrozen(player.id, true);
    session.playerIds = [player.id];
    session.activeIndex = 0;
    session.joined = true;
    beginQuestLife(session);
    session.lastName = name;
    session.lastColor = player.color;
    session.lastSkin = skin || '';
    session.spawnSlot = slot;
    fighters.push(session);
    teamFighters[mode] = fighters;
    if (fighters.length === size * 2) {
      state.phase = 'countdown';
      state.countdownEndsAt = Date.now() + TEAM_FIGHT_COUNTDOWN_MS;
      engineFor(mode).populateArenaLoot();
    } else {
      engineFor(mode).clearArenaLoot();
    }
    refreshAdmin(session);
    sendWelcome(session, player.id, engineFor(mode), session.isAdmin);
    send(session.ws, { type: 'settings', settings: configFor(mode), mode });
    announceJoin(mode, session, name);
    broadcastTeamMeta(mode);
    broadcastRoomInfo();
  }

  function leaveTeamFight(session: ClientSession, mode: TeamFightMode) {
    const wasMember =
      teamFighters[mode].includes(session) ||
      (session.room === mode && session.joined && (session.team === 'blue' || session.team === 'red'));
    if (!wasMember) return;
    const state = teamStates[mode];
    const wasEnded = state.phase === 'ended' || state.phase === 'resetting';
    teamFighters[mode] = teamFighters[mode].filter((s) => s !== session);
    clearSessionPlayers(session, engineFor(mode));
    session.joined = false;
    session.spectating = false;
    session.team = undefined;
    session.spawnSlot = undefined;
    if (state.phase === 'fighting') {
      checkTeamFightWinner(mode);
    } else if (state.phase === 'countdown') {
      state.phase = 'waiting';
      state.countdownEndsAt = 0;
      engineFor(mode).clearArenaLoot();
    }
    if (teamFighters[mode].length === 0) {
      teamStates[mode] = {
        ...createEmptyTeamFightState(),
        scores: persistentStore.getScores(mode),
        streaks: wasEnded ? state.streaks : new Map(),
      };
      engineFor(mode).clearArenaLoot();
      applyPendingTeamFightJoins(mode);
      broadcastTeamMeta(mode);
      broadcastRoomInfo();
      return;
    }
    broadcastTeamMeta(mode);
    broadcastRoomInfo();
  }

  function sendWelcome(
    session: ClientSession,
    id: string,
    engine: GameEngine,
    isAdmin: boolean
  ) {
    const st = engine.getState();
    send(session.ws, {
      type: 'welcome',
      id,
      world: { w: st.worldWidth, h: st.worldHeight },
      isAdmin,
    });
  }

  function spectateSoloFight(session: ClientSession, reason?: string) {
    session.room = 'soloFight';
    session.lobbyOnly = false;
    session.spectating = true;
    session.joined = false;
    clearSessionPlayers(session, soloFightEngine);
    const st = soloFightEngine.getState();
    session.viewX = st.worldWidth / 2;
    session.viewY = st.worldHeight / 2;
    sendWelcome(session, `spec-${Date.now().toString(36)}`, soloFightEngine, false);
    send(session.ws, { type: 'settings', settings: soloFightConfig, mode: 'soloFight' });
    send(session.ws, buildStateFor(session, buildLeaderboardFor(soloFightEngine)));
    send(session.ws, makeSoloFightHud(sfState));
    send(session.ws, makeSoloFightTop(sfState));
    if (reason) send(session.ws, { type: 'error', message: reason });
    broadcastRoomInfo();
  }

  function normalizeNick(name: string) {
    return name.trim().toLowerCase();
  }

  function announceJoin(room: RoomMode, session: ClientSession, name: string) {
    if (session.joinAnnouncedRoom === room) return;
    session.joinAnnouncedRoom = room;
    broadcastGameChat(room, name, 'присоединился к игре', '#94a3b8');
  }

  /** Same nick cannot occupy 2+ fighter slots (joined fighters + pending only). */
  function isFightNickTaken(
    mode: 'soloFight' | TeamFightMode,
    name: string,
    except: ClientSession
  ): boolean {
    const nick = normalizeNick(name);
    if (!nick) return false;
    if (mode === 'soloFight') {
      for (const s of sfDuelists) {
        if (s === except || s.ws.readyState !== WebSocket.OPEN || !s.joined) continue;
        if (normalizeNick(s.lastName) === nick) return true;
      }
      for (const entry of pendingSoloFightJoins) {
        if (entry.session === except) continue;
        if (entry.session.ws.readyState !== WebSocket.OPEN) continue;
        if (normalizeNick(entry.name) === nick) return true;
      }
      return false;
    }
    for (const s of teamFighters[mode]) {
      if (s === except || s.ws.readyState !== WebSocket.OPEN || !s.joined) continue;
      if (normalizeNick(s.lastName) === nick) return true;
    }
    for (const entry of pendingTeamFightJoins[mode]) {
      if (entry.session === except) continue;
      if (entry.session.ws.readyState !== WebSocket.OPEN) continue;
      if (normalizeNick(entry.name) === nick) return true;
    }
    return false;
  }

  function forceResetSoloFightArena() {
    for (const s of [...sfDuelists]) {
      clearSessionPlayers(s, soloFightEngine);
      s.joined = false;
      s.activeIndex = 0;
      if (s.ws.readyState === WebSocket.OPEN) {
        send(s.ws, { type: 'died' });
        send(s.ws, makeSoloFightHud(sfState));
      }
    }
    sfDuelists = [];
    soloFightEngine.clearArenaLoot();
    sfState.names = [];
    sfState.fighterPlayerIds = [];
    sfState.phase = 'waiting';
    sfState.countdownEndsAt = 0;
    sfState.betweenEndsAt = 0;
    sfState.resetEndsAt = 0;
    sfState.fightEndsAt = 0;
  }

  function joinSoloFight(session: ClientSession, name: string, skin: string) {
    const openDuelists = sfDuelists.filter((s) => s.ws.readyState === WebSocket.OPEN);
    sfDuelists = openDuelists;

    // Rematch during post-win timer: clear arena immediately and join as waiting.
    if (sfState.phase === 'ended' || sfState.phase === 'resetting') {
      pendingSoloFightJoins.splice(
        0,
        pendingSoloFightJoins.length,
        ...pendingSoloFightJoins.filter((entry) => entry.session !== session)
      );
      forceResetSoloFightArena();
      broadcastSfHud();
      // fall through into normal waiting join
    }

    if (isFightNickTaken('soloFight', name, session)) {
      send(session.ws, {
        type: 'error',
        message: 'Этот ник уже в соло файте — смените ник и нажмите «Войти» снова',
      });
      session.room = 'soloFight';
      session.lobbyOnly = true;
      session.spectating = false;
      session.joined = false;
      clearSessionPlayers(session, soloFightEngine);
      return;
    }

    // Only allow joining as a fighter while waiting with a free slot
    if (isSoloFightJoinBlocked(sfState.phase) || sfDuelists.length >= 2) {
      spectateSoloFight(
        session,
        sfDuelists.length >= 2 || isSoloFightJoinBlocked(sfState.phase)
          ? 'Solo Fight is full - spectating'
          : undefined
      );
      return;
    }

    session.room = 'soloFight';
    session.lobbyOnly = false;
    session.spectating = false;
    const st = soloFightEngine.getState();
    const spawns = soloFightSpawnPoints(st.worldWidth, st.worldHeight);

    if (sfDuelists.length === 0) {
      clearSessionPlayers(session, soloFightEngine);
      const player = soloFightEngine.addPlayer(name, false, {
        x: spawns[0].x,
        y: spawns[0].y,
        skin: skin || undefined,
        mass: SOLO_FIGHT_START_MASS,
      });
      soloFightEngine.setPlayerFrozen(player.id, true);
      session.playerIds = [player.id];
      session.activeIndex = 0;
      session.joined = true;
      beginQuestLife(session);
      session.lastName = name;
      session.lastColor = player.color;
      session.lastSkin = skin || '';
      sfDuelists = [session];
      sfState.phase = 'waiting';
      sfState.fightEndsAt = 0;
      sfState.names = [name];
      sfState.fighterPlayerIds = [player.id];
      soloFightEngine.clearArenaLoot();
      refreshAdmin(session);
      sendWelcome(session, player.id, soloFightEngine, session.isAdmin);
      send(session.ws, { type: 'settings', settings: soloFightConfig, mode: 'soloFight' });
      send(session.ws, makeSoloFightHud(sfState));
      send(session.ws, makeSoloFightTop(sfState));
      announceJoin('soloFight', session, name);
      broadcastRoomInfo();
      return;
    }

    // Second fighter
    clearSessionPlayers(session, soloFightEngine);
    const player = soloFightEngine.addPlayer(name, false, {
      x: spawns[1].x,
      y: spawns[1].y,
      skin: skin || undefined,
      mass: SOLO_FIGHT_START_MASS,
    });
    soloFightEngine.setPlayerFrozen(player.id, true);
    session.playerIds = [player.id];
    session.activeIndex = 0;
    session.joined = true;
    session.lastName = name;
    session.lastColor = player.color;
    session.lastSkin = skin || '';
    sfDuelists.push(session);
    syncSfMetaFromDuelists();
    freezeSfFighters(true);
    sfState.phase = 'countdown';
    sfState.countdownEndsAt = Date.now() + SOLO_FIGHT_COUNTDOWN_MS;
    sfState.fightEndsAt = 0;
    soloFightEngine.populateArenaLoot();
    refreshAdmin(session);
    sendWelcome(session, player.id, soloFightEngine, session.isAdmin);
    if (session.isAdmin) {
      console.log(`[agar-server] admin online (soloFight): ${session.lastName}`);
    }
    send(session.ws, { type: 'settings', settings: soloFightConfig, mode: 'soloFight' });
    for (const d of sfDuelists) {
      send(d.ws, makeSoloFightHud(sfState));
      send(d.ws, makeSoloFightTop(sfState));
    }
    announceJoin('soloFight', session, name);
    broadcastRoomInfo();
  }

  function restartTickLoop() {
    if (tickTimer) clearInterval(tickTimer);
    let roomInfoAcc = 0;
    tickTimer = setInterval(() => {
      if (!listening) return;
      // The two rooms have independent engines. Updating the 20-bot, 5400-food
      // classic world during a Solo Fight wastes a full simulation tick per frame.
      let hasClassicSession = false;
      for (const session of clients.values()) {
        if (session.room === 'classic' && !session.lobbyOnly) {
          hasClassicSession = true;
          break;
        }
      }
      if (hasClassicSession) classicEngine.update();
      if (sfState.phase !== 'waiting' && sfDuelists.length > 0) soloFightEngine.update();
      if (teamStates.duoFight.phase !== 'waiting' && teamFighters.duoFight.length > 0) {
        duoFightEngine.update();
      }
      if (teamStates.trioFight.phase !== 'waiting' && teamFighters.trioFight.length > 0) {
        trioFightEngine.update();
      }
      processWeeklyTops();
      // Classic records are tied to the stable device profile, not a transient
      // websocket name. Guests may play normally but never enter prize records.
      if (hasClassicSession) {
        const state = classicEngine.getState();
        for (const session of clients.values()) {
          if (session.room !== 'classic' || !session.joined || !session.deviceId) continue;
          const profile = persistentStore.getPlayer(session.deviceId);
          if (!profile?.accountLogin) continue;
          const score = session.playerIds.reduce((sum, id) => {
            const player = state.players.find((candidate) => candidate.id === id);
            return sum + (player?.cells.length ? getTotalMass(player) : 0);
          }, 0);
          const result = persistentStore.recordClassicMass(session.deviceId, session.lastName, score, session.lastSkin);
          if (result.global && score >= lastClassicRecordAnnouncement + 100) {
            lastClassicRecordAnnouncement = Math.floor(score);
            broadcastGameChat('classic', '🏆 Система', `Игрок ${session.lastName} установил рекорд классика: ${Math.floor(score)} массы!`, '#facc15');
          }
        }
      }
      tickSoloFightPhases();
      tickTeamFight('duoFight', Date.now());
      tickTeamFight('trioFight', Date.now());

      const questEventsByPlayer = new Map<string, { kills: number; viruses: number }>();
      const bumpQuestEvent = (playerId: string, kind: 'kill' | 'virus') => {
        const cur = questEventsByPlayer.get(playerId) || { kills: 0, viruses: 0 };
        if (kind === 'kill') cur.kills += 1;
        else cur.viruses += 1;
        questEventsByPlayer.set(playerId, cur);
      };
      const isFriendlyVictim = (hunter: ClientSession, victimId?: string) => {
        if (!victimId) return false;
        if (hunter.playerIds.includes(victimId)) return true;
        const hunterLogin = hunter.deviceId
          ? persistentStore.getPlayer(hunter.deviceId)?.accountLogin?.toLowerCase()
          : undefined;
        for (const other of clients.values()) {
          if (!other.playerIds.includes(victimId)) continue;
          if (hunter.deviceId && other.deviceId && hunter.deviceId === other.deviceId) return true;
          if (hunterLogin) {
            const login = other.deviceId
              ? persistentStore.getPlayer(other.deviceId)?.accountLogin?.toLowerCase()
              : undefined;
            if (login && login === hunterLogin) return true;
          }
        }
        return false;
      };
      for (const ev of [
        ...(hasClassicSession ? classicEngine.consumeQuestEvents() : []),
        ...(sfState.phase !== 'waiting' && sfDuelists.length > 0 ? soloFightEngine.consumeQuestEvents() : []),
        ...(teamStates.duoFight.phase !== 'waiting' && teamFighters.duoFight.length > 0
          ? duoFightEngine.consumeQuestEvents()
          : []),
        ...(teamStates.trioFight.phase !== 'waiting' && teamFighters.trioFight.length > 0
          ? trioFightEngine.consumeQuestEvents()
          : []),
      ]) {
        if (ev.kind === 'virus') {
          bumpQuestEvent(ev.playerId, 'virus');
          continue;
        }
        // Resolve hunter session to ignore multibox / same-account tabs.
        let hunterSession: ClientSession | undefined;
        for (const s of clients.values()) {
          if (s.playerIds.includes(ev.playerId)) {
            hunterSession = s;
            break;
          }
        }
        if (hunterSession && isFriendlyVictim(hunterSession, ev.victimId)) continue;
        bumpQuestEvent(ev.playerId, 'kill');
      }
      const tickMs = getTickMs();
      const leaderboardsByRoom = new Map<RoomMode, NonNullable<StateMessage['leaderboard']>>();

      for (const [ws, session] of clients) {
        if (ws.readyState !== WebSocket.OPEN) continue;

        const engine = engineFor(session.room);

        if (session.joined && session.playerIds.length > 0 && session.deviceId) {
          const profile = persistentStore.getPlayer(session.deviceId);
          const accountOk = !!profile?.accountLogin;
          if (accountOk && isQuestPrimary(session, profile.accountLogin)) {
            if (!session.questRun) session.questRun = emptyQuestRunStats();
            const run = session.questRun;
            let massSum = 0;
            const state = engine.getState();
            const owned = new Set(session.playerIds);
            for (const id of session.playerIds) {
              const player = state.players.find((p) => p.id === id);
              if (!player || player.cells.length === 0) continue;
              massSum += getTotalMass(player);
              const ev = questEventsByPlayer.get(id);
              if (ev) {
                run.kills += ev.kills;
                run.viruses += ev.viruses;
                if (ev.viruses > 0) run.touchedVirus = true;
              }
            }
            const alive = massSum > 0;
            // A profile/socket can remain connected while its owner is in the
            // lobby or spectating. Time quests only advance for an active,
            // living player in a real room.
            const activelyPlaying = alive && session.joined && !session.spectating && !session.lobbyOnly;
            if (activelyPlaying) run.surviveMs += tickMs;
            if (massSum > run.peakMass) run.peakMass = massSum;
            if (!run.touchedVirus && massSum > run.peakMassNoVirus) run.peakMassNoVirus = massSum;

            const ranked = state.players
              .filter((p) => p.cells.length > 0)
              .sort((a, b) => b.score - a.score);
            const rank = ranked.findIndex((p) => owned.has(p.id));
            if (activelyPlaying && rank >= 0 && rank < 10) {
              run.inTop10 = true;
              run.topMs += tickMs;
            } else if (run.inTop10) {
              // Dropped out of top-10 — top quest progress restarts.
              run.inTop10 = false;
              run.topMs = 0;
            }

            if (!session.questProgress) {
              session.questProgress = sanitizeQuestProgress(profile?.quests ?? createDefaultQuestProgress());
            }
            let quests = session.questProgress;
            if (quests.currentTaskId === 'top' && !run.inTop10) {
              quests.currentProgress = 0;
            }
            const previousTimeRunning =
              quests.currentTaskId === 'survive'
                ? activelyPlaying
                : quests.currentTaskId === 'top'
                  ? run.inTop10
                  : false;
            const value = questValueFromRun(quests.currentTaskId, run);
            const before = quests.currentProgress;
            const applied = applyQuestProgressValue(quests, value, getCustomLevelSkinRewards());
            quests = applied.progress;
            session.questProgress = quests;
            if (applied.levelRewards.length) persistentStore.addPendingLevelRewards(session.deviceId, applied.levelRewards);
            const timeRunning =
              !applied.completed &&
              (quests.currentTaskId === 'survive'
                ? activelyPlaying
                : quests.currentTaskId === 'top'
                  ? run.inTop10
                  : false);
            const timerStateChanged = session.questTimerRunning !== timeRunning;
            const nowPush = Date.now();
            const discrete = QUEST_DEFS[quests.currentTaskId].unit === 'count';
            const shouldPush =
              applied.completed ||
              nowPush - session.lastQuestPushAt > QUEST_PROFILE_PUSH_MS ||
              (discrete && quests.currentProgress !== before) ||
              (quests.currentTaskId === 'top' && before > 0 && quests.currentProgress === 0) ||
              timerStateChanged ||
              (applied.completed && previousTimeRunning);
            if (shouldPush && (quests.currentProgress !== before || applied.completed || timerStateChanged)) {
              persistentStore.upsertPlayer(session.deviceId, { quests });
            }
            if (shouldPush && (applied.completed || quests.currentProgress !== before || timerStateChanged)) {
              const saved = persistentStore.getPlayer(session.deviceId) || profile!;
              session.lastQuestPushAt = nowPush;
              send(ws, {
                type: 'playerProfile',
                deviceId: session.deviceId,
                lastNick: saved.lastNick,
                skinId: saved.skinId,
                prefs: saved.prefs,
                accountLogin: saved.accountLogin,
                quest: toQuestPublicView(quests, {
                  timeRunning,
                  pendingLevelRewards: persistentStore.getPlayer(session.deviceId)?.pendingLevelRewards,
                }),
              });
              session.questTimerRunning = timeRunning;
              if (applied.completed) {
                session.questRun = emptyQuestRunStats();
              }
            }
          }
        }

        if (session.joined && session.playerIds.length > 0) {
          const state = engine.getState();
          const stillAlive: string[] = [];
          for (const id of session.playerIds) {
            const player = state.players.find((p) => p.id === id);
            if (player && player.cells.length > 0) {
              stillAlive.push(id);
              if (player.name) session.lastName = player.name;
              if (player.color) session.lastColor = player.color;
              if (player.skin) session.lastSkin = player.skin;
            } else if (player) {
              if (player.name) session.lastName = player.name;
              if (player.color) session.lastColor = player.color;
              if (player.skin) session.lastSkin = player.skin;
              engine.removePlayer(id);
            }
          }
          if (stillAlive.length !== session.playerIds.length) {
            const prevActive = activePlayerId(session);
            session.playerIds = stillAlive;
            const idx = prevActive ? stillAlive.indexOf(prevActive) : -1;
            session.activeIndex = idx >= 0 ? idx : 0;
          }
          if (session.playerIds.length === 0) {
            if (
              session.deviceId &&
              session.questProgress &&
              (session.questProgress.currentTaskId === 'top' ||
                session.questProgress.currentTaskId === 'mass' ||
                session.questProgress.currentTaskId === 'massNoVirus')
            ) {
              session.questProgress.currentProgress = 0;
              persistentStore.upsertPlayer(session.deviceId, { quests: session.questProgress });
              const saved = persistentStore.getPlayer(session.deviceId);
              if (saved?.accountLogin) {
                send(ws, {
                  type: 'playerProfile',
                  deviceId: session.deviceId,
                  lastNick: saved.lastNick,
                  skinId: saved.skinId,
                  prefs: saved.prefs,
                  accountLogin: saved.accountLogin,
                  quest: toQuestPublicView(session.questProgress, {
                    timeRunning: false,
                    pendingLevelRewards: saved.pendingLevelRewards,
                  }),
                });
                session.questTimerRunning = false;
              }
            }
            session.questRun = emptyQuestRunStats();
            if (session.room === 'soloFight') {
              if (sfState.phase === 'fighting' && sfDuelists.includes(session)) {
                handleSoloFightDeath(session);
              } else if (sfDuelists.includes(session)) {
                handleSoloFightLeave(session);
              }
            }
            if (isTeamFight(session.room) && teamFighters[session.room].includes(session)) {
              if (teamStates[session.room].phase === 'fighting') checkTeamFightWinner(session.room);
            }
            // Avoid double-died when endSoloFightMatch already notified
            if (session.joined) {
              send(ws, { type: 'died' });
              session.joined = false;
            }
            session.activeIndex = 0;
            if (session.room === 'soloFight' && !session.lobbyOnly) {
              send(ws, makeSoloFightHud(sfState));
            }
            continue;
          }
        }

        if (session.lobbyOnly) continue;
        session.tickCount = (session.tickCount + 1) | 0;
        if (ws.bufferedAmount > STATE_BACKPRESSURE_BYTES) continue;
        // Physics 30 Hz; snapshots ~10 Hz.
        const sendModulo = STATE_SEND_MODULO;
        if (session.tickCount % sendModulo !== 0) continue;
        // Leaderboard is UI-only; refresh it once every three seconds.
        const includeLb = session.tickCount % (sendModulo * 50) === 0;
        let leaderboard: NonNullable<StateMessage['leaderboard']> | undefined;
        if (includeLb) {
          leaderboard = leaderboardsByRoom.get(session.room);
          if (!leaderboard) {
            leaderboard = buildLeaderboardFor(engine);
            leaderboardsByRoom.set(session.room, leaderboard);
          }
        }
        send(ws, buildStateFor(session, leaderboard));
        if (session.room === 'soloFight') {
          const hud = makeSoloFightHud(sfState);
          const key = `${hud.phase}|${hud.countdown}|${hud.fightSecondsLeft ?? ''}|${hud.a.name}|${hud.a.score}|${hud.b.name}|${hud.b.score}`;
          if (key !== session.lastSfHudKey || session.tickCount % 30 === 0) {
            session.lastSfHudKey = key;
            send(ws, hud);
          }
        }
        if (isTeamFight(session.room)) {
          const hud = makeTeamFightHud(
            session.room,
            teamStates[session.room],
            (team) => teamMembers(session.room as TeamFightMode, team),
            getRoomInfo(session.room).lobby
          );
          const key = `${hud.phase}|${hud.countdown}|${hud.fightSecondsLeft ?? ''}|${hud.blue.alive}|${hud.red.alive}`;
          if (key !== session.lastSfHudKey || session.tickCount % 30 === 0) {
            session.lastSfHudKey = key;
            send(ws, hud);
          }
        }
      }

      roomInfoAcc += getTickMs();
      if (roomInfoAcc >= 1000) {
        roomInfoAcc = 0;
        broadcastRoomInfo();
      }
    }, getTickMs());
  }

  httpServer.on('listening', () => {
    listening = true;
    const c = classicEngine.getState();
    const s = soloFightEngine.getState();
    console.log(`[agar-server] listening on 0.0.0.0:${PORT} (ws://127.0.0.1:${PORT})`);
    console.log(`[agar-server] behind nginx: proxy /ws -> this port (clients use wss://YOUR_DOMAIN/ws)`);
    console.log(`[agar-server] PORT env: ${process.env.PORT || '(default ' + DEFAULT_SERVER_PORT + ')'}`);
    console.log(`[agar-server] ADMIN nicknames: salruz (pass required)`);
    console.log(`[agar-server] classic ${c.worldWidth}x${c.worldHeight}, soloFight ${s.worldWidth}x${s.worldHeight}`);
    const gameApiUrl = process.env.GAME_API_URL?.trim().replace(/\/+$/, '') || `http://127.0.0.1:${PORT}`;
    try {
      startTelegramBot(botLogs, gameApiUrl);
    } catch (error) {
      botLogs.write('error', `Бот не запущен: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      httpServer.close();
      if (attempt === 0) {
        const freed = tryFreePort(PORT);
        if (freed) {
          console.log('[agar-server] Retrying after freeing port...');
          setTimeout(() => startServer(1), 400);
          return;
        }
      }
      printEaddrInUseHelp(PORT);
      process.exit(1);
    }
    console.error('[agar-server] error:', err);
    process.exit(1);
  });

  wss.on('connection', (ws) => {
    const session: ClientSession = {
      ws,
      playerIds: [],
      activeIndex: 0,
      joined: false,
      isAdmin: false,
      adminAuthed: false,
      lobbyOnly: true,
      spectating: false,
      room: 'classic',
      viewX: classicConfig.worldWidth / 2,
      viewY: classicConfig.worldHeight / 2,
      lastChatAt: 0,
      lastName: 'Player',
      lastColor: '#4ECDC4',
      lastSkin: '',
      deviceId: '',
      joinAnnouncedRoom: null,
      tickCount: 0,
      lastSfHudKey: '',
      sentSkins: new Map(),
      sentVirusUntil: new Map(),
      knownFoodIds: new Set(),
      knownEjectIds: new Set(),
      knownVirusIds: new Set(),
      questRun: null,
      questProgress: null,
      lastQuestPushAt: 0,
      questTimerRunning: false,
      questAccountKey: null,
    };
    clients.set(ws, session);

    ws.on('message', (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(raw)) as ClientMessage;
      } catch {
        send(ws, { type: 'error', message: 'Invalid JSON' });
        return;
      }

      // Reply before allocating handlers or touching game state. A received
      // ping therefore never waits behind a gameplay branch or snapshot work.
      if (msg.type === 'ping') {
        sendPong(ws, msg.t);
        return;
      }

      const engine = () => engineFor(session.room);
      const cfg = () => configFor(session.room);

      switch (msg.type) {
        case 'adminIdentify': {
          session.lastName = String(msg.name || '').trim().slice(0, 15) || session.lastName;
          if (isAdminName(session.lastName)) {
            session.adminAuthed = checkAdminPassword((msg as { password?: string }).password);
            if (!session.adminAuthed) {
              send(ws, { type: 'error', message: 'Wrong password for salruz' });
              send(ws, { type: 'adminStatus', ok: false });
              break;
            }
          } else {
            session.adminAuthed = false;
          }
          refreshAdmin(session);
          send(ws, { type: 'adminStatus', ok: session.isAdmin });
          break;
        }
        case 'lobby': {
          const mode = parseMode(msg.mode);
          removePendingFightJoin(session);
          if (session.room === 'soloFight' && sfDuelists.includes(session)) {
            handleSoloFightLeave(session);
            clearSessionPlayers(session, soloFightEngine);
          } else if (isTeamFight(session.room) && teamFighters[session.room].includes(session)) {
            leaveTeamFight(session, session.room);
          } else {
            clearSessionPlayers(session, engine());
          }
          if (session.room !== mode) session.joinAnnouncedRoom = null;
          session.room = mode;
          session.lobbyOnly = true;
          session.spectating = false;
          session.joined = false;
          send(ws, getRoomInfo(mode));
          if (mode === 'soloFight') {
            send(ws, makeSoloFightTop(sfState));
            send(ws, makeSoloFightHud(sfState));
          }
          if (isTeamFight(mode)) {
            send(ws, makeTeamFightTop(mode, teamStates[mode]));
            send(ws, makeTeamFightHud(mode, teamStates[mode], (team) => teamMembers(mode, team), getRoomInfo(mode).lobby));
          }
          broadcastRoomInfo();
          break;
        }
        case 'spectate': {
          const mode = parseMode(msg.mode);
          const alreadyHere =
            mode === session.room && session.spectating && !session.lobbyOnly;
          if (!alreadyHere) {
            removePendingFightJoin(session);
            if (session.room === 'soloFight' && sfDuelists.includes(session)) {
              handleSoloFightLeave(session);
              clearSessionPlayers(session, soloFightEngine);
            } else if (isTeamFight(session.room) && teamFighters[session.room].includes(session)) {
              leaveTeamFight(session, session.room);
            } else {
              clearSessionPlayers(session, engine());
            }
            session.room = mode;
            session.lobbyOnly = false;
            session.spectating = true;
            session.joined = false;
            const st = engineFor(mode).getState();
            session.viewX = st.worldWidth / 2;
            session.viewY = st.worldHeight / 2;
          }
          // Always re-ack spectate (menu → spectate again must refresh welcome/state).
          {
            const st = engineFor(session.room).getState();
            send(ws, {
              type: 'welcome',
              id: `spec-${Date.now().toString(36)}`,
              world: { w: st.worldWidth, h: st.worldHeight },
              isAdmin: false,
            });
            send(ws, { type: 'settings', settings: configFor(session.room), mode: session.room });
            send(ws, buildStateFor(session, buildLeaderboardFor(engineFor(session.room))));
            if (session.room === 'soloFight') {
              send(ws, makeSoloFightHud(sfState));
              send(ws, makeSoloFightTop(sfState));
            }
            if (isTeamFight(session.room)) {
              send(
                ws,
                makeTeamFightHud(
                  session.room,
                  teamStates[session.room],
                  (team) => teamMembers(session.room as TeamFightMode, team),
                  getRoomInfo(session.room).lobby
                )
              );
              send(ws, makeTeamFightTop(session.room, teamStates[session.room]));
            }
            broadcastRoomInfo();
          }
          break;
        }
        case 'join': {
          const mode = parseMode(msg.mode);
          removePendingFightJoin(session);
          if (session.room === 'soloFight' && sfDuelists.includes(session)) {
            handleSoloFightLeave(session);
            clearSessionPlayers(session, soloFightEngine);
          } else if (isTeamFight(session.room) && teamFighters[session.room].includes(session)) {
            leaveTeamFight(session, session.room);
          } else if (session.joined && session.playerIds.length > 0) {
            clearSessionPlayers(session, engine());
          }
          if (session.joinAnnouncedRoom && session.joinAnnouncedRoom !== mode) {
            session.joinAnnouncedRoom = null;
          }

          const name = (msg.name || session.lastName || 'Player').trim().slice(0, 15) || 'Player';
          if (isAdminName(name)) {
            session.adminAuthed = checkAdminPassword(msg.password);
            if (!session.adminAuthed) {
              send(ws, { type: 'error', message: 'Wrong password for salruz' });
              break;
            }
          } else {
            session.adminAuthed = false;
          }
          session.lastName = name;
          const skin = String(msg.skin || '').trim();
          session.lastSkin = skin;

          const resolvedDevice =
            persistentStore.resolveDeviceId(
              typeof msg.deviceId === 'string' ? msg.deviceId : undefined,
              typeof msg.fingerprint === 'string' ? msg.fingerprint : undefined
            ) || (typeof msg.deviceId === 'string' ? msg.deviceId.trim().slice(0, 80) : '');
          if (resolvedDevice) {
            session.deviceId = resolvedDevice;
            const profile = persistentStore.upsertPlayer(resolvedDevice, {
              lastNick: name,
              skinId: skin || undefined,
              fingerprint: typeof msg.fingerprint === 'string' ? msg.fingerprint : undefined,
            });
            send(ws, {
              type: 'playerProfile',
              deviceId: resolvedDevice,
              lastNick: profile.lastNick,
              skinId: profile.skinId,
              prefs: profile.prefs,
              accountLogin: profile.accountLogin,
              quest: toQuestPublicView(sanitizeQuestProgress(profile.quests), {
                followerOnly: !!profile.accountLogin && !isQuestPrimary(session, profile.accountLogin),
                pendingLevelRewards: profile.pendingLevelRewards,
              }),
            });
            session.questRun = emptyQuestRunStats();
            session.questProgress = sanitizeQuestProgress(profile.quests);
          }

          if (mode === 'soloFight') {
            joinSoloFight(session, name, skin);
            break;
          }
          if (isTeamFight(mode)) {
            joinTeamFight(session, mode, name, skin, msg.team);
            break;
          }

          session.room = 'classic';
          session.lobbyOnly = false;
          session.spectating = false;
          const player = classicEngine.addPlayer(name, false, { skin: skin || undefined });
          session.playerIds = [player.id];
          session.activeIndex = 0;
          session.joined = true;
          beginQuestLife(session);
          session.lastColor = player.color;
          refreshAdmin(session);
          sendWelcome(session, player.id, classicEngine, session.isAdmin);
          if (session.isAdmin) {
            console.log(`[agar-server] admin online: ${session.lastName}`);
          }
          send(ws, { type: 'settings', settings: classicConfig, mode: 'classic' });
          announceJoin('classic', session, name);
          broadcastRoomInfo();
          break;
        }
        case 'adminAuth': {
          refreshAdmin(session);
          send(ws, { type: 'adminStatus', ok: session.isAdmin });
          break;
        }
        case 'adminGetSettings': {
          refreshAdmin(session);
          if (!session.isAdmin) return;
          // Solo Fight physics lives on classic; always return classic (includes soloFightWorldSize)
          send(ws, { type: 'settings', settings: classicConfig, mode: 'classic' });
          break;
        }
        case 'adminUpdateSettings': {
          refreshAdmin(session);
          if (!session.isAdmin) return;
          const prevClassicTick = classicConfig.serverTickHz;
          const prevSfTick = soloFightConfig.serverTickHz;
          // Always update classic; soloFightWorldSize (if present) drives SF sync
          applyClassicConfigAndSyncSf(msg.settings);
          persistentStore.setConfig(classicConfig);
          broadcastToRoom('classic', {
            type: 'settings',
            settings: classicConfig,
            mode: 'classic',
          });
          broadcastToRoom('classic', {
            type: 'world',
            w: classicConfig.worldWidth,
            h: classicConfig.worldHeight,
          });
          broadcastToRoom('soloFight', {
            type: 'settings',
            settings: soloFightConfig,
            mode: 'soloFight',
          });
          broadcastToRoom('soloFight', {
            type: 'world',
            w: soloFightConfig.worldWidth,
            h: soloFightConfig.worldHeight,
          });
          for (const mode of ['duoFight', 'trioFight'] as TeamFightMode[]) {
            const cfg = configFor(mode);
            broadcastToRoom(mode, { type: 'settings', settings: cfg, mode });
            broadcastToRoom(mode, { type: 'world', w: cfg.worldWidth, h: cfg.worldHeight });
          }
          if (
            classicConfig.serverTickHz !== prevClassicTick ||
            soloFightConfig.serverTickHz !== prevSfTick
          ) {
            restartTickLoop();
          }
          send(ws, { type: 'settings', settings: classicConfig, mode: 'classic' });
          break;
        }
        case 'adminAddMass': {
          refreshAdmin(session);
          const id = activePlayerId(session);
          if (!session.isAdmin || !id) return;
          const amount = Math.max(1, Math.min(5000, Number(msg.amount) || cfg().adminMassBoost));
          engine().addMass(id, amount);
          break;
        }
        case 'adminSkipQuest': {
          refreshAdmin(session);
          if (!session.isAdmin || !session.deviceId) return;
          const profile = persistentStore.getPlayer(session.deviceId);
          if (!profile?.accountLogin) return;
          if (!session.questProgress) {
            session.questProgress = sanitizeQuestProgress(profile.quests ?? createDefaultQuestProgress());
          }
          const req = session.questProgress.tasks[session.questProgress.currentTaskId].requirement;
          const applied = applyQuestProgressValue(session.questProgress, req, getCustomLevelSkinRewards());
          session.questProgress = applied.progress;
          session.questRun = emptyQuestRunStats();
          if (applied.levelRewards.length) persistentStore.addPendingLevelRewards(session.deviceId, applied.levelRewards);
          const saved = persistentStore.upsertPlayer(session.deviceId, { quests: session.questProgress });
          send(ws, {
            type: 'playerProfile',
            deviceId: session.deviceId,
            lastNick: saved.lastNick,
            skinId: saved.skinId,
            prefs: saved.prefs,
            accountLogin: saved.accountLogin,
            quest: toQuestPublicView(session.questProgress, {
              pendingLevelRewards: persistentStore.getPlayer(session.deviceId)?.pendingLevelRewards,
            }),
          });
          break;
        }
        case 'adminSpawnVirus': {
          refreshAdmin(session);
          if (!session.isAdmin) return;
          engine().spawnVirusAt(Number(msg.x) || 0, Number(msg.y) || 0);
          break;
        }
        case 'adminTeleport': {
          refreshAdmin(session);
          const id = activePlayerId(session);
          if (!session.isAdmin || !id) return;
          engine().teleportPlayer(id, Number(msg.x) || 0, Number(msg.y) || 0);
          break;
        }
        case 'adminForceMerge': {
          refreshAdmin(session);
          const id = activePlayerId(session);
          if (!session.isAdmin || !id) return;
          engine().forceMergePlayer(id);
          break;
        }
        case 'adminKickAt': {
          refreshAdmin(session);
          if (!session.isAdmin) return;
          engine().removePlayerAt(Number(msg.x) || 0, Number(msg.y) || 0, activePlayerId(session));
          break;
        }
        case 'adminSpawnBot': {
          refreshAdmin(session);
          if (!session.isAdmin) return;
          if (session.room !== 'classic') return;
          const mass = Math.max(10, Math.min(50000, Number(msg.mass) || 500));
          engine().spawnBotAt(Number(msg.x) || 0, Number(msg.y) || 0, mass);
          break;
        }
        case 'resetStarter': {
          refreshAdmin(session);
          const id = activePlayerId(session);
          if (!session.isAdmin || !id) return;
          engine().resetToStarter(id);
          break;
        }
        case 'rename': {
          const id = activePlayerId(session);
          if (!id) return;
          const name = String(msg.name || '').trim().slice(0, 15);
          if (!name) return;
          if (isAdminName(name)) {
            session.adminAuthed = checkAdminPassword(msg.password);
            if (!session.adminAuthed) {
              send(ws, { type: 'error', message: 'Wrong password for salruz' });
              send(ws, { type: 'adminStatus', ok: false });
              break;
            }
          } else {
            session.adminAuthed = false;
          }
          session.lastName = name;
          engine().updatePlayerName(id, name);
          if (msg.skin !== undefined) {
            const skin = String(msg.skin || '').trim();
            session.lastSkin = skin;
            for (const pid of session.playerIds) {
              engine().updatePlayerSkin(pid, skin || undefined);
            }
          }
          refreshAdmin(session);
          send(ws, { type: 'adminStatus', ok: session.isAdmin });
          break;
        }
        case 'multiboxSpawn': {
          if (session.room !== 'classic') return;
          if (!session.joined) return;
          const state = engine().getState();
          const primaryId = activePlayerId(session);
          const primary = primaryId ? state.players.find((p) => p.id === primaryId) : undefined;
          if (!primary || primary.cells.length === 0) return;
          if (session.playerIds.length >= 2) return;
          if (primaryId) engine().cruisePlayerInLastAim(primaryId);
          const box = engine().addPlayer(primary.name, false, {
            color: primary.color,
            skin: primary.skin || session.lastSkin || undefined,
          });
          session.playerIds.push(box.id);
          session.activeIndex = session.playerIds.length - 1;
          break;
        }
        case 'multiboxSwitch': {
          if (session.room !== 'classic') return;
          if (session.playerIds.length < 2) return;
          const prevId = activePlayerId(session);
          if (prevId) engine().cruisePlayerInLastAim(prevId);
          session.activeIndex = (session.activeIndex + 1) % session.playerIds.length;
          break;
        }
        case 'chat': {
          if (!session.lastName) return;
          const now = Date.now();
          if (now - session.lastChatAt < CHAT_RATE_LIMIT_MS) return;
          const text = sanitizeChat(String(msg.text || ''));
          if (!text) return;
          session.lastChatAt = now;
          const liveId = activePlayerId(session);
          const live = liveId
            ? engine().getState().players.find((p) => p.id === liveId)
            : undefined;
          if (live) {
            session.lastName = live.name;
            session.lastColor = live.color;
          }
          const name = live?.name || session.lastName || 'Player';
          const color = live?.color || session.lastColor || '#4ECDC4';
          const profile = session.deviceId ? persistentStore.getPlayer(session.deviceId) : undefined;
          const hideLevel = profile?.prefs?.hideLevel === true;
          const level = hideLevel
            ? undefined
            : toQuestPublicView(session.questProgress ?? sanitizeQuestProgress(profile?.quests)).level;
          broadcastGameChat(session.room, name, text, color, { level, hideLevel });
          break;
        }
        case 'privateMessage': {
          const now = Date.now();
          if (now - session.lastChatAt < CHAT_RATE_LIMIT_MS) return;
          const to = String(msg.to || '').trim().slice(0, 30);
          const text = sanitizeChat(String(msg.text || ''));
          if (!to || !text || !session.lastName) return;
          if (/^(?:🏆\s*)?система$/iu.test(to)) {
            send(ws, { type: 'error', message: 'Нельзя отправить личное сообщение Системе' });
            break;
          }
          const liveId = activePlayerId(session);
          const live = liveId ? engine().getState().players.find((p) => p.id === liveId) : undefined;
          const name = live?.name || session.lastName || 'Player';
          const color = live?.color || session.lastColor || '#4ECDC4';
          const profile = session.deviceId ? persistentStore.getPlayer(session.deviceId) : undefined;
          if (normalizeNick(to) === normalizeNick(name)) {
            send(ws, { type: 'error', message: 'Нельзя отправить личное сообщение самому себе' });
            break;
          }
          const hideLevel = profile?.prefs?.hideLevel === true;
          const level = hideLevel
            ? undefined
            : toQuestPublicView(session.questProgress ?? sanitizeQuestProgress(profile?.quests)).level;
          let delivered = false;
          for (const [peerWs, peer] of clients) {
            if (peer === session || peer.lastName.localeCompare(to, undefined, { sensitivity: 'accent' }) !== 0) continue;
            if (
              (session.deviceId && peer.deviceId === session.deviceId) ||
              (profile?.accountLogin &&
                persistentStore.getPlayer(peer.deviceId || '')?.accountLogin?.toLowerCase() === profile.accountLogin.toLowerCase())
            ) {
              continue;
            }
            send(peerWs, { type: 'privateChat', name, text, t: now, color, level, hideLevel });
            delivered = true;
          }
          if (delivered) {
            session.lastChatAt = now;
            send(ws, { type: 'privateChat', name, text, t: now, color, level, hideLevel });
          } else {
            send(ws, { type: 'error', message: 'Игрок не в сети' });
          }
          break;
        }
        case 'input': {
          const mx = Number(msg.mx);
          const my = Number(msg.my);
          if (Number.isFinite(mx) && Number.isFinite(my)) {
            session.viewX = mx;
            session.viewY = my;
          }
          const id = activePlayerId(session);
          if (!id) return;
          engine().updatePlayerTarget(id, mx, my);
          break;
        }
        case 'split': {
          const id = activePlayerId(session);
          if (!id) return;
          if (
            session.room === 'soloFight' &&
            (sfState.phase === 'waiting' || sfState.phase === 'countdown')
          ) {
            return;
          }
          if (isTeamFight(session.room) && teamStates[session.room].phase !== 'fighting') return;
          const created = engine().splitPlayer(id);
          if (session.questRun && created > 0) session.questRun.splits += 1;
          break;
        }
        case 'eject': {
          const id = activePlayerId(session);
          if (!id) return;
          if (
            session.room === 'soloFight' &&
            (sfState.phase === 'waiting' || sfState.phase === 'countdown')
          ) {
            return;
          }
          if (isTeamFight(session.room) && teamStates[session.room].phase !== 'fighting') return;
          engine().ejectMass(id);
          break;
        }
        case 'freeze': {
          const id = activePlayerId(session);
          if (!id) return;
          if (
            session.room === 'soloFight' &&
            (sfState.phase === 'waiting' || sfState.phase === 'countdown')
          ) {
            return;
          }
          if (isTeamFight(session.room) && teamStates[session.room].phase !== 'fighting') return;
          const player = engine().getState().players.find((p) => p.id === id);
          if (!player) return;
          const next = typeof msg.frozen === 'boolean' ? msg.frozen : !player.frozen;
          engine().setPlayerFrozen(id, next);
          break;
        }
        case 'syncProfile': {
          const deviceId =
            persistentStore.resolveDeviceId(msg.deviceId, msg.fingerprint) ||
            String(msg.deviceId || '').trim().slice(0, 80);
          if (!deviceId) break;
          session.deviceId = deviceId;
          const profile = persistentStore.upsertPlayer(deviceId, {
            lastNick: msg.lastNick,
            skinId: msg.skinId === null ? '' : msg.skinId,
            prefs: msg.prefs,
            fingerprint: msg.fingerprint,
          });
          send(ws, {
            type: 'playerProfile',
            deviceId,
            lastNick: profile.lastNick,
            skinId: profile.skinId,
            prefs: profile.prefs,
            accountLogin: persistentStore.isAccountBoundToDevice(profile.accountLogin, deviceId)
              ? profile.accountLogin
              : null,
            quest: toQuestPublicView(sanitizeQuestProgress(profile.quests), {
              followerOnly: !!profile.accountLogin && !isQuestPrimary(session, profile.accountLogin),
              pendingLevelRewards: profile.pendingLevelRewards,
            }),
          });
          session.questProgress = sanitizeQuestProgress(profile.quests);
          break;
        }
        case 'registerAccount': {
          const deviceId =
            persistentStore.resolveDeviceId(msg.deviceId, msg.fingerprint) ||
            String(msg.deviceId || '').trim().slice(0, 80);
          if (!deviceId) {
            send(ws, { type: 'registerAccountResult', ok: false, message: 'Нет device id' });
            break;
          }
          session.deviceId = deviceId;
          if (msg.fingerprint) {
            persistentStore.upsertPlayer(deviceId, { fingerprint: msg.fingerprint, lastNick: session.lastName });
          }
          const result = persistentStore.registerAccount(deviceId, String(msg.login || ''), String(msg.password || ''));
          if (!result.ok) {
            send(ws, { type: 'registerAccountResult', ok: false, message: result.error });
            break;
          }
          send(ws, {
            type: 'registerAccountResult',
            ok: true,
            message: 'Аккаунт создан',
            accountLogin: result.profile.accountLogin,
          });
          send(ws, {
            type: 'playerProfile',
            deviceId,
            lastNick: result.profile.lastNick,
            skinId: result.profile.skinId,
            prefs: result.profile.prefs,
            accountLogin: result.profile.accountLogin,
            quest: toQuestPublicView(sanitizeQuestProgress(result.profile.quests), {
              followerOnly: !!result.profile.accountLogin && !isQuestPrimary(session, result.profile.accountLogin),
              pendingLevelRewards: result.profile.pendingLevelRewards,
            }),
          });
          session.questProgress = sanitizeQuestProgress(result.profile.quests);
          break;
        }
        case 'loginAccount': {
          const deviceId =
            persistentStore.resolveDeviceId(msg.deviceId, msg.fingerprint) ||
            String(msg.deviceId || '').trim().slice(0, 80);
          if (!deviceId) {
            send(ws, { type: 'loginAccountResult', ok: false, message: 'Нет device id' });
            break;
          }
          session.deviceId = deviceId;
          if (msg.fingerprint) {
            persistentStore.upsertPlayer(deviceId, { fingerprint: msg.fingerprint, lastNick: session.lastName });
          }
          const result = persistentStore.loginAccountOnDevice(
            deviceId,
            String(msg.login || ''),
            String(msg.password || '')
          );
          if (!result.ok) {
            send(ws, { type: 'loginAccountResult', ok: false, message: result.error });
            break;
          }
          send(ws, {
            type: 'loginAccountResult',
            ok: true,
            message: 'Вход выполнен',
            accountLogin: result.profile.accountLogin,
          });
          send(ws, {
            type: 'playerProfile',
            deviceId,
            lastNick: result.profile.lastNick,
            skinId: result.profile.skinId,
            prefs: result.profile.prefs,
            accountLogin: result.profile.accountLogin,
            quest: toQuestPublicView(sanitizeQuestProgress(result.profile.quests), {
              followerOnly: !!result.profile.accountLogin && !isQuestPrimary(session, result.profile.accountLogin),
              pendingLevelRewards: result.profile.pendingLevelRewards,
            }),
          });
          session.questProgress = sanitizeQuestProgress(result.profile.quests);
          break;
        }
        case 'requestPasswordReset': {
          const login = String(msg.login || '').trim();
          if (!/^[a-zA-Z0-9]{1,15}$/.test(login) || !persistentStore.getAccount(login)) {
            send(ws, { type: 'passwordResetResult', action: 'request', ok: false, message: 'Аккаунт не найден' });
            break;
          }
          const chatId = persistentStore.getTelegramChatId(login);
          if (!chatId) {
            send(ws, {
              type: 'passwordResetResult',
              action: 'request',
              ok: false,
              message: 'Аккаунт не привязан к Telegram. Войдите в боте и привяжите аккаунт.',
            });
            break;
          }
          const code = String(randomInt(0, 10_000)).padStart(4, '0');
          passwordResetCodes.set(login.toLowerCase(), { code, expiresAt: Date.now() + PASSWORD_RESET_TTL_MS });
          queueBotMessage(chatId, `Код для сброса пароля Agarva: ${code}`);
          send(ws, {
            type: 'passwordResetResult',
            action: 'request',
            ok: true,
            message: 'Код отправлен в Telegram. Введите его и новый пароль.',
          });
          break;
        }
        case 'confirmPasswordReset': {
          const login = String(msg.login || '').trim();
          const code = String(msg.code || '').trim();
          const reset = passwordResetCodes.get(login.toLowerCase());
          if (!reset || reset.expiresAt < Date.now() || reset.code !== code) {
            if (reset?.expiresAt && reset.expiresAt < Date.now()) passwordResetCodes.delete(login.toLowerCase());
            send(ws, {
              type: 'passwordResetResult',
              action: 'confirm',
              ok: false,
              message: 'Неверный или просроченный код',
            });
            break;
          }
          const result = persistentStore.updateAccountPassword(login, String(msg.newPassword || ''));
          if (!result.ok) {
            send(ws, { type: 'passwordResetResult', action: 'confirm', ok: false, message: result.error });
            break;
          }
          passwordResetCodes.delete(login.toLowerCase());
          send(ws, {
            type: 'passwordResetResult',
            action: 'confirm',
            ok: true,
            message: 'Пароль изменён. Теперь войдите с новым паролем.',
          });
          break;
        }
        case 'adminDownloadDb': {
          if (!session.isAdmin) {
            send(ws, { type: 'error', message: 'Admin only' });
            break;
          }
          send(ws, { type: 'adminDbExport', json: persistentStore.exportJson() });
          break;
        }
        case 'adminUploadDb': {
          if (!session.isAdmin) {
            send(ws, { type: 'error', message: 'Admin only' });
            break;
          }
          const result = persistentStore.importJson(String(msg.json || ''));
          if (!result.ok) {
            send(ws, { type: 'adminDbResult', ok: false, message: result.error });
            break;
          }
          sfState.scores = persistentStore.getScores('soloFight');
          teamStates.duoFight.scores = persistentStore.getScores('duoFight');
          teamStates.trioFight.scores = persistentStore.getScores('trioFight');
          const cfg = persistentStore.getConfig();
          if (cfg) {
            classicConfig = sanitizeGameplayConfig(cfg);
            // keep engines in sync via existing settings path if present
          }
          broadcastSoloFightTop();
          broadcastTeamMeta('duoFight');
          broadcastTeamMeta('trioFight');
          broadcastRoomInfo();
          send(ws, { type: 'adminDbResult', ok: true, message: 'База данных загружена' });
          break;
        }
        case 'adminWipeDatabase': {
          refreshAdmin(session);
          if (!session.isAdmin) {
            send(ws, { type: 'adminDbResult', ok: false, message: 'Только для администратора' });
            break;
          }
          if (!/^(confirm|конфирм)$/iu.test(msg.confirmation.trim())) {
            send(ws, { type: 'adminDbResult', ok: false, message: 'Подтверждение не принято' });
            break;
          }
          wipePersistentGameData();
          send(ws, { type: 'adminDbResult', ok: true, message: 'Вся база данных стёрта и сброшена к значениям по умолчанию' });
          break;
        }
        case 'adminGetBotLogs': {
          refreshAdmin(session);
          if (!session.isAdmin) {
            send(ws, { type: 'error', message: 'Admin only' });
            break;
          }
          send(ws, { type: 'adminBotLogs', text: botLogs.getText() });
          break;
        }
        case 'adminRestartClassic': {
          refreshAdmin(session);
          if (!session.isAdmin) {
            send(ws, { type: 'adminDbResult', ok: false, message: 'Только для администратора' });
            break;
          }
          restartClassicRoom();
          send(ws, {
            type: 'adminDbResult',
            ok: true,
            message: 'Классик сервер перезагружен: игровое поле очищено, игроки сброшены',
          });
          break;
        }
        default:
          send(ws, { type: 'error', message: 'Unknown message type' });
      }
    });

    const cleanup = () => {
      removePendingFightJoin(session);
      if (session.room === 'soloFight' && sfDuelists.includes(session)) {
        handleSoloFightLeave(session);
        clearSessionPlayers(session, soloFightEngine);
      } else if (isTeamFight(session.room) && teamFighters[session.room].includes(session)) {
        leaveTeamFight(session, session.room);
      } else {
        clearSessionPlayers(session, engineFor(session.room));
      }
      clients.delete(ws);
      if (session.questAccountKey && questPrimaryByAccount.get(session.questAccountKey) === ws) {
        const replacement = [...clients.values()].find(
          (candidate) =>
            candidate.questAccountKey === session.questAccountKey &&
            candidate.ws.readyState === WebSocket.OPEN
        );
        if (replacement) questPrimaryByAccount.set(session.questAccountKey, replacement.ws);
        else questPrimaryByAccount.delete(session.questAccountKey);
      }
      broadcastRoomInfo();
    };

    ws.on('close', cleanup);
    ws.on('error', cleanup);
  });

  httpServer.listen(PORT, '0.0.0.0');
  processWeeklyTops();
  restartTickLoop();

  const shutdown = () => {
    if (tickTimer) clearInterval(tickTimer);
    wss.close();
    httpServer.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startServer();
