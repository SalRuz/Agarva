import { WebSocketServer, WebSocket } from 'ws';
import { execSync } from 'node:child_process';
import { GameEngine } from '../shared/GameEngine';
import { defaultGameplayConfig, sanitizeGameplayConfig, type GameplayConfig } from '../shared/gameConfig';
import {
  DEFAULT_SERVER_PORT,
  CHAT_MAX_LENGTH,
  CHAT_RATE_LIMIT_MS,
  ADMIN_PASSWORD,
} from '../shared/constants';
import { getPlayerCenter, distance, isAdminName, createFood } from '../shared/physics';
import { getEntityViewRadius, isWithinViewRadius, isEntityNearView } from '../shared/sectors';
import type { ClientMessage, ServerMessage, NetPlayer, StateMessage } from '../shared/protocol';
import type { Player } from '../shared/types';
import {
  type RoomMode,
  createSoloFightEngine,
  createEmptySoloFightState,
  makeSoloFightHud,
  soloFightSpawnPoints,
  SOLO_FIGHT_COUNTDOWN_MS,
  SOLO_FIGHT_BETWEEN_MS,
  type SoloFightState,
} from './soloFight';

const PORT = Number(process.env.PORT) || DEFAULT_SERVER_PORT;

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
  /** View center for FOV when not controlling a live player */
  viewX: number;
  viewY: number;
  lastChatAt: number;
  lastName: string;
  lastColor: string;
  lastSkin: string;
}

function parseMode(mode?: string): RoomMode {
  return mode === 'soloFight' ? 'soloFight' : 'classic';
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

function sanitizeSkinId(skin: unknown): string {
  return String(skin ?? '')
    .trim()
    .slice(0, 64)
    .replace(/[\\/<>\0]/g, '');
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
        console.log(`[agar-server] Освободил порт ${port} (старый node PID ${pid})`);
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
  console.error(`[agar-server] Ошибка: порт ${port} уже занят (EADDRINUSE).`);
  console.error('Возможные причины: сервер уже запущен, или остался старый процесс node.');
  console.error('');
  console.error('Windows — найти и убить процесс:');
  console.error(`  netstat -ano | findstr :${port}`);
  console.error('  taskkill /PID <pid> /F');
  console.error('');
  console.error('Или задайте другой порт:');
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
  let classicConfig: GameplayConfig = sanitizeGameplayConfig(defaultGameplayConfig);
  const classicEngine = new GameEngine({
    botCount: classicConfig.botCountMp,
    foodCount: classicConfig.foodCountMp,
    virusCount: classicConfig.virusCount,
    multiplayer: true,
    worldWidth: classicConfig.worldWidth,
    worldHeight: classicConfig.worldHeight,
    config: classicConfig,
  });

  const sfCreated = createSoloFightEngine();
  let soloFightConfig: GameplayConfig = sfCreated.config;
  const soloFightEngine = sfCreated.engine;
  const sfState: SoloFightState = createEmptySoloFightState();
  /** Registered duelists (kept through death until leave / both gone) */
  let sfDuelists: ClientSession[] = [];

  const clients = new Map<WebSocket, ClientSession>();

  function engineFor(room: RoomMode): GameEngine {
    return room === 'soloFight' ? soloFightEngine : classicEngine;
  }

  function configFor(room: RoomMode): GameplayConfig {
    return room === 'soloFight' ? soloFightConfig : classicConfig;
  }

  function send(ws: WebSocket, msg: ServerMessage) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  function broadcast(msg: ServerMessage) {
    for (const [ws] of clients) {
      send(ws, msg);
    }
  }

  function broadcastToRoom(room: RoomMode, msg: ServerMessage) {
    for (const [ws, session] of clients) {
      if (session.room !== room) continue;
      send(ws, msg);
    }
  }

  function toNetPlayer(p: Player, cellFilter?: (c: Player['cells'][0]) => boolean): NetPlayer {
    const cells = cellFilter ? p.cells.filter(cellFilter) : p.cells;
    const net: NetPlayer = {
      id: p.id,
      name: p.name,
      color: p.color,
      score: p.score,
      cells: cells.map((c) => ({
        id: c.id,
        x: Math.round(c.x * 10) / 10,
        y: Math.round(c.y * 10) / 10,
        r: Math.round(c.radius * 10) / 10,
        c: c.color,
      })),
      fr: p.frozen ? 1 : 0,
    };
    if (p.skin) net.skin = p.skin;
    return net;
  }

  function buildStateFor(session: ClientSession): StateMessage {
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
    const center = playing
      ? getPlayerCenter(youPlayer!)
      : {
          x: Number.isFinite(session.viewX) ? session.viewX : ww / 2,
          y: Number.isFinite(session.viewY) ? session.viewY : wh / 2,
        };

    const viewMult = playing ? cfg.playViewRadiusMult : cfg.spectateViewRadiusMult;
    const viewR = getEntityViewRadius(ww, wh, viewMult);
    const inView = (x: number, y: number) => isWithinViewRadius(x, y, center.x, center.y, viewR);
    const cellInView = (x: number, y: number, r: number) =>
      isEntityNearView(x, y, r, center.x, center.y, viewR);

    const food = state.food
      .filter((f) => inView(f.x, f.y))
      .sort((a, b) => distance(center, a) - distance(center, b))
      .slice(0, cfg.foodNetMax)
      .map((f) => ({
        id: f.id,
        x: Math.round(f.x),
        y: Math.round(f.y),
        c: f.color,
      }));

    const viruses = state.viruses
      .filter((v) => cellInView(v.x, v.y, v.radius))
      .map((v) => ({
        id: v.id,
        x: Math.round(v.x * 10) / 10,
        y: Math.round(v.y * 10) / 10,
        r: Math.round(v.radius),
        ch: v.charge,
      }));

    const ejected = state.ejectedMass
      .filter((e) => inView(e.x, e.y))
      .sort((a, b) => distance(center, a) - distance(center, b))
      .slice(0, cfg.ejectNetMax)
      .map((e) => ({
        id: e.id,
        x: Math.round(e.x * 10) / 10,
        y: Math.round(e.y * 10) / 10,
        r: Math.round(e.radius * 10) / 10,
        c: e.color,
      }));

    const youId = youPlayer?.id;
    const players = state.players
      .filter((p) => p.cells.length > 0 && p.id !== youId)
      .map((p) =>
        ownedSet.has(p.id)
          ? toNetPlayer(p)
          : toNetPlayer(p, (c) => cellInView(c.x, c.y, c.radius))
      )
      .filter((p) => p.cells.length > 0);

    return {
      type: 'state',
      t: Date.now(),
      you: playing ? toNetPlayer(youPlayer!) : null,
      players,
      food,
      viruses,
      ejected,
      leaderboard: engine.getLeaderboard(),
      ownedIds: session.playerIds.length > 0 ? [...session.playerIds] : undefined,
    };
  }

  // Try to free leftover node listener once before bind
  if (attempt === 0) {
    tryFreePort(PORT);
  }

  const wss = new WebSocketServer({ host: '0.0.0.0', port: PORT });

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
  }

  function getRoomInfo(mode: RoomMode = 'classic'): {
    type: 'roomInfo';
    players: number;
    lobby: number;
    mode: RoomMode;
  } {
    let players = 0;
    let lobby = 0;
    const engine = engineFor(mode);
    const state = engine.getState();
    for (const session of clients.values()) {
      if (session.room !== mode) continue;
      if (session.lobbyOnly) {
        lobby += 1;
        continue;
      }
      if (session.joined && session.playerIds.length > 0) {
        const alive = session.playerIds.some((id) => {
          const p = state.players.find((x) => x.id === id);
          return !!(p && p.cells.length > 0 && !p.isBot);
        });
        if (alive) players += 1;
      }
    }
    return { type: 'roomInfo', players, lobby, mode };
  }

  function broadcastRoomInfo() {
    for (const [ws, session] of clients) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      if (!session.lobbyOnly) continue;
      send(ws, getRoomInfo(session.room));
    }
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

  function awardSoloFightPoint(winnerName: string) {
    sfState.scores.set(winnerName, (sfState.scores.get(winnerName) ?? 0) + 1);
    sfState.phase = 'between';
    sfState.betweenEndsAt = Date.now() + SOLO_FIGHT_BETWEEN_MS;
    freezeSfFighters(true);
  }

  function resetSoloFightToWaiting() {
    syncSfMetaFromDuelists();
    if (sfDuelists.length === 0) {
      sfState.phase = 'waiting';
      sfState.countdownEndsAt = 0;
      sfState.betweenEndsAt = 0;
      sfState.names = [];
      sfState.fighterPlayerIds = [];
      sfState.scores.clear();
      return;
    }
    sfState.phase = 'waiting';
    sfState.countdownEndsAt = 0;
    sfState.betweenEndsAt = 0;
    freezeSfFighters(true);
  }

  /** Fighter died in combat — award point to surviving opponent before session clears. */
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
      awardSoloFightPoint(othersAlive[0].lastName);
    } else if (othersAlive.length === 0) {
      sfState.phase = 'between';
      sfState.betweenEndsAt = Date.now() + SOLO_FIGHT_BETWEEN_MS;
    }
    syncSfMetaFromDuelists();
  }

  /** Fighter left / closed — adjust phase; clear scores if none left. */
  function handleSoloFightLeave(session: ClientSession) {
    if (!sfDuelists.includes(session)) return;
    const wasFighting = sfState.phase === 'fighting';
    const remaining = sfDuelists.filter((s) => s !== session);
    sfDuelists = remaining;

    if (sfDuelists.length === 0) {
      sfState.scores.clear();
      sfState.phase = 'waiting';
      sfState.countdownEndsAt = 0;
      sfState.betweenEndsAt = 0;
      sfState.names = [];
      sfState.fighterPlayerIds = [];
      return;
    }

    if (sfDuelists.length === 1) {
      const winner = sfDuelists[0];
      if (wasFighting && winner.joined && winner.playerIds.length > 0) {
        sfState.scores.set(winner.lastName, (sfState.scores.get(winner.lastName) ?? 0) + 1);
      }
      sfState.phase = 'waiting';
      sfState.countdownEndsAt = 0;
      sfState.betweenEndsAt = 0;
      syncSfMetaFromDuelists();
      freezeSfFighters(true);
    }
  }

  function respawnSoloFightRound() {
    sfDuelists = sfDuelists.filter((s) => s.ws.readyState === WebSocket.OPEN);
    if (sfDuelists.length < 2) {
      resetSoloFightToWaiting();
      return;
    }

    const ww = soloFightEngine.getState().worldWidth;
    const wh = soloFightEngine.getState().worldHeight;
    const spawns = soloFightSpawnPoints(ww, wh);
    const names: string[] = [];
    const ids: string[] = [];

    for (let i = 0; i < sfDuelists.length; i++) {
      const session = sfDuelists[i];
      clearSessionPlayers(session, soloFightEngine);
      const spawn = spawns[Math.min(i, spawns.length - 1)];
      const player = soloFightEngine.addPlayer(session.lastName, false, {
        x: spawn.x,
        y: spawn.y,
        skin: session.lastSkin || undefined,
        color: session.lastColor || undefined,
      });
      soloFightEngine.setPlayerFrozen(player.id, true);
      session.playerIds = [player.id];
      session.activeIndex = 0;
      session.joined = true;
      session.spectating = false;
      session.lobbyOnly = false;
      session.room = 'soloFight';
      session.lastColor = player.color;
      names.push(session.lastName);
      ids.push(player.id);
      send(session.ws, {
        type: 'welcome',
        id: player.id,
        world: { w: ww, h: wh },
        isAdmin: session.isAdmin,
      });
    }

    sfState.names = names;
    sfState.fighterPlayerIds = ids;
    sfState.phase = 'countdown';
    sfState.countdownEndsAt = Date.now() + SOLO_FIGHT_COUNTDOWN_MS;
    sfState.betweenEndsAt = 0;
  }

  function tickSoloFightPhases() {
    const now = Date.now();

    if (sfState.phase === 'waiting' || sfState.phase === 'countdown') {
      freezeSfFighters(true);
    }

    if (sfState.phase === 'countdown' && now >= sfState.countdownEndsAt) {
      freezeSfFighters(false);
      sfState.phase = 'fighting';
    }

    if (sfState.phase === 'between' && now >= sfState.betweenEndsAt) {
      respawnSoloFightRound();
    }
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

  function joinSoloFight(session: ClientSession, name: string, skin: string) {
    // Capacity by registered duelists (covers between-round dead sessions)
    const openDuelists = sfDuelists.filter((s) => s.ws.readyState === WebSocket.OPEN);
    sfDuelists = openDuelists;

    if (sfDuelists.length >= 2) {
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
      send(session.ws, buildStateFor(session));
      send(session.ws, makeSoloFightHud(sfState));
      send(session.ws, { type: 'error', message: 'Solo Fight is full — spectating' });
      broadcastRoomInfo();
      return;
    }

    session.room = 'soloFight';
    session.lobbyOnly = false;
    session.spectating = false;
    const st = soloFightEngine.getState();
    const spawns = soloFightSpawnPoints(st.worldWidth, st.worldHeight);
    const slot = sfDuelists.length; // 0 or 1

    if (slot === 0) {
      const player = soloFightEngine.addPlayer(name, false, {
        x: spawns[0].x,
        y: spawns[0].y,
        skin: skin || undefined,
      });
      soloFightEngine.setPlayerFrozen(player.id, true);
      session.playerIds = [player.id];
      session.activeIndex = 0;
      session.joined = true;
      session.lastColor = player.color;
      sfDuelists = [session];
      sfState.phase = 'waiting';
      sfState.countdownEndsAt = 0;
      sfState.betweenEndsAt = 0;
      sfState.names = [name];
      sfState.fighterPlayerIds = [player.id];
      // Keep scores if rematch same names; clear if fresh room was emptied
      refreshAdmin(session);
      sendWelcome(session, player.id, soloFightEngine, session.isAdmin);
      send(session.ws, { type: 'settings', settings: soloFightConfig, mode: 'soloFight' });
      send(session.ws, makeSoloFightHud(sfState));
      broadcastRoomInfo();
      return;
    }

    // Second fighter → countdown
    const player = soloFightEngine.addPlayer(name, false, {
      x: spawns[1].x,
      y: spawns[1].y,
      skin: skin || undefined,
    });
    soloFightEngine.setPlayerFrozen(player.id, true);
    session.playerIds = [player.id];
    session.activeIndex = 0;
    session.joined = true;
    session.lastColor = player.color;
    sfDuelists.push(session);

    // Freeze both, set names
    freezeSfFighters(true);
    sfState.names = sfDuelists.map((s) => s.lastName);
    // Ensure first name is current
    sfState.names[sfDuelists.length - 1] = name;
    sfState.names = [sfDuelists[0].lastName, name];
    sfState.fighterPlayerIds = sfDuelists.flatMap((s) => s.playerIds);
    sfState.phase = 'countdown';
    sfState.countdownEndsAt = Date.now() + SOLO_FIGHT_COUNTDOWN_MS;
    sfState.betweenEndsAt = 0;

    refreshAdmin(session);
    sendWelcome(session, player.id, soloFightEngine, session.isAdmin);
    if (session.isAdmin) {
      console.log(`[agar-server] admin online (soloFight): ${session.lastName}`);
    }
    send(session.ws, { type: 'settings', settings: soloFightConfig, mode: 'soloFight' });
    send(session.ws, makeSoloFightHud(sfState));
    broadcastRoomInfo();
  }

  function restartTickLoop() {
    if (tickTimer) clearInterval(tickTimer);
    let roomInfoAcc = 0;
    tickTimer = setInterval(() => {
      if (!listening) return;
      classicEngine.update();
      soloFightEngine.update();
      tickSoloFightPhases();

      for (const [ws, session] of clients) {
        if (ws.readyState !== WebSocket.OPEN) continue;

        const engine = engineFor(session.room);

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
            // Solo Fight scoring before clearing join state
            if (session.room === 'soloFight') {
              handleSoloFightDeath(session);
            }
            send(ws, { type: 'died' });
            session.joined = false;
            session.activeIndex = 0;
            if (session.room === 'soloFight' && !session.lobbyOnly) {
              send(ws, makeSoloFightHud(sfState));
            }
            continue;
          }
        }

        // Menu lobby watchers: roomInfo only (no game snapshots)
        if (session.lobbyOnly) continue;
        send(ws, buildStateFor(session));
        if (session.room === 'soloFight') {
          send(ws, makeSoloFightHud(sfState));
        }
      }

      roomInfoAcc += getTickMs();
      // Throttle roomInfo (~2s) — lobby UI does not need 1 Hz
      if (roomInfoAcc >= 2000) {
        roomInfoAcc = 0;
        broadcastRoomInfo();
      }
    }, getTickMs());
  }

  wss.on('listening', () => {
    listening = true;
    const c = classicEngine.getState();
    const s = soloFightEngine.getState();
    console.log(`[agar-server] listening on 0.0.0.0:${PORT} (ws://127.0.0.1:${PORT})`);
    console.log(`[agar-server] behind nginx: proxy /ws → this port (clients use wss://YOUR_DOMAIN/ws)`);
    console.log(`[agar-server] PORT env: ${process.env.PORT || '(default ' + DEFAULT_SERVER_PORT + ')'}`);
    console.log(`[agar-server] ADMIN nicknames: салруз / salruz (pass required; Q, 1=TP, 2=reset, 3=virus, 4=merge, 5=kick, 6=bot)`);
    console.log(`[agar-server] classic ${c.worldWidth}×${c.worldHeight}, soloFight ${s.worldWidth}×${s.worldHeight}`);
  });

  wss.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      wss.close();
      if (attempt === 0) {
        const freed = tryFreePort(PORT);
        if (freed) {
          console.log('[agar-server] Повторный запуск после освобождения порта…');
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
      // Default: treat as lobby watcher until join/spectate — avoids sending full state to bare sockets
      lobbyOnly: true,
      spectating: false,
      room: 'classic',
      viewX: classicConfig.worldWidth / 2,
      viewY: classicConfig.worldHeight / 2,
      lastChatAt: 0,
      lastName: 'Player',
      lastColor: '#4ECDC4',
      lastSkin: '',
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

      const engine = () => engineFor(session.room);
      const cfg = () => configFor(session.room);

      switch (msg.type) {
        case 'adminIdentify': {
          session.lastName = String(msg.name || '').trim().slice(0, 15) || session.lastName;
          if (isAdminName(session.lastName)) {
            session.adminAuthed = checkAdminPassword((msg as { password?: string }).password);
            if (!session.adminAuthed) {
              send(ws, { type: 'error', message: 'Неверный пароль для salruz' });
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
          if (session.room === 'soloFight' && sfDuelists.includes(session)) {
            handleSoloFightLeave(session);
          }
          clearSessionPlayers(session, engine());
          session.room = mode;
          session.lobbyOnly = true;
          session.spectating = false;
          session.joined = false;
          const st = engineFor(mode).getState();
          session.viewX = st.worldWidth / 2;
          session.viewY = st.worldHeight / 2;
          send(ws, getRoomInfo(mode));
          break;
        }
        case 'spectate': {
          const mode = parseMode(msg.mode);
          if (session.room === 'soloFight' && sfDuelists.includes(session)) {
            handleSoloFightLeave(session);
          }
          clearSessionPlayers(session, engine());
          session.room = mode;
          session.lobbyOnly = false;
          session.spectating = true;
          session.joined = false;
          const eng = engineFor(mode);
          const st = eng.getState();
          session.viewX = st.worldWidth / 2;
          session.viewY = st.worldHeight / 2;
          send(ws, {
            type: 'welcome',
            id: `spec-${Date.now().toString(36)}`,
            world: { w: st.worldWidth, h: st.worldHeight },
            isAdmin: false,
          });
          send(ws, { type: 'settings', settings: configFor(mode), mode });
          send(ws, buildStateFor(session));
          if (mode === 'soloFight') {
            send(ws, makeSoloFightHud(sfState));
          }
          broadcastRoomInfo();
          break;
        }
        case 'join': {
          const mode = parseMode(msg.mode);
          if (session.room === 'soloFight' && sfDuelists.includes(session)) {
            handleSoloFightLeave(session);
          }
          clearSessionPlayers(session, engine());
          session.room = mode;
          session.lobbyOnly = false;
          session.spectating = false;
          const name = (msg.name || session.lastName || 'Player').trim().slice(0, 15) || 'Player';
          if (isAdminName(name)) {
            session.adminAuthed = checkAdminPassword(msg.password);
            if (!session.adminAuthed) {
              send(ws, { type: 'error', message: 'Неверный пароль для salruz' });
              break;
            }
          } else {
            session.adminAuthed = false;
          }
          session.lastName = name;
          const skin = sanitizeSkinId((msg as { skin?: string }).skin) || session.lastSkin;
          session.lastSkin = skin;

          if (mode === 'soloFight') {
            joinSoloFight(session, name, skin);
            break;
          }

          const player = classicEngine.addPlayer(name, false, { skin: skin || undefined });
          session.playerIds = [player.id];
          session.activeIndex = 0;
          session.joined = true;
          session.lastColor = player.color;
          refreshAdmin(session);
          sendWelcome(session, player.id, classicEngine, session.isAdmin);
          if (session.isAdmin) {
            console.log(`[agar-server] admin online: ${session.lastName}`);
          }
          send(ws, { type: 'settings', settings: classicConfig, mode: 'classic' });
          broadcastRoomInfo();
          break;
        }
        case 'adminAuth': {
          // Nickname + password based admin; keep message for client handshake
          refreshAdmin(session);
          send(ws, { type: 'adminStatus', ok: session.isAdmin });
          break;
        }
        case 'adminGetSettings': {
          refreshAdmin(session);
          if (!session.isAdmin) return;
          const mode = parseMode(msg.mode);
          send(ws, { type: 'settings', settings: configFor(mode), mode });
          break;
        }
        case 'adminUpdateSettings': {
          refreshAdmin(session);
          if (!session.isAdmin) return;
          const mode = parseMode(msg.mode);
          const next = sanitizeGameplayConfig(msg.settings);
          const prevClassicTick = classicConfig.serverTickHz;
          const prevSfTick = soloFightConfig.serverTickHz;
          if (mode === 'soloFight') {
            soloFightConfig = next;
            syncWorldAndPopulation(soloFightEngine, soloFightConfig);
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
          } else {
            classicConfig = next;
            syncWorldAndPopulation(classicEngine, classicConfig);
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
          }
          if (
            classicConfig.serverTickHz !== prevClassicTick ||
            soloFightConfig.serverTickHz !== prevSfTick
          ) {
            restartTickLoop();
          }
          break;
        }
        case 'adminAddMass': {
          refreshAdmin(session);
          const pid = activePlayerId(session);
          if (!session.isAdmin || !pid) return;
          const amount = Math.max(1, Math.min(5000, Number(msg.amount) || cfg().adminMassBoost));
          engine().addMass(pid, amount);
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
          const pid = activePlayerId(session);
          if (!session.isAdmin || !pid) return;
          engine().teleportPlayer(pid, Number(msg.x) || 0, Number(msg.y) || 0);
          break;
        }
        case 'adminForceMerge': {
          refreshAdmin(session);
          const pid = activePlayerId(session);
          if (!session.isAdmin || !pid) return;
          engine().forceMergePlayer(pid);
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
          if (session.room === 'soloFight') return;
          const mass = Math.max(10, Math.min(50000, Number(msg.mass) || 500));
          engine().spawnBotAt(Number(msg.x) || 0, Number(msg.y) || 0, mass);
          break;
        }
        case 'resetStarter': {
          refreshAdmin(session);
          const pid = activePlayerId(session);
          if (!session.isAdmin || !pid) return;
          engine().resetToStarter(pid);
          break;
        }
        case 'rename': {
          if (session.playerIds.length === 0) return;
          const name = String(msg.name || '').trim().slice(0, 15);
          if (!name) return;
          if (isAdminName(name)) {
            session.adminAuthed = checkAdminPassword(msg.password);
            if (!session.adminAuthed) {
              send(ws, { type: 'error', message: 'Неверный пароль для salruz' });
              send(ws, { type: 'adminStatus', ok: false });
              break;
            }
          } else {
            session.adminAuthed = false;
          }
          session.lastName = name;
          const skin = sanitizeSkinId((msg as { skin?: string }).skin);
          if (skin || (msg as { skin?: string }).skin === '') {
            session.lastSkin = skin;
          }
          for (const id of session.playerIds) {
            engine().updatePlayerName(id, name);
            if ((msg as { skin?: string }).skin !== undefined) {
              engine().updatePlayerSkin(id, session.lastSkin || undefined);
            }
          }
          if (session.room === 'soloFight' && sfDuelists.includes(session)) {
            syncSfMetaFromDuelists();
          }
          refreshAdmin(session);
          send(ws, { type: 'adminStatus', ok: session.isAdmin });
          break;
        }
        case 'multiboxSpawn': {
          if (session.room === 'soloFight') return;
          if (!session.joined || session.playerIds.length === 0) return;
          if (session.playerIds.length >= 2) return;
          const primaryId = activePlayerId(session);
          const primary = primaryId
            ? engine().getState().players.find((p) => p.id === primaryId)
            : undefined;
          if (!primary || primary.cells.length === 0) return;
          const box = engine().addPlayer(primary.name, false, {
            color: primary.color,
            skin: primary.skin || session.lastSkin || undefined,
          });
          session.playerIds.push(box.id);
          session.activeIndex = session.playerIds.length - 1;
          session.lastColor = box.color;
          break;
        }
        case 'multiboxSwitch': {
          if (!session.joined || session.playerIds.length < 2) return;
          const state = engine().getState();
          const n = session.playerIds.length;
          for (let step = 1; step <= n; step++) {
            const next = (session.activeIndex + step) % n;
            const id = session.playerIds[next];
            const p = state.players.find((x) => x.id === id);
            if (p && p.cells.length > 0) {
              session.activeIndex = next;
              break;
            }
          }
          break;
        }
        case 'chat': {
          // Works after death too (connection kept; lastName/color remembered)
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
          broadcast({ type: 'chat', name, text, t: now, color });
          break;
        }
        case 'input': {
          const mx = Number(msg.mx);
          const my = Number(msg.my);
          if (Number.isFinite(mx) && Number.isFinite(my)) {
            session.viewX = mx;
            session.viewY = my;
          }
          const pid = activePlayerId(session);
          if (!pid) return;
          engine().updatePlayerTarget(pid, mx, my);
          break;
        }
        case 'split': {
          const pid = activePlayerId(session);
          if (!pid) return;
          engine().splitPlayer(pid);
          break;
        }
        case 'eject': {
          const pid = activePlayerId(session);
          if (!pid) return;
          engine().ejectMass(pid);
          break;
        }
        case 'freeze': {
          const pid = activePlayerId(session);
          if (!pid) return;
          // Solo Fight: ignore client freeze toggle during waiting/countdown (server re-freezes)
          if (
            session.room === 'soloFight' &&
            (sfState.phase === 'waiting' || sfState.phase === 'countdown')
          ) {
            engine().setPlayerFrozen(pid, true);
            return;
          }
          const player = engine().getState().players.find((p) => p.id === pid);
          if (!player) return;
          const next = typeof msg.frozen === 'boolean' ? msg.frozen : !player.frozen;
          engine().setPlayerFrozen(pid, next);
          break;
        }
        case 'ping': {
          send(ws, { type: 'pong', t: msg.t });
          break;
        }
        default:
          send(ws, { type: 'error', message: 'Unknown message type' });
      }
    });

    ws.on('close', () => {
      if (session.room === 'soloFight' && sfDuelists.includes(session)) {
        handleSoloFightLeave(session);
      }
      clearSessionPlayers(session, engineFor(session.room));
      clients.delete(ws);
      broadcastRoomInfo();
    });

    ws.on('error', () => {
      if (session.room === 'soloFight' && sfDuelists.includes(session)) {
        handleSoloFightLeave(session);
      }
      clearSessionPlayers(session, engineFor(session.room));
      clients.delete(ws);
      broadcastRoomInfo();
    });
  });

  restartTickLoop();

  const shutdown = () => {
    if (tickTimer) clearInterval(tickTimer);
    wss.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startServer();
