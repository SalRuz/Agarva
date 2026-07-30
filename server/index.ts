import { WebSocketServer, WebSocket } from 'ws';
import { execSync } from 'node:child_process';
import { GameEngine } from '../shared/GameEngine';
import { defaultGameplayConfig, sanitizeGameplayConfig, type GameplayConfig } from '../shared/gameConfig';
import {
  DEFAULT_SERVER_PORT,
  CHAT_MAX_LENGTH,
  CHAT_RATE_LIMIT_MS,
} from '../shared/constants';
import { getPlayerCenter, distance, isAdminName, createFood } from '../shared/physics';
import { getEntityViewRadius, isWithinViewRadius } from '../shared/sectors';
import type { ClientMessage, ServerMessage, NetPlayer, StateMessage } from '../shared/protocol';
import type { Player } from '../shared/types';

const PORT = Number(process.env.PORT) || DEFAULT_SERVER_PORT;

interface ClientSession {
  ws: WebSocket;
  playerId: string | null;
  joined: boolean;
  isAdmin: boolean;
  lastChatAt: number;
  lastName: string;
  lastColor: string;
}

function refreshAdmin(session: ClientSession) {
  session.isAdmin = isAdminName(session.lastName);
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
  let runtimeConfig: GameplayConfig = sanitizeGameplayConfig(defaultGameplayConfig);
  const engine = new GameEngine({
    botCount: runtimeConfig.botCountMp,
    foodCount: runtimeConfig.foodCountMp,
    multiplayer: true,
    config: runtimeConfig,
  });

  const clients = new Map<WebSocket, ClientSession>();

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

  function toNetPlayer(p: Player, cellFilter?: (c: Player['cells'][0]) => boolean): NetPlayer {
    const cells = cellFilter ? p.cells.filter(cellFilter) : p.cells;
    return {
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
    };
  }

  function buildStateFor(playerId: string | null): StateMessage {
    const state = engine.getState();
    const ww = state.worldWidth;
    const wh = state.worldHeight;
    const youPlayer = playerId ? state.players.find((p) => p.id === playerId) : undefined;
    const center =
      youPlayer && youPlayer.cells.length > 0
        ? getPlayerCenter(youPlayer)
        : { x: ww / 2, y: wh / 2 };

    const viewR = getEntityViewRadius(ww, wh);
    const inView = (x: number, y: number) => isWithinViewRadius(x, y, center.x, center.y, viewR);

    const food = state.food
      .filter((f) => inView(f.x, f.y))
      .sort((a, b) => distance(center, a) - distance(center, b))
      .slice(0, runtimeConfig.foodNetMax)
      .map((f) => ({
        id: f.id,
        x: Math.round(f.x),
        y: Math.round(f.y),
        c: f.color,
      }));

    const viruses = state.viruses
      .filter((v) => inView(v.x, v.y))
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
      .map((e) => ({
        id: e.id,
        x: Math.round(e.x * 10) / 10,
        y: Math.round(e.y * 10) / 10,
        r: Math.round(e.radius * 10) / 10,
        c: e.color,
      }));

    const players = state.players
      .filter((p) => p.cells.length > 0 && p.id !== playerId)
      .map((p) => toNetPlayer(p, (c) => inView(c.x, c.y)))
      .filter((p) => p.cells.length > 0);

    return {
      type: 'state',
      t: Date.now(),
      you: youPlayer && youPlayer.cells.length > 0 ? toNetPlayer(youPlayer) : null,
      players,
      food,
      viruses,
      ejected,
      leaderboard: engine.getLeaderboard(),
    };
  }

  // Try to free leftover node listener once before bind
  if (attempt === 0) {
    tryFreePort(PORT);
  }

  const wss = new WebSocketServer({ host: '0.0.0.0', port: PORT });

  let listening = false;
  let tickTimer: ReturnType<typeof setInterval> | null = null;
  const getTickMs = () => 1000 / Math.max(1, runtimeConfig.serverTickHz);

  function syncWorldAndPopulation(config: GameplayConfig) {
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

  function restartTickLoop() {
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = setInterval(() => {
      if (!listening) return;
      engine.update();

      for (const [ws, session] of clients) {
        if (ws.readyState !== WebSocket.OPEN) continue;

        if (session.playerId) {
          const player = engine.getState().players.find((p) => p.id === session.playerId);
          if (player && player.cells.length === 0) {
            if (player.name) session.lastName = player.name;
            if (player.color) session.lastColor = player.color;
            send(ws, { type: 'died' });
            engine.removePlayer(session.playerId);
            session.playerId = null;
            session.joined = false;
            continue;
          }
        }

        send(ws, buildStateFor(session.playerId));
      }
    }, getTickMs());
  }

  wss.on('listening', () => {
    listening = true;
    console.log(`[agar-server] listening on 0.0.0.0:${PORT} (ws://127.0.0.1:${PORT})`);
    console.log(`[agar-server] behind nginx: proxy /ws → this port (clients use wss://YOUR_DOMAIN/ws)`);
    console.log(`[agar-server] PORT env: ${process.env.PORT || '(default ' + DEFAULT_SERVER_PORT + ')'}`);
    console.log(`[agar-server] ADMIN nicknames: салруз / salruz (Q, 1=minimap TP, 3)`);
    console.log(`[agar-server] world ${engine.getState().worldWidth}×${engine.getState().worldHeight} (FOV radius follows player)`);
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
      playerId: null,
      joined: false,
      isAdmin: false,
      lastChatAt: 0,
      lastName: 'Player',
      lastColor: '#4ECDC4',
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

      switch (msg.type) {
        case 'adminIdentify': {
          session.lastName = String(msg.name || '').trim().slice(0, 15) || session.lastName;
          refreshAdmin(session);
          send(ws, { type: 'adminStatus', ok: session.isAdmin });
          break;
        }
        case 'join': {
          // Allow rejoin/respawn on same connection after death
          if (session.joined && session.playerId) {
            engine.removePlayer(session.playerId);
          }
          const name = (msg.name || session.lastName || 'Player').trim().slice(0, 15) || 'Player';
          session.lastName = name;
          const player = engine.addPlayer(name, false);
          session.playerId = player.id;
          session.joined = true;
          session.lastColor = player.color;
          refreshAdmin(session);
          send(ws, {
            type: 'welcome',
            id: player.id,
            world: {
              w: engine.getState().worldWidth,
              h: engine.getState().worldHeight,
            },
            isAdmin: session.isAdmin,
          });
          if (session.isAdmin) {
            console.log(`[agar-server] admin online: ${session.lastName}`);
          }
          send(ws, { type: 'settings', settings: runtimeConfig });
          break;
        }
        case 'adminAuth': {
          // Nickname-based admin; keep message for client handshake
          refreshAdmin(session);
          send(ws, { type: 'adminStatus', ok: session.isAdmin });
          break;
        }
        case 'adminGetSettings': {
          refreshAdmin(session);
          if (!session.isAdmin) return;
          send(ws, { type: 'settings', settings: runtimeConfig });
          break;
        }
        case 'adminUpdateSettings': {
          refreshAdmin(session);
          if (!session.isAdmin) return;
          const next = sanitizeGameplayConfig(msg.settings);
          const prevTick = runtimeConfig.serverTickHz;
          runtimeConfig = next;
          syncWorldAndPopulation(runtimeConfig);
          broadcast({ type: 'settings', settings: runtimeConfig });
          broadcast({ type: 'world', w: runtimeConfig.worldWidth, h: runtimeConfig.worldHeight });
          if (runtimeConfig.serverTickHz !== prevTick) {
            restartTickLoop();
          }
          break;
        }
        case 'adminAddMass': {
          refreshAdmin(session);
          if (!session.isAdmin || !session.playerId) return;
          const amount = Math.max(1, Math.min(5000, Number(msg.amount) || runtimeConfig.adminMassBoost));
          engine.addMass(session.playerId, amount);
          break;
        }
        case 'adminSpawnVirus': {
          refreshAdmin(session);
          if (!session.isAdmin) return;
          engine.spawnVirusAt(Number(msg.x) || 0, Number(msg.y) || 0);
          break;
        }
        case 'adminTeleport': {
          refreshAdmin(session);
          if (!session.isAdmin || !session.playerId) return;
          engine.teleportPlayer(
            session.playerId,
            Number(msg.x) || 0,
            Number(msg.y) || 0
          );
          break;
        }
        case 'resetStarter': {
          if (!session.playerId) return;
          engine.resetToStarter(session.playerId);
          break;
        }
        case 'rename': {
          if (!session.playerId) return;
          const name = String(msg.name || '').trim().slice(0, 15);
          if (!name) return;
          session.lastName = name;
          engine.updatePlayerName(session.playerId, name);
          refreshAdmin(session);
          send(ws, { type: 'adminStatus', ok: session.isAdmin });
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
          const live = session.playerId
            ? engine.getState().players.find((p) => p.id === session.playerId)
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
          if (!session.playerId) return;
          engine.updatePlayerTarget(session.playerId, msg.mx, msg.my);
          break;
        }
        case 'split': {
          if (!session.playerId) return;
          engine.splitPlayer(session.playerId);
          break;
        }
        case 'eject': {
          if (!session.playerId) return;
          engine.ejectMass(session.playerId);
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
      if (session.playerId) {
        engine.removePlayer(session.playerId);
      }
      clients.delete(ws);
    });

    ws.on('error', () => {
      if (session.playerId) {
        engine.removePlayer(session.playerId);
      }
      clients.delete(ws);
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
