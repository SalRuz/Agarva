import type { GameState, Player, Cell, Food, Virus, EjectedMass } from '../../shared/types';
import type {
  ClientMessage,
  ServerMessage,
  StateMessage,
  NetPlayer,
  ChatBroadcastMessage,
  LeaderboardEntry,
} from '../../shared/protocol';
import { getFoodRadius, WORLD_WIDTH, WORLD_HEIGHT } from '../../shared/physics';
import { ADMIN_TOKEN, DEFAULT_WS_URL, WS_PATH } from '../../shared/constants';
import type { GameplayConfig } from '../../shared/gameConfig';
import { defaultGameplayConfig, sanitizeGameplayConfig } from '../../shared/gameConfig';
import { isAdminName } from '../../shared/physics';

export type MultiplayerStatus = 'connecting' | 'connected' | 'disconnected' | 'error' | 'died';

export interface MultiplayerCallbacks {
  onWelcome?: (id: string, world: { w: number; h: number }, isAdmin?: boolean) => void;
  onState?: (
    state: GameState,
    you: Player | undefined,
    leaderboard: LeaderboardEntry[],
    ownedIds?: string[]
  ) => void;
  onDied?: () => void;
  onError?: (message: string) => void;
  onStatus?: (status: MultiplayerStatus) => void;
  onWorld?: (w: number, h: number) => void;
  onAdminStatus?: (ok: boolean) => void;
  onChat?: (msg: ChatBroadcastMessage) => void;
  onSettings?: (settings: GameplayConfig, mode?: 'classic' | 'soloFight' | 'duoFight' | 'trioFight') => void;
  onSoloFightHud?: (hud: {
    phase: 'waiting' | 'countdown' | 'fighting' | 'between' | 'ended' | 'resetting';
    countdown: number;
    fightSecondsLeft?: number;
    a: { name: string; score: number };
    b: { name: string; score: number };
  }) => void;
  onSoloFightTop?: (entries: { name: string; score: number }[]) => void;
  onTeamFightHud?: (hud: { mode: 'duoFight' | 'trioFight'; phase: 'waiting' | 'countdown' | 'fighting' | 'between' | 'ended' | 'resetting'; countdown: number; fightSecondsLeft?: number; blue: { alive: number; total: number; members: string[]; streaks: Record<string, number> }; red: { alive: number; total: number; members: string[]; streaks: Record<string, number> } }) => void;
  onTeamFightTop?: (mode: 'soloFight' | 'duoFight' | 'trioFight', entries: { name: string; score: number }[]) => void;
  onRoomInfo?: (info: { mode?: 'classic' | 'soloFight' | 'duoFight' | 'trioFight'; players: number; spectators: number; blue?: number; red?: number }) => void;
  onLobbySnapshot?: (rooms: Record<'classic' | 'soloFight' | 'duoFight' | 'trioFight', {
    players: number; spectators: number; blue?: number; red?: number; blueMembers?: string[]; redMembers?: string[];
  }>) => void;
  onPlayerProfile?: (profile: {
    deviceId: string;
    lastNick?: string;
    skinId?: string;
    prefs?: Record<string, unknown>;
    accountLogin?: string;
  }) => void;
  onRegisterAccountResult?: (ok: boolean, message: string, accountLogin?: string) => void;
  onLoginAccountResult?: (ok: boolean, message: string, accountLogin?: string) => void;
  onPasswordResetResult?: (action: 'request' | 'confirm', ok: boolean, message: string) => void;
  onAdminDbExport?: (json: string) => void;
  onAdminDbResult?: (ok: boolean, message: string) => void;
  onAdminBotLogs?: (text: string) => void;
}

interface Snap {
  localT: number;
  state: GameState;
  you: Player | undefined;
  leaderboard: LeaderboardEntry[];
  ownedIds: string[];
}

function netPlayerToPlayer(np: NetPlayer, skinCache: Map<string, string>): Player {
  const cells: Cell[] = np.cells.map((c) => ({
    id: c.id,
    x: c.x,
    y: c.y,
    radius: c.r,
    visualRadius: c.r,
    targetRadius: c.r,
    color: c.c,
    velocityX: 0,
    velocityY: 0,
    splitDirX: 0,
    splitDirY: 0,
    splitMaxSpeed: 0,
  }));

  if (np.skin !== undefined) {
    if (np.skin) skinCache.set(np.id, np.skin);
    else skinCache.delete(np.id);
  }
  const skin = np.skin !== undefined ? np.skin || undefined : skinCache.get(np.id);

  return {
    id: np.id,
    name: np.name,
    cells,
    color: np.color,
    score: np.score,
    isBot: false,
    targetX: cells[0]?.x ?? 0,
    targetY: cells[0]?.y ?? 0,
    lastSplit: 0,
    lastEject: 0,
    frozen: np.fr === 1,
    skin,
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpPlayers(from: GameState, to: GameState, t: number): Player[] {
  const fromMap = new Map(from.players.map((p) => [p.id, p]));
  return to.players.map((tp) => {
    const fp = fromMap.get(tp.id);
    const fromCells = fp ? new Map(fp.cells.map((c) => [c.id, c])) : null;
    const cells = tp.cells.map((tc) => {
      const fc = fromCells?.get(tc.id);
      const x = fc ? lerp(fc.x, tc.x, t) : tc.x;
      const y = fc ? lerp(fc.y, tc.y, t) : tc.y;
      const radius = fc ? lerp(fc.radius, tc.radius, t) : tc.radius;
      const visualRadius = fc?.visualRadius ?? radius;
      return {
        ...tc,
        x,
        y,
        radius,
        targetRadius: tc.radius,
        visualRadius,
      };
    });
    return {
      ...tp,
      cells,
      frozen: tp.frozen ?? fp?.frozen,
      skin: tp.skin ?? fp?.skin,
      targetX: cells[0]?.x ?? tp.targetX,
      targetY: cells[0]?.y ?? tp.targetY,
    };
  });
}

function lerpById<T extends { id: string; x: number; y: number }>(
  fromList: T[],
  toList: T[],
  t: number,
  merge: (f: T | undefined, cur: T, x: number, y: number) => T,
  keepMissingWhileInterpolating = false
): T[] {
  const fromMap = new Map(fromList.map((e) => [e.id, e]));
  const result = toList.map((cur) => {
    const prev = fromMap.get(cur.id);
    if (!prev) return merge(undefined, cur, cur.x, cur.y);
    return merge(prev, cur, lerp(prev.x, cur.x, t), lerp(prev.y, cur.y, t));
  });
  // A capped snapshot can omit an object for one tick even while it exists.
  // Keep it only during the interpolation interval, never indefinitely.
  if (keepMissingWhileInterpolating && t < 1) {
    const currentIds = new Set(toList.map((e) => e.id));
    for (const prev of fromList) {
      if (!currentIds.has(prev.id)) result.push(prev);
    }
  }
  return result;
}

function interpolateStates(from: Snap, to: Snap, t: number): { state: GameState; you: Player | undefined } {
  const players = lerpPlayers(from.state, to.state, t);
  const food = lerpById(from.state.food, to.state.food, t, (_f, cur, x, y) => ({ ...cur, x, y }));
  const viruses = lerpById(
    from.state.viruses,
    to.state.viruses,
    t,
    (f, cur, x, y) => ({
      ...cur,
      x,
      y,
      radius: f ? lerp(f.radius, cur.radius, t) : cur.radius,
    })
  );
  const ejectedMass = lerpById(from.state.ejectedMass, to.state.ejectedMass, t, (f, cur, x, y) => ({
    ...cur,
    x,
    y,
    radius: f ? lerp(f.radius, cur.radius, t) : cur.radius,
  }));

  const state: GameState = {
    players,
    food,
    viruses,
    ejectedMass,
    worldWidth: to.state.worldWidth,
    worldHeight: to.state.worldHeight,
  };

  const youId = to.you?.id;
  const you = youId ? players.find((p) => p.id === youId) : undefined;
  return { state, you };
}

/** Same-origin WS URL for nginx/Vite proxy at `/ws` (WSS when page is HTTPS). */
export function sameOriginWsUrl(path: string = WS_PATH): string {
  if (typeof window === 'undefined' || !window.location?.host) {
    return DEFAULT_WS_URL;
  }
  const { protocol, host } = window.location;
  if (protocol === 'file:') return DEFAULT_WS_URL;
  const wsProto = protocol === 'https:' ? 'wss:' : 'ws:';
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${wsProto}//${host}${normalized}`;
}

/**
 * Resolve multiplayer WS URL:
 * 1) explicit override
 * 2) localStorage.agarServerUrl
 * 3) build-time VITE_WS_URL
 * 4) production / non-localhost page → same-origin `/ws`
 * 5) DEFAULT_WS_URL (local Node on :3001)
 */
export function resolveServerUrl(override?: string): string {
  if (override?.trim()) return override.trim();
  try {
    const stored = localStorage.getItem('agarServerUrl');
    if (stored?.trim()) return stored.trim();
  } catch {
    // ignore
  }

  const fromEnv = import.meta.env.VITE_WS_URL;
  if (typeof fromEnv === 'string' && fromEnv.trim()) {
    return fromEnv.trim();
  }

  if (typeof window !== 'undefined' && window.location?.host) {
    const { protocol, hostname } = window.location;
    const isLocalHost =
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '[::1]';
    // Production build or any non-local page: use same-origin /ws (nginx / Vite proxy)
    if (import.meta.env.PROD || (!isLocalHost && protocol !== 'file:')) {
      return sameOriginWsUrl();
    }
  }

  return DEFAULT_WS_URL;
}

export function resolveAdminToken(): string {
  try {
    const stored = localStorage.getItem('agarAdminToken');
    if (stored?.trim()) return stored.trim();
  } catch {
    // ignore
  }
  return ADMIN_TOKEN;
}

export class MultiplayerClient {
  /** A single capped packet omission must not make an entity visibly disappear. */
  private static readonly ENTITY_MISSING_GRACE_MS = 550;
  private ws: WebSocket | null = null;
  private callbacks: MultiplayerCallbacks;
  private playerId: string | null = null;
  private name: string;
  private password: string | undefined;
  private skin: string | undefined;
  private snapPrev: Snap | null = null;
  private snapCurr: Snap | null = null;
  private worldW = WORLD_WIDTH;
  private worldH = WORLD_HEIGHT;
  private isAdmin = false;
  private lastPingMs: number | null = null;
  /** Render one snapshot behind latest data; leaves enough history for smooth motion. */
  private interpDelayMs = 90;
  private config: GameplayConfig = defaultGameplayConfig;
  private lastInputSentAt = 0;
  private lastInputMx = Number.NaN;
  private lastInputMy = Number.NaN;
  /** Cap upload: ~tick rate, skip tiny cursor jitter */
  private static readonly INPUT_MIN_INTERVAL_MS = 33;
  private static readonly INPUT_MIN_DELTA = 2;
  private spectateOnly = false;
  private ownedIds: string[] = [];
  private deviceId = '';
  private fingerprint = '';
  private roomMode: 'classic' | 'soloFight' | 'duoFight' | 'trioFight' = 'classic';
  private roomTeam: 'blue' | 'red' | undefined;
  /** Retain skins when server omits unchanged skin fields */
  private skinCache = new Map<string, string>();
  private lastLeaderboard: LeaderboardEntry[] = [];
  private foodSeenAt = new Map<string, number>();
  private virusSeenAt = new Map<string, number>();
  private ejectSeenAt = new Map<string, number>();

  constructor(name: string, callbacks: MultiplayerCallbacks = {}, password?: string, skin?: string) {
    this.name = name;
    this.callbacks = callbacks;
    this.password = password;
    this.skin = skin;
  }

  setDeviceIdentity(deviceId: string, fingerprint: string) {
    this.deviceId = deviceId;
    this.fingerprint = fingerprint;
  }

  setRoomMode(mode: 'classic' | 'soloFight' | 'duoFight' | 'trioFight') {
    this.roomMode = mode;
  }

  setRoomTeam(team: 'blue' | 'red' | undefined) {
    this.roomTeam = team;
  }

  getRoomMode() {
    return this.roomMode;
  }

  setPassword(password: string | undefined) {
    this.password = password;
  }

  setSkin(skin: string | null | undefined) {
    this.skin = skin || undefined;
  }

  getOwnedIds() {
    return this.ownedIds;
  }

  /** A room/welcome boundary must never interpolate entities from the prior session. */
  private clearSnapshotState() {
    this.snapPrev = null;
    this.snapCurr = null;
    this.ownedIds = [];
    this.foodSeenAt.clear();
    this.virusSeenAt.clear();
    this.ejectSeenAt.clear();
  }

  private joinPayload(name = this.name) {
    const msg: {
      type: 'join';
      name: string;
      password?: string;
      skin?: string;
      mode: 'classic' | 'soloFight' | 'duoFight' | 'trioFight';
      team?: 'blue' | 'red';
      deviceId?: string;
      fingerprint?: string;
    } = {
      type: 'join',
      name,
      mode: this.roomMode,
    };
    if (this.roomTeam) msg.team = this.roomTeam;
    if (isAdminName(name) && this.password) msg.password = this.password;
    if (this.skin) msg.skin = this.skin;
    if (this.deviceId) msg.deviceId = this.deviceId;
    if (this.fingerprint) msg.fingerprint = this.fingerprint;
    return msg;
  }

  getPlayerId() {
    return this.playerId;
  }

  getIsAdmin() {
    return this.isAdmin;
  }

  getWorldSize() {
    return { w: this.worldW, h: this.worldH };
  }

  getPingMs() {
    return this.lastPingMs;
  }

  isSpectateOnly() {
    return this.spectateOnly;
  }

  /**
   * Smooth state for rendering (call every frame).
   * Render slightly behind the latest snapshot, then extrapolate only a short tail.
   */
  getRenderState(): { state: GameState; you: Player | undefined } | null {
    if (!this.snapCurr) return null;
    if (!this.snapPrev) {
      return { state: this.snapCurr.state, you: this.snapCurr.you };
    }

    const span = Math.max(1, this.snapCurr.localT - this.snapPrev.localT);
    const renderT = performance.now() - this.interpDelayMs;
    let alpha = (renderT - this.snapPrev.localT) / span;
    if (alpha < 0) alpha = 0;
    // A short tail covers normal packet jitter without holding a stale pose.
    if (alpha > 1.25) alpha = 1.25;

    return interpolateStates(this.snapPrev, this.snapCurr, alpha);
  }

  connect(url: string, opts?: { spectate?: boolean; mode?: 'classic' | 'soloFight' | 'duoFight' | 'trioFight'; team?: 'blue' | 'red' }) {
    this.spectateOnly = !!opts?.spectate;
    if (opts?.mode) this.roomMode = opts.mode;
    if (opts?.team) this.roomTeam = opts.team;
    this.skinCache.clear();
    this.lastLeaderboard = [];
    this.callbacks.onStatus?.('connecting');
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.callbacks.onStatus?.('connected');
      this.send({ type: 'adminAuth', token: resolveAdminToken() });
      if (this.spectateOnly) {
        this.send({ type: 'spectate', mode: this.roomMode });
      } else {
        this.send(this.joinPayload());
      }
    };

    this.ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      this.handleMessage(msg);
    };

    this.ws.onclose = () => {
      this.callbacks.onStatus?.('disconnected');
    };

    this.ws.onerror = () => {
      this.callbacks.onError?.('Ошибка WebSocket соединения');
      this.callbacks.onStatus?.('error');
    };
  }

  private buildStateFromMsg(msg: StateMessage): { state: GameState; you: Player | undefined } {
    const foodR = getFoodRadius(this.config);
    const food: Food[] = msg.food.map((f) => ({
      id: f.id,
      x: f.x,
      y: f.y,
      radius: foodR,
      color: f.c,
    }));
    const viruses: Virus[] = msg.viruses.map((v) => ({
      id: v.id,
      x: v.x,
      y: v.y,
      radius: v.r,
      charge: v.ch,
      velocityX: 0,
      velocityY: 0,
      splitDirX: 0,
      splitDirY: 0,
      splitMaxSpeed: 0,
    }));
    const ejected: EjectedMass[] = msg.ejected.map((e) => ({
      id: e.id,
      x: e.x,
      y: e.y,
      radius: e.r,
      color: e.c,
      velocityX: 0,
      velocityY: 0,
      dirX: 0,
      dirY: 0,
      ownerId: '',
      ownerCellId: '',
      createdAt: 0,
    }));

    const you = msg.you ? netPlayerToPlayer(msg.you, this.skinCache) : undefined;
    const others = msg.players.map((p) => netPlayerToPlayer(p, this.skinCache));
    const players = you ? [you, ...others.filter((p) => p.id !== you.id)] : others;

    return {
      state: {
        players,
        food,
        viruses,
        ejectedMass: ejected,
        worldWidth: this.worldW,
        worldHeight: this.worldH,
      },
      you,
    };
  }

  private retainBriefly<T extends { id: string }>(
    current: T[],
    previous: T[],
    seenAt: Map<string, number>,
    now: number,
    removedIds: readonly string[] = []
  ): T[] {
    const previousById = new Map(previous.map((entity) => [entity.id, entity]));
    const currentIds = new Set<string>();
    const removed = new Set(removedIds);
    for (const id of removed) seenAt.delete(id);
    for (const entity of current) {
      currentIds.add(entity.id);
      seenAt.set(entity.id, now);
      const prior = previousById.get(entity.id) as (T & { x?: number; y?: number; velocityX?: number; velocityY?: number }) | undefined;
      const moving = entity as T & { x?: number; y?: number; velocityX?: number; velocityY?: number };
      if (prior && typeof prior.x === 'number' && typeof prior.y === 'number' && typeof moving.x === 'number' && typeof moving.y === 'number') {
        // Network entities do not transmit velocities. Preserve the measured
        // per-snapshot delta so a briefly omitted flying W/virus continues
        // smoothly instead of freezing before its grace timeout.
        moving.velocityX = moving.x - prior.x;
        moving.velocityY = moving.y - prior.y;
      }
    }
    const retained = [...current];
    for (const entity of previous) {
      if (
        !currentIds.has(entity.id) &&
        !removed.has(entity.id) &&
        now - (seenAt.get(entity.id) ?? 0) <= MultiplayerClient.ENTITY_MISSING_GRACE_MS
      ) {
        const prior = entity as T & { x?: number; y?: number; velocityX?: number; velocityY?: number };
        const held = { ...prior };
        if (typeof prior.x === 'number' && typeof prior.y === 'number') {
          held.x = prior.x + (prior.velocityX ?? 0);
          held.y = prior.y + (prior.velocityY ?? 0);
        }
        retained.push(held);
      }
    }
    for (const [id, lastSeen] of seenAt) {
      if (now - lastSeen > MultiplayerClient.ENTITY_MISSING_GRACE_MS) seenAt.delete(id);
    }
    return retained;
  }

  private retainSnapshotGaps(state: GameState, now: number, msg: StateMessage) {
    const previous = this.snapCurr?.state;
    if (!previous) {
      for (const food of state.food) this.foodSeenAt.set(food.id, now);
      for (const virus of state.viruses) this.virusSeenAt.set(virus.id, now);
      for (const eject of state.ejectedMass) this.ejectSeenAt.set(eject.id, now);
      return;
    }

    // The server distinguishes a capped/FOV omission from destruction. Only
    // omitted live entities get a grace period; consumed/despawned ones vanish
    // in this snapshot without waiting for the anti-flicker timeout.
    state.food = this.retainBriefly(state.food, previous.food, this.foodSeenAt, now, msg.removedFoodIds);
    state.viruses = this.retainBriefly(state.viruses, previous.viruses, this.virusSeenAt, now, msg.removedVirusIds);
    state.ejectedMass = this.retainBriefly(
      state.ejectedMass,
      previous.ejectedMass,
      this.ejectSeenAt,
      now,
      msg.removedEjectedIds
    );

    // Player cells are authoritative, unlike capped food/W snapshots. Keeping
    // omitted foreign cells here produced a short-lived ghost on joins and
    // room changes, so remove them as soon as the server stops sending them.
  }

  private handleMessage(msg: ServerMessage) {
    switch (msg.type) {
      case 'welcome':
        this.clearSnapshotState();
        this.playerId = msg.id;
        this.worldW = msg.world.w;
        this.worldH = msg.world.h;
        if (msg.isAdmin !== undefined) this.isAdmin = msg.isAdmin;
        this.callbacks.onWelcome?.(msg.id, msg.world, msg.isAdmin);
        break;
      case 'adminStatus':
        this.isAdmin = msg.ok;
        this.callbacks.onAdminStatus?.(msg.ok);
        break;
      case 'world':
        this.worldW = msg.w;
        this.worldH = msg.h;
        if (this.snapCurr) {
          this.snapCurr.state.worldWidth = msg.w;
          this.snapCurr.state.worldHeight = msg.h;
        }
        if (this.snapPrev) {
          this.snapPrev.state.worldWidth = msg.w;
          this.snapPrev.state.worldHeight = msg.h;
        }
        this.callbacks.onWorld?.(msg.w, msg.h);
        break;
      case 'chat':
        this.callbacks.onChat?.(msg);
        break;
      case 'settings':
        this.config = sanitizeGameplayConfig(msg.settings);
        this.callbacks.onSettings?.(msg.settings, msg.mode);
        break;
      case 'soloFightHud':
        this.callbacks.onSoloFightHud?.({
          phase: msg.phase,
          countdown: msg.countdown,
          fightSecondsLeft: msg.fightSecondsLeft,
          a: msg.a,
          b: msg.b,
        });
        break;
      case 'soloFightTop':
        this.callbacks.onSoloFightTop?.(msg.entries);
        break;
      case 'teamFightTop':
        this.callbacks.onTeamFightTop?.(msg.mode, msg.entries);
        break;
      case 'playerProfile':
        this.callbacks.onPlayerProfile?.(msg);
        if (msg.deviceId) {
          this.deviceId = msg.deviceId;
          try {
            localStorage.setItem('agarvaDeviceId', msg.deviceId);
          } catch {
            /* ignore */
          }
        }
        break;
      case 'registerAccountResult':
        this.callbacks.onRegisterAccountResult?.(msg.ok, msg.message, msg.accountLogin);
        break;
      case 'loginAccountResult':
        this.callbacks.onLoginAccountResult?.(msg.ok, msg.message, msg.accountLogin);
        break;
      case 'passwordResetResult':
        this.callbacks.onPasswordResetResult?.(msg.action, msg.ok, msg.message);
        break;
      case 'adminDbExport':
        this.callbacks.onAdminDbExport?.(msg.json);
        break;
      case 'adminDbResult':
        this.callbacks.onAdminDbResult?.(msg.ok, msg.message);
        break;
      case 'adminBotLogs':
        this.callbacks.onAdminBotLogs?.(msg.text);
        break;
      case 'teamFightHud':
        this.callbacks.onTeamFightHud?.(msg);
        break;
      case 'roomInfo':
        this.callbacks.onRoomInfo?.({
          mode: msg.mode,
          players: msg.players,
          spectators: msg.lobby,
          blue: msg.blue,
          red: msg.red,
        });
        break;
      case 'lobbySnapshot':
        this.callbacks.onLobbySnapshot?.({
          classic: { ...msg.rooms.classic, spectators: msg.rooms.classic.lobby },
          soloFight: { ...msg.rooms.soloFight, spectators: msg.rooms.soloFight.lobby },
          duoFight: { ...msg.rooms.duoFight, spectators: msg.rooms.duoFight.lobby },
          trioFight: { ...msg.rooms.trioFight, spectators: msg.rooms.trioFight.lobby },
        });
        break;
      case 'state': {
        const { state, you } = this.buildStateFromMsg(msg);
        this.retainSnapshotGaps(state, performance.now(), msg);
        // Adapt delay to measured tick spacing
        if (this.snapCurr) {
          const gap = performance.now() - this.snapCurr.localT;
          if (gap > 40 && gap < 180) {
            this.interpDelayMs = Math.min(120, Math.max(75, gap * 0.9));
          }
        }
        if (msg.leaderboard) this.lastLeaderboard = msg.leaderboard;
        // A multibox switch changes `you` to a different owned player. Do not
        // interpolate the old cell into the new one: GameCanvas must receive the
        // new position and radius immediately so both camera axes and zoom snap.
        const activePlayerChanged =
          this.snapCurr?.you?.id !== undefined && this.snapCurr.you.id !== you?.id;
        this.snapPrev = activePlayerChanged ? null : this.snapCurr;
        this.snapCurr = {
          localT: performance.now(),
          state,
          you,
          leaderboard: this.lastLeaderboard,
          ownedIds: msg.ownedIds ?? (you ? [you.id] : []),
        };
        this.ownedIds = this.snapCurr.ownedIds;
        this.callbacks.onState?.(state, you, this.lastLeaderboard, this.ownedIds);
        break;
      }
      case 'died':
        this.callbacks.onStatus?.('died');
        this.callbacks.onDied?.();
        break;
      case 'error':
        this.callbacks.onError?.(msg.message);
        break;
      case 'pong':
        this.lastPingMs = Math.max(0, Date.now() - msg.t);
        break;
    }
  }

  send(msg: ClientMessage) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  sendInput(mx: number, my: number) {
    if (!Number.isFinite(mx) || !Number.isFinite(my)) return;
    const now = performance.now();
    if (now - this.lastInputSentAt < MultiplayerClient.INPUT_MIN_INTERVAL_MS) return;
    const dx = mx - this.lastInputMx;
    const dy = my - this.lastInputMy;
    if (
      Number.isFinite(this.lastInputMx) &&
      dx * dx + dy * dy < MultiplayerClient.INPUT_MIN_DELTA ** 2
    ) {
      return;
    }
    this.lastInputSentAt = now;
    this.lastInputMx = mx;
    this.lastInputMy = my;
    this.send({ type: 'input', mx: Math.round(mx * 10) / 10, my: Math.round(my * 10) / 10 });
  }

  split() {
    this.send({ type: 'split' });
  }

  eject() {
    this.send({ type: 'eject' });
  }

  freeze(frozen?: boolean) {
    if (typeof frozen === 'boolean') {
      this.send({ type: 'freeze', frozen });
    } else {
      this.send({ type: 'freeze' });
    }
  }

  enterSpectate() {
    this.spectateOnly = true;
    this.send({ type: 'spectate', mode: this.roomMode });
  }

  switchRoom(mode: 'classic' | 'soloFight' | 'duoFight' | 'trioFight', team?: 'blue' | 'red') {
    this.roomMode = mode;
    this.roomTeam = team;
    this.spectateOnly = false;
    // One socket lets the server vacate the old room before assigning the new
    // one, so team slots and lobby snapshots never overlap during a switch.
    this.send(this.joinPayload());
  }

  rename(name: string, password?: string, skin?: string | null) {
    this.name = name;
    if (password !== undefined) this.password = password;
    if (skin !== undefined) this.skin = skin || undefined;
    const msg: { type: 'rename'; name: string; password?: string; skin?: string } = {
      type: 'rename',
      name,
    };
    if (isAdminName(name) && this.password) msg.password = this.password;
    if (this.skin) msg.skin = this.skin;
    else if (skin === null || skin === '') msg.skin = '';
    this.send(msg);
  }

  multiboxSpawn() {
    this.send({ type: 'multiboxSpawn' });
  }

  multiboxSwitch() {
    this.send({ type: 'multiboxSwitch' });
  }

  sendChat(text: string) {
    this.send({ type: 'chat', text });
  }

  adminAddMass(amount?: number) {
    this.send({ type: 'adminAddMass', amount });
  }

  adminIdentify(name: string, password?: string) {
    const msg: { type: 'adminIdentify'; name: string; password?: string } = { type: 'adminIdentify', name };
    if (password) msg.password = password;
    else if (this.password) msg.password = this.password;
    this.send(msg);
  }

  adminGetSettings() {
    this.send({ type: 'adminGetSettings' });
  }

  adminUpdateSettings(settings: GameplayConfig) {
    this.send({ type: 'adminUpdateSettings', settings });
  }

  adminSpawnVirus(x: number, y: number) {
    this.send({ type: 'adminSpawnVirus', x, y });
  }

  adminTeleport(x: number, y: number) {
    this.send({ type: 'adminTeleport', x, y });
  }

  adminForceMerge() {
    this.send({ type: 'adminForceMerge' });
  }

  adminKickAt(x: number, y: number) {
    this.send({ type: 'adminKickAt', x, y });
  }

  adminSpawnBot(x: number, y: number, mass = 500) {
    this.send({ type: 'adminSpawnBot', x, y, mass });
  }

  syncProfile(payload: {
    deviceId: string;
    fingerprint?: string;
    lastNick?: string;
    skinId?: string | null;
    prefs?: Record<string, unknown>;
  }) {
    this.send({ type: 'syncProfile', ...payload });
  }

  adminDownloadDb() {
    this.send({ type: 'adminDownloadDb' });
  }

  adminUploadDb(json: string) {
    this.send({ type: 'adminUploadDb', json });
  }

  adminWipeDatabase() {
    this.send({ type: 'adminWipeDatabase', confirmation: 'CONFIRM' });
  }

  adminGetBotLogs() {
    this.send({ type: 'adminGetBotLogs' });
  }

  registerAccount(login: string, password: string) {
    this.send({
      type: 'registerAccount',
      deviceId: this.deviceId,
      fingerprint: this.fingerprint,
      login,
      password,
    });
  }

  loginAccount(login: string, password: string) {
    this.send({
      type: 'loginAccount',
      deviceId: this.deviceId,
      fingerprint: this.fingerprint,
      login,
      password,
    });
  }

  requestPasswordReset(login: string) {
    this.send({ type: 'requestPasswordReset', login, deviceId: this.deviceId || undefined });
  }

  confirmPasswordReset(login: string, code: string, newPassword: string) {
    this.send({ type: 'confirmPasswordReset', login, code, newPassword });
  }

  resetStarter() {
    this.send({ type: 'resetStarter' });
  }

  respawn(name?: string) {
    if (name) this.name = name;
    this.spectateOnly = false;
    this.send(this.joinPayload());
  }

  ping() {
    this.send({ type: 'ping', t: Date.now() });
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.clearSnapshotState();
    this.playerId = null;
    this.isAdmin = false;
    this.spectateOnly = false;
    this.ownedIds = [];
  }
}
