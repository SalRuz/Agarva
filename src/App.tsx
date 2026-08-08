import { useState, useEffect, useRef, useCallback } from 'react';
import { GameEngine } from './engine/GameEngine';
import { GameCanvas } from './components/GameCanvas';
import { Leaderboard } from './components/Leaderboard';
import { Minimap } from './components/Minimap';
import { StartScreen, useLobbySnapshot, useModeTops, type PlayRoomMode } from './components/StartScreen';
import { SoloFightHud } from './components/SoloFightHud';
import { TeamFightHud } from './components/TeamFightHud';
import { HUD } from './components/HUD';
import { ChatPanel, type ChatLine } from './components/ChatPanel';
import { AdminSettingsPanel } from './components/AdminSettingsPanel';
import { PlayerSettingsPanel } from './components/PlayerSettingsPanel';
import { SkinPicker } from './components/SkinPicker';
import { GameState, Player } from './types/game';
import { MultiplayerClient, resolveServerUrl } from './net/MultiplayerClient';
import { HUD_HZ } from '../shared/constants';
import {
  cloneGameplayConfig,
  defaultGameplayConfig,
  defaultSoloFightConfig,
  sanitizeGameplayConfig,
  type GameplayConfig,
} from '../shared/gameConfig';
import { isAdminName } from '../shared/physics';
import { getSectorLabelAt } from '../shared/sectors';
import { requestRemoteAdminSettings, requestRemoteAdminDbDownload, requestRemoteAdminDbUpload } from './net/adminSettings';
import {
  loadSelectedSkinId,
  loadCustomSkins,
  uploadCustomSkin,
  deleteCustomSkin,
  resolveSkinUrl,
  saveSelectedSkinId,
  type SkinInfo,
} from './skins/loadSkins';
import {
  hudSizeScale,
  loadPlayerPrefs,
  savePlayerPrefs,
  sanitizePlayerPrefs,
  type PlayerPrefs,
} from './settings/playerPrefs';
import { getOrCreateDeviceId } from './device/deviceId';
import { formatQuestProgressLine, LEVEL_SKIN_REWARDS, type QuestPublicView } from '../shared/quests';

type GameMode = 'menu' | 'playing' | 'dead' | 'spectating';
type SessionKind = 'solo' | 'multiplayer';

export function App() {
  const [mode, setMode] = useState<GameMode>('menu');
  const [sessionKind, setSessionKind] = useState<SessionKind>('solo');
  /** Throttled snapshot for HUD / minimap / leaderboard (~8 Hz) — NOT every frame */
  const [hudState, setHudState] = useState<GameState | null>(null);
  const [currentPlayer, setCurrentPlayer] = useState<Player | undefined>();
  const [leaderboard, setLeaderboard] = useState<{ name: string; score: number; isBot: boolean; level?: number }[]>([]);
  const [showEscapeMenu, setShowEscapeMenu] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [ready, setReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatLine[]>([]);
  const [privateChats, setPrivateChats] = useState<Record<string, ChatLine[]>>({});
  const [openPrivateWith, setOpenPrivateWith] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [, setChatFocused] = useState(false);
  const [lastScore, setLastScore] = useState(0);
  const [fps, setFps] = useState<number | null>(null);
  const [pingMs, setPingMs] = useState<number | null>(null);
  const [gameConfig, setGameConfig] = useState<GameplayConfig>(() => cloneGameplayConfig(defaultGameplayConfig));
  const [draftConfig, setDraftConfig] = useState<GameplayConfig>(() => cloneGameplayConfig(defaultGameplayConfig));
  const [playMode, setPlayMode] = useState<PlayRoomMode>('classic');
  /** Mode of the live MP session (may differ from menu playMode while switching) */
  const [connectedPlayMode, setConnectedPlayMode] = useState<PlayRoomMode>('classic');
  const [liveRoomSpectators, setLiveRoomSpectators] = useState(0);
  const [soloFightHud, setSoloFightHud] = useState<{
    phase: 'waiting' | 'countdown' | 'fighting' | 'between' | 'ended' | 'resetting';
    countdown: number;
    fightSecondsLeft?: number;
    a: { name: string; score: number };
    b: { name: string; score: number };
  } | null>(null);
  const [teamFightHud, setTeamFightHud] = useState<{
    mode: 'duoFight' | 'trioFight';
    phase: 'waiting' | 'countdown' | 'fighting' | 'between' | 'ended' | 'resetting';
    countdown: number;
    fightSecondsLeft?: number;
    blue: { alive: number; total: number; members: string[]; streaks: Record<string, number> };
    red: { alive: number; total: number; members: string[]; streaks: Record<string, number> };
    spectators?: number;
  } | null>(null);
  const [showAdminSettings, setShowAdminSettings] = useState(false);
  const [showPlayerSettings, setShowPlayerSettings] = useState(false);
  const [playerPrefs, setPlayerPrefs] = useState<PlayerPrefs>(() => loadPlayerPrefs());
  const [adminSettingsError, setAdminSettingsError] = useState<string | null>(null);
  const [adminSettingsSaving, setAdminSettingsSaving] = useState(false);
  const [adminSaveNotice, setAdminSaveNotice] = useState<string | null>(null);
  const [telegramBotLogs, setTelegramBotLogs] = useState('');
  const [showSkinPicker, setShowSkinPicker] = useState(false);
  const [accountLogin, setAccountLogin] = useState<string | null>(() => {
    try {
      return localStorage.getItem('agarvaAccountLogin');
    } catch {
      return null;
    }
  });
  const [questView, setQuestView] = useState<QuestPublicView | null>(null);
  const [levelRewardQueue, setLevelRewardQueue] = useState<number[]>([]);
  // Ignore stale profile snapshots after this browser session has dismissed a
  // reward. The server remains the durable source of truth and is acknowledged
  // only after the congratulations modal is actually closed.
  const acknowledgedLevelRewardsRef = useRef<Set<number>>(new Set());
  /** Level snapshot when the player started playing; null until first profile/play. */
  const playStartLevelRef = useRef<number | null>(null);
  const [questUpdatedAt, setQuestUpdatedAt] = useState(0);
  const [questClock, setQuestClock] = useState(Date.now());
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registerBusy, setRegisterBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [passwordResetError, setPasswordResetError] = useState<string | null>(null);
  const [passwordResetNotice, setPasswordResetNotice] = useState<string | null>(null);
  const [passwordResetBusy, setPasswordResetBusy] = useState(false);
  const [passwordResetCodeSent, setPasswordResetCodeSent] = useState(false);
  const [selectedSkinId, setSelectedSkinId] = useState<string | null>(() => loadSelectedSkinId());
  const [customSkins, setCustomSkins] = useState<SkinInfo[]>([]);
  const [skinsLoaded, setSkinsLoaded] = useState(false);
  const [telegramChannelUrl, setTelegramChannelUrl] = useState('');
  const [weeklyTopPrizes, setWeeklyTopPrizes] = useState<Record<PlayRoomMode, number>>({ classic: 60, soloFight: 60, duoFight: 60, trioFight: 60 });
  const [centerLeader, setCenterLeader] = useState<{ name: string; skin?: string; score: number } | null>(null);
  const selectedSkinUrl = resolveSkinUrl(selectedSkinId);
  const [menuName, setMenuName] = useState(() => {
    try {
      return localStorage.getItem('agarvaMenuNick') || '';
    } catch {
      return '';
    }
  });
  const [menuPassword, setMenuPassword] = useState('');

  const questTimerActive =
    mode === 'playing' &&
    sessionKind === 'multiplayer' &&
    questView?.unit === 'minutes' &&
    questView.timeRunning === true;
  useEffect(() => {
    if (!questTimerActive) return;
    const timer = window.setInterval(() => setQuestClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [questTimerActive, questView?.taskId, questView?.remainingMs, questUpdatedAt]);

  const questProgressText = questView
    ? formatQuestProgressLine(
        questView,
        questTimerActive ? Math.max(0, questClock - questUpdatedAt) : 0
      ).replace(`${questView.title}: `, '')
    : undefined;
  const enqueueLevelRewards = useCallback((levels: number[]) => {
    const unacknowledged = levels.filter(
      (level) => Number.isFinite(level) && level > 0 && !acknowledgedLevelRewardsRef.current.has(level)
    );
    if (!unacknowledged.length) return;
    setLevelRewardQueue((queue) => [...new Set([...queue, ...unacknowledged])].sort((a, b) => a - b));
  }, []);

  // Baseline level from first profile so we never congratulate old levels on reload.
  useEffect(() => {
    if (questView && playStartLevelRef.current === null) {
      playStartLevelRef.current = questView.level;
    }
  }, [questView]);

  // Keep a live queue while playing (modal still only renders on main menu).
  useEffect(() => {
    enqueueLevelRewards(questView?.pendingLevelRewards ?? []);
  }, [questView?.pendingLevelRewards, enqueueLevelRewards]);

  // When entering the actual main menu, rebuild the queue from server pending
  // and from levels gained during the last play session (covers missed pushes).
  useEffect(() => {
    if (mode !== 'menu' || !questView) return;
    const pending = questView.pendingLevelRewards ?? [];
    const gained: number[] = [];
    const currentLevel = questView.level ?? 0;
    const startLevel = playStartLevelRef.current;
    if (startLevel !== null) {
      for (let level = startLevel + 1; level <= currentLevel; level++) {
        gained.push(level);
      }
      playStartLevelRef.current = currentLevel;
    }
    enqueueLevelRewards([...pending, ...gained]);
  }, [mode, questView, enqueueLevelRewards]);
  const [frozen, setFrozen] = useState(false);
  const [isTouchDevice] = useState(
    () => typeof navigator !== 'undefined' && (navigator.maxTouchPoints > 0 || 'ontouchstart' in window)
  );

  const engineRef = useRef<GameEngine | null>(null);
  const playerIdRef = useRef<string | null>(null);
  const mpRef = useRef<MultiplayerClient | null>(null);
  const sessionKindRef = useRef<SessionKind>('solo');
  const serverUrlRef = useRef(resolveServerUrl());
  const gameStateRef = useRef<GameState | null>(null);
  const currentPlayerRef = useRef<Player | undefined>(undefined);
  const modeRef = useRef<GameMode>('menu');
  const showEscapeMenuRef = useRef(false);
  const playerNameRef = useRef('Player');
  const chatOpenRef = useRef(false);
  const isAdminRef = useRef(false);
  const minimapHoverRef = useRef<{ x: number; y: number } | null>(null);
  const spectateTargetRef = useRef<{ x: number; y: number } | null>(null);
  const lastAliveCenterRef = useRef<{ x: number; y: number } | null>(null);
  const spectateReturnModeRef = useRef<GameMode>('menu');
  const spectateReturnPlayerIdRef = useRef<string | null>(null);
  const ownedIdsRef = useRef<string[]>([]);
  const selectedSkinIdRef = useRef<string | null>(selectedSkinId);
  const deviceIdRef = useRef('');
  const fingerprintRef = useRef('');
  const [chatMention, setChatMention] = useState<string | null>(null);
  const mpRenderRef = useRef<
    (() => { state: GameState; you: Player | undefined } | null) | null
  >(null);
  const adminSettingsNameRef = useRef('salruz');
  const adminPasswordRef = useRef<string | undefined>(undefined);
  const peakMassRef = useRef(0);
  const frozenRef = useRef(false);
  const showAdminSettingsRef = useRef(false);
  const playModeRef = useRef<PlayRoomMode>('classic');
  /** True while the main menu deliberately keeps a live MP spectator connection. */
  const menuOverLiveRef = useRef(false);
  const soloFightHudKeyRef = useRef('');
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    showAdminSettingsRef.current = showAdminSettings;
  }, [showAdminSettings]);

  useEffect(() => {
    playModeRef.current = playMode;
  }, [playMode]);

  useEffect(() => {
    showEscapeMenuRef.current = showEscapeMenu;
  }, [showEscapeMenu]);

  useEffect(() => {
    chatOpenRef.current = chatOpen;
  }, [chatOpen]);

  useEffect(() => {
    isAdminRef.current = isAdmin;
  }, [isAdmin]);

  useEffect(() => {
    frozenRef.current = frozen;
  }, [frozen]);

  useEffect(() => {
    selectedSkinIdRef.current = selectedSkinId;
  }, [selectedSkinId]);

  const refreshCustomSkins = useCallback(async () => {
    const skins = await loadCustomSkins();
    setCustomSkins(skins);
    setSkinsLoaded(true);
  }, []);

  useEffect(() => {
    void refreshCustomSkins();
  }, [refreshCustomSkins]);

  useEffect(() => {
    if (mode === 'menu') void refreshCustomSkins();
  }, [mode, refreshCustomSkins]);

  // Do not retain a local id for an admin/personal skin which no longer exists
  // after a database restore or wipe.
  useEffect(() => {
    if (!skinsLoaded || !selectedSkinId || resolveSkinUrl(selectedSkinId)) return;
    setSelectedSkinId(null);
    selectedSkinIdRef.current = null;
    saveSelectedSkinId(null);
  }, [customSkins, selectedSkinId, skinsLoaded]);

  useEffect(() => {
    const wsUrl = new URL(resolveServerUrl());
    wsUrl.protocol = wsUrl.protocol === 'wss:' ? 'https:' : 'http:';
    wsUrl.pathname = '/api/public-config';
    wsUrl.search = '';
    void fetch(wsUrl.toString(), { cache: 'no-store' })
      .then((response) => response.json())
      .then((body: { telegramChannelUrl?: string; weeklyTopPrizes?: Record<PlayRoomMode, number> }) => {
        setTelegramChannelUrl(body.telegramChannelUrl ?? '');
        if (body.weeklyTopPrizes) setWeeklyTopPrizes((current) => ({ ...current, ...body.weeklyTopPrizes }));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('agarvaMenuNick', menuName);
    } catch {
      /* ignore */
    }
    playerNameRef.current = menuName;
  }, [menuName]);

  useEffect(() => {
    const { deviceId, fingerprint } = getOrCreateDeviceId();
    deviceIdRef.current = deviceId;
    fingerprintRef.current = fingerprint;
    let closed = false;
    let ws = null;
    try {
      ws = new WebSocket(resolveServerUrl());
    } catch {
      return;
    }
    ws.onopen = () => {
      if (closed) return;
      ws.send(JSON.stringify({
        type: 'syncProfile',
        deviceId,
        fingerprint,
        lastNick: localStorage.getItem('agarvaMenuNick') || undefined,
        skinId: selectedSkinIdRef.current,
      }));
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data));
        if (msg.type !== 'playerProfile') return;
        if (msg.deviceId) {
          deviceIdRef.current = msg.deviceId;
          try { localStorage.setItem('agarvaDeviceId', msg.deviceId); } catch {}
        }
        if (msg.lastNick) {
          setMenuName(msg.lastNick);
          playerNameRef.current = msg.lastNick;
        }
        if ('skinId' in msg) {
          const skinId = msg.skinId || null;
          setSelectedSkinId(skinId);
          saveSelectedSkinId(skinId);
          selectedSkinIdRef.current = skinId;
        }
        if ('accountLogin' in msg) {
          setAccountLogin(msg.accountLogin || null);
          try {
            if (msg.accountLogin) localStorage.setItem('agarvaAccountLogin', msg.accountLogin);
            else localStorage.removeItem('agarvaAccountLogin');
          } catch {}
        }
        if (msg.prefs) {
          const prefs = sanitizePlayerPrefs(msg.prefs);
          setPlayerPrefs(prefs);
          savePlayerPrefs(prefs);
        }
        if (msg.quest) {
          setQuestView(msg.quest as QuestPublicView);
          setQuestUpdatedAt(Date.now());
          setQuestClock(Date.now());
        }
      } catch {}
      try { ws.close(); } catch {}
    };
    return () => {
      closed = true;
      try { if (ws) ws.close(); } catch {}
    };
  }, []);

  // A game socket stays alive as a spectator below the menu. Request a fresh
  // profile whenever the actual main menu is entered, so rewards earned just
  // before that transition are not dependent on a previously delivered quest
  // update. The standalone menu socket covers the same case without a game
  // connection (including reopening the app directly into StartScreen).
  useEffect(() => {
    if (mode !== 'menu' || !deviceIdRef.current) return;
    const payload = {
      deviceId: deviceIdRef.current,
      fingerprint: fingerprintRef.current,
      lastNick: playerNameRef.current || undefined,
      skinId: selectedSkinIdRef.current,
    };
    if (
      sessionKindRef.current === 'multiplayer' &&
      mpRef.current?.isConnected()
    ) {
      mpRef.current.syncProfile(payload);
      return;
    }

    let closed = false;
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(resolveServerUrl());
    } catch {
      return;
    }
    ws.onopen = () => {
      if (!closed) ws?.send(JSON.stringify({ type: 'syncProfile', ...payload }));
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data));
        if (msg.type === 'playerProfile' && msg.quest) {
          setQuestView(msg.quest as QuestPublicView);
          setQuestUpdatedAt(Date.now());
          setQuestClock(Date.now());
        }
      } catch {
        /* ignore malformed profile response */
      }
      try { ws?.close(); } catch {}
    };
    return () => {
      closed = true;
      try { ws?.close(); } catch {}
    };
  }, [mode]);

  const startMenuEngine = useCallback(() => {
    const engine = new GameEngine({
      botCount: gameConfig.botCountMp,
      foodCount: gameConfig.foodCountMp,
      virusCount: gameConfig.virusCount,
      worldWidth: gameConfig.worldWidth,
      worldHeight: gameConfig.worldHeight,
      config: gameConfig,
    });
    engineRef.current = engine;
    sessionKindRef.current = 'solo';
    const state = engine.getState();
    gameStateRef.current = state;
    setHudState(state);
    setLeaderboard(engine.getLeaderboard());
    setReady(true);
    setIsAdmin(false);
    isAdminRef.current = false;
  }, [gameConfig]);

  useEffect(() => {
    startMenuEngine();
    return () => {
      mpRef.current?.disconnect();
      engineRef.current = null;
    };
  }, []);

  // Throttle React HUD updates — canvas loop owns solo physics + draw via refs
  useEffect(() => {
    const interval = setInterval(() => {
      if (sessionKindRef.current === 'solo') {
        const engine = engineRef.current;
        if (!engine) return;
        const state = gameStateRef.current ?? engine.getState();
        setHudState(state);
        setLeaderboard(engine.getLeaderboard());

        const player = playerIdRef.current
          ? state.players.find((p) => p.id === playerIdRef.current)
          : currentPlayerRef.current;
        currentPlayerRef.current = player;
        setCurrentPlayer(player);
        if (player) setFrozen(!!player.frozen);

        if (player && player.cells.length > 0) {
          let sx = 0;
          let sy = 0;
          let massSum = 0;
          for (const cell of player.cells) {
            const m = Math.max(1, cell.radius * cell.radius);
            sx += cell.x * m;
            sy += cell.y * m;
            massSum += m;
          }
          lastAliveCenterRef.current = { x: sx / massSum, y: sy / massSum };
        }

        if (modeRef.current === 'playing' && player && player.cells.length === 0) {
          // Multibox: switch to another owned living box before dying
          const statePlayers = state.players;
          const other = ownedIdsRef.current.find((id) => {
            if (id === player.id) return false;
            const p = statePlayers.find((x) => x.id === id);
            return !!(p && p.cells.length > 0);
          });
          if (other) {
            const next = statePlayers.find((p) => p.id === other)!;
            // Drop the empty box
            engine.removePlayer(player.id);
            playerIdRef.current = next.id;
            currentPlayerRef.current = next;
            setCurrentPlayer(next);
            ownedIdsRef.current = ownedIdsRef.current.filter((id) => id !== player.id);
          } else {
            if (lastAliveCenterRef.current) {
              spectateTargetRef.current = { ...lastAliveCenterRef.current };
            }
            setLastScore(Math.floor(peakMassRef.current));
            setMode('dead');
            setShowEscapeMenu(false);
            setFrozen(false);
            ownedIdsRef.current = [];
          }
        }
        setPingMs(null);
      } else {
        const state = gameStateRef.current;
        if (!state) return;
        setHudState(state);
        const player = currentPlayerRef.current;
        setCurrentPlayer(player);
        if (player) setFrozen(!!player.frozen);
        setPingMs(mpRef.current?.getPingMs() ?? null);
      }
    }, 1000 / HUD_HZ);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      if (sessionKindRef.current === 'multiplayer') {
        mpRef.current?.ping();
      }
    // Ping is informational only; avoid a request/response every second on mobile.
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const root = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
    };
    const fullscreenDocument = document as Document & { webkitFullscreenElement?: Element | null };
    const entering = !(document.fullscreenElement || fullscreenDocument.webkitFullscreenElement);
    try {
      if (entering) {
        if (root.requestFullscreen) await root.requestFullscreen();
        else root.webkitRequestFullscreen?.();
      } else {
        await document.exitFullscreen?.();
      }
    } catch {
      // Fullscreen is browser-controlled and may require a fresh user gesture.
    }
  }, []);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.code !== 'Escape') return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const consume = () => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      };
      if (chatOpenRef.current) {
        consume();
        setChatOpen(false);
        setChatFocused(false);
        return;
      }
      if (showAdminSettings || showSkinPicker || showPlayerSettings) {
        if (e.code === 'Escape' && showSkinPicker) {
          consume();
          setShowSkinPicker(false);
        }
        return;
      }
      if (modeRef.current === 'playing') {
        consume();
        setShowEscapeMenu((prev) => {
          if (!prev) {
            setMenuName(playerNameRef.current || menuName);
          }
          return !prev;
        });
        return;
      }
      if (modeRef.current === 'spectating') {
        consume();
        const state = gameStateRef.current;
        const savedId = spectateReturnPlayerIdRef.current;
        if (state && savedId) {
          const back = state.players.find((p) => p.id === savedId && p.cells.length > 0);
          if (back) {
            playerIdRef.current = back.id;
            currentPlayerRef.current = back;
            setCurrentPlayer(back);
            setMode('playing');
            return;
          }
        }
        // Always main menu (with live background if still connected) — never death overlay
        handleBackToMenuRef.current();
        return;
      }
      // A live player may inspect another room's roster from the ESC menu.
      // Escape from that preview restores the actual room instead of trapping
      // the overlay on the preview selection.
      if (modeRef.current === 'menu' && menuOverLiveRef.current) {
        consume();
        setPlayMode(connectedPlayMode);
      }
    };
    // Capture the key before browser/game canvas handlers. Once the game consumes
    // Escape, it must not also reach the browser fullscreen shortcut.
    window.addEventListener('keydown', handleEsc, true);
    return () => window.removeEventListener('keydown', handleEsc, true);
  }, [showAdminSettings, showSkinPicker, showPlayerSettings, menuName, connectedPlayMode]);

  // Enter toggles chat in multiplayer (playing, dead, or spectating)
  useEffect(() => {
    const handleEnter = (e: KeyboardEvent) => {
      if (e.code !== 'Enter') return;
      if (sessionKindRef.current !== 'multiplayer') return;
      const m = modeRef.current;
      if (m !== 'playing' && m !== 'dead' && m !== 'spectating') return;
      if (showEscapeMenuRef.current) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      e.preventDefault();
      setChatOpen((open) => !open);
    };
    window.addEventListener('keydown', handleEnter);
    return () => window.removeEventListener('keydown', handleEnter);
  }, []);

  const disconnectMultiplayer = useCallback(() => {
    mpRef.current?.disconnect();
    mpRef.current = null;
    mpRenderRef.current = null;
    // Keep the room history across the menu → rejoin handoff. The App itself
    // owns this history, so replacing the websocket must not wipe the chat.
    setChatOpen(false);
    setIsAdmin(false);
    setPingMs(null);
    setFrozen(false);
    isAdminRef.current = false;
  }, []);

  const attachMpCallbacks = useCallback(
    (opts?: { spectate?: boolean }) => ({
      onWelcome: (id: string, world: { w: number; h: number }, adminFlag?: boolean) => {
        if (gameStateRef.current) {
          gameStateRef.current.worldWidth = world.w;
          gameStateRef.current.worldHeight = world.h;
        }
        // `enterSpectate()` responds with welcome too. Keep the deliberately opened
        // menu visible instead of treating that acknowledgement as a fresh game join.
        if (menuOverLiveRef.current && modeRef.current === 'menu') {
          playerIdRef.current = null;
          ownedIdsRef.current = [];
          currentPlayerRef.current = undefined;
          setCurrentPlayer(undefined);
          setIsConnecting(false);
          setIsAdmin(false);
          isAdminRef.current = false;
          setShowEscapeMenu(false);
          setFrozen(false);
          return;
        }
        const spectating = opts?.spectate || mpRef.current?.isSpectateOnly() === true;
        playerIdRef.current = spectating ? null : id;
        if (!spectating && id) ownedIdsRef.current = [id];
        setIsConnecting(false);
        if (spectating) {
          setMode('spectating');
          setIsAdmin(false);
          isAdminRef.current = false;
        } else {
          setMode('playing');
          const admin = adminFlag ?? isAdminName(playerNameRef.current);
          setIsAdmin(admin);
          isAdminRef.current = admin;
        }
        setShowEscapeMenu(false);
        setFrozen(false);
      },
      onAdminStatus: (ok: boolean) => {
        setIsAdmin(ok);
        isAdminRef.current = ok;
      },
      onWorld: (w: number, h: number) => {
        if (gameStateRef.current) {
          gameStateRef.current.worldWidth = w;
          gameStateRef.current.worldHeight = h;
        }
      },
      onChat: (msg: ChatLine) => {
        setChatMessages((prev) => [
          ...prev.slice(-79),
          { name: msg.name, text: msg.text, t: msg.t, color: msg.color, fromTg: msg.fromTg, level: msg.level, hideLevel: msg.hideLevel },
        ]);
      },
      onPrivateChat: (msg: ChatLine) => {
        setPrivateChats((prev) => ({
          ...prev,
          [msg.name]: [...(prev[msg.name] ?? []).slice(-79), { name: msg.name, text: msg.text, t: msg.t, color: msg.color, level: msg.level, hideLevel: msg.hideLevel }],
        }));
      },
      onSettings: (settings: GameplayConfig) => {
        const clean = sanitizeGameplayConfig(settings);
        setGameConfig(clean);
        if (!showAdminSettingsRef.current) {
          setDraftConfig(clean);
        }
      },
      onSoloFightHud: (hud: {
        phase: 'waiting' | 'countdown' | 'fighting' | 'between' | 'ended' | 'resetting';
        countdown: number;
        fightSecondsLeft?: number;
        a: { name: string; score: number };
        b: { name: string; score: number };
      }) => {
        const key = `${hud.phase}|${hud.countdown}|${hud.fightSecondsLeft ?? ''}|${hud.a.name}|${hud.a.score}|${hud.b.name}|${hud.b.score}`;
        if (key === soloFightHudKeyRef.current) return;
        soloFightHudKeyRef.current = key;
        setSoloFightHud(hud);
      },
      onTeamFightHud: (hud: {
        mode: 'duoFight' | 'trioFight';
        phase: 'waiting' | 'countdown' | 'fighting' | 'between' | 'ended' | 'resetting';
        countdown: number;
        fightSecondsLeft?: number;
        blue: { alive: number; total: number; members: string[]; streaks: Record<string, number> };
        red: { alive: number; total: number; members: string[]; streaks: Record<string, number> };
        spectators?: number;
      }) => setTeamFightHud(hud),
      onRoomInfo: (info: { mode?: PlayRoomMode; spectators: number }) => {
        if (!info.mode || info.mode === playModeRef.current) {
          setLiveRoomSpectators(info.spectators);
        }
      },
      onSoloFightTop: () => {
        /* tops also arrive via lobby WS; keep callback for live sessions */
      },
      onPlayerProfile: (profile: {
        deviceId: string;
        lastNick?: string;
        skinId?: string;
        prefs?: Record<string, unknown>;
        accountLogin?: string | null;
        quest?: QuestPublicView;
      }) => {
        if (profile.deviceId) {
          deviceIdRef.current = profile.deviceId;
          try {
            localStorage.setItem('agarvaDeviceId', profile.deviceId);
          } catch {
            /* ignore */
          }
        }
        if (profile.lastNick) {
          setMenuName(profile.lastNick);
          playerNameRef.current = profile.lastNick;
        }
        if ('skinId' in profile) {
          const skinId = profile.skinId || null;
          setSelectedSkinId(skinId);
          saveSelectedSkinId(skinId);
          selectedSkinIdRef.current = skinId;
        }
        if ('accountLogin' in profile) {
          setAccountLogin(profile.accountLogin || null);
          try {
            if (profile.accountLogin) localStorage.setItem('agarvaAccountLogin', profile.accountLogin);
            else localStorage.removeItem('agarvaAccountLogin');
          } catch {
            /* ignore */
          }
        }
        if (profile.quest) {
          setQuestView(profile.quest);
          setQuestUpdatedAt(Date.now());
          setQuestClock(Date.now());
        }
        if (profile.prefs) {
          const prefs = sanitizePlayerPrefs(profile.prefs as Partial<PlayerPrefs>);
          setPlayerPrefs(prefs);
          savePlayerPrefs(prefs);
        }
      },
      onRegisterAccountResult: (ok: boolean, message: string, login?: string) => {
        setRegisterBusy(false);
        if (!ok) {
          setRegisterError(message);
          return;
        }
        setRegisterError(null);
        if (login) {
          setAccountLogin(login);
          try {
            localStorage.setItem('agarvaAccountLogin', login);
          } catch {
            /* ignore */
          }
        }
      },
      onLoginAccountResult: (ok: boolean, message: string, login?: string) => {
        setLoginBusy(false);
        if (!ok) {
          setLoginError(message);
          return;
        }
        setLoginError(null);
        if (login) {
          setAccountLogin(login);
          try {
            localStorage.setItem('agarvaAccountLogin', login);
          } catch {
            /* ignore */
          }
        }
      },
      onPasswordResetResult: (action: 'request' | 'confirm', ok: boolean, message: string) => {
        setPasswordResetBusy(false);
        if (!ok) {
          setPasswordResetError(message);
          return;
        }
        setPasswordResetError(null);
        if (action === 'request') setPasswordResetCodeSent(true);
        else {
          setPasswordResetCodeSent(false);
          setPasswordResetNotice(message);
        }
      },
      onAdminDbExport: (json: string) => {
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `agarva-db-${Date.now()}.json`;
        link.click();
        URL.revokeObjectURL(url);
        setAdminSaveNotice('База данных скачана');
      },
      onAdminDbResult: (ok: boolean, message: string) => {
        if (ok) setAdminSaveNotice(message);
        else setAdminSettingsError(message);
      },
      onAdminBotLogs: (text: string) => {
        setTelegramBotLogs(text);
      },
      onState: (state: GameState, you: Player | undefined, lb: { name: string; score: number; isBot: boolean }[], ownedIds?: string[], leader?: { name: string; skin?: string; score: number }) => {
        gameStateRef.current = state;
        if (ownedIds && ownedIds.length > 0) {
          ownedIdsRef.current = ownedIds;
        } else if (you) {
          ownedIdsRef.current = [you.id];
        }
        if (you) {
          currentPlayerRef.current = you;
          playerIdRef.current = you.id;
          playerNameRef.current = you.name;
          setFrozen(!!you.frozen);
          if (you.score > peakMassRef.current) {
            peakMassRef.current = you.score;
          }
          if (you.cells.length > 0) {
            let sx = 0;
            let sy = 0;
            let massSum = 0;
            for (const cell of you.cells) {
              const m = Math.max(1, cell.radius * cell.radius);
              sx += cell.x * m;
              sy += cell.y * m;
              massSum += m;
            }
            lastAliveCenterRef.current = { x: sx / massSum, y: sy / massSum };
          } else if (modeRef.current === 'playing' && lastAliveCenterRef.current) {
            spectateTargetRef.current = { ...lastAliveCenterRef.current };
          }
        } else if (modeRef.current !== 'playing') {
          currentPlayerRef.current = undefined;
        }
        setLeaderboard(lb);
        setCenterLeader(leader ?? null);
      },
      onDied: () => {
        if (lastAliveCenterRef.current) {
          spectateTargetRef.current = { ...lastAliveCenterRef.current };
        }
        setLastScore(Math.floor(peakMassRef.current));
        setMode('dead');
        setShowEscapeMenu(false);
        setFrozen(false);
        currentPlayerRef.current = undefined;
        setCurrentPlayer(undefined);
        ownedIdsRef.current = [];
      },
      onError: (message: string) => {
        setConnectionError(message);
        setIsConnecting(false);
        // Nick conflict / join reject: stay on menu so the player can change nick and retry
        if (modeRef.current !== 'menu') {
          setMode('menu');
        }
      },
      onStatus: (status: string) => {
        if (status === 'error' || status === 'disconnected') {
          setIsConnecting(false);
        }
      },
    }),
    []
  );

  const handleStartMultiplayer = useCallback(
    (name: string, serverUrl: string, password?: string, mode: PlayRoomMode = 'classic', team?: 'blue' | 'red') => {
      setConnectionError(null);
      setIsConnecting(true);
      playStartLevelRef.current = questView?.level ?? playStartLevelRef.current ?? 0;
      const liveClient = mpRef.current;
      if (
        liveClient &&
        sessionKindRef.current === 'multiplayer' &&
        modeRef.current === 'playing' &&
        showEscapeMenuRef.current
      ) {
        // One ordered WS transition releases the old team's slot before joining
        // the new room; closing and reconnecting could overlap those events.
        setPlayMode(mode);
        setConnectedPlayMode(mode);
        setLiveRoomSpectators(0);
        soloFightHudKeyRef.current = '';
        setSoloFightHud(null);
        setTeamFightHud(null);
        liveClient.setSkin(selectedSkinIdRef.current);
        liveClient.switchRoom(mode, team);
        return;
      }
      engineRef.current = null;
      menuOverLiveRef.current = false;
      disconnectMultiplayer();
      setShowEscapeMenu(false);
      soloFightHudKeyRef.current = '';
      setSoloFightHud(null);
      setPlayMode(mode);
      setConnectedPlayMode(mode);
      setLiveRoomSpectators(0);

      setSessionKind('multiplayer');
      sessionKindRef.current = 'multiplayer';
      serverUrlRef.current = serverUrl || resolveServerUrl();
      playerNameRef.current = name;
      setMenuName(name);
      if (password) setMenuPassword(password);
      adminPasswordRef.current = password;
      peakMassRef.current = 0;
      setLastScore(0);
      setIsAdmin(false);
      isAdminRef.current = false;
      setFrozen(false);

      const client = new MultiplayerClient(
        name,
        attachMpCallbacks(),
        password,
        selectedSkinIdRef.current || undefined
      );
      client.setDeviceIdentity(deviceIdRef.current, fingerprintRef.current);
      client.setRoomMode(mode);
      client.setRoomTeam(team);
      mpRef.current = client;
      mpRenderRef.current = () => client.getRenderState();
      client.connect(serverUrlRef.current, { mode, team });
    },
    [disconnectMultiplayer, attachMpCallbacks]
  );

  const handleSpectateClassic = useCallback(
    (mode: PlayRoomMode = playMode) => {
      setConnectionError(null);
      setIsConnecting(true);
      const liveClient = mpRef.current;
      if (liveClient && sessionKindRef.current === 'multiplayer') {
        // Same room after menu return: still re-enter spectate UI (old early-return
        // left the main menu stuck on screen).
        if (liveClient.getRoomMode() === mode) {
          menuOverLiveRef.current = false;
          setIsConnecting(false);
          setShowEscapeMenu(false);
          setPlayMode(mode);
          setConnectedPlayMode(mode);
          setLiveRoomSpectators(0);
          playerIdRef.current = null;
          ownedIdsRef.current = [];
          currentPlayerRef.current = undefined;
          setCurrentPlayer(undefined);
          setFrozen(false);
          setMode('spectating');
          spectateReturnModeRef.current = 'menu';
          spectateReturnPlayerIdRef.current = null;
          const ww = mode === 'soloFight' ? defaultSoloFightConfig.worldWidth : gameConfig.worldWidth;
          const wh = mode === 'soloFight' ? defaultSoloFightConfig.worldHeight : gameConfig.worldHeight;
          if (!spectateTargetRef.current) {
            spectateTargetRef.current = lastAliveCenterRef.current
              ? { ...lastAliveCenterRef.current }
              : { x: ww / 2, y: wh / 2 };
          }
          liveClient.enterSpectate();
          const st = spectateTargetRef.current;
          if (st) liveClient.sendInput(st.x, st.y);
          return;
        }
        menuOverLiveRef.current = false;
        setPlayMode(mode);
        setConnectedPlayMode(mode);
        setLiveRoomSpectators(0);
        soloFightHudKeyRef.current = '';
        setSoloFightHud(null);
        setTeamFightHud(null);
        playerIdRef.current = null;
        ownedIdsRef.current = [];
        currentPlayerRef.current = undefined;
        setCurrentPlayer(undefined);
        setFrozen(false);
        setMode('spectating');
        liveClient.setRoomMode(mode);
        liveClient.setRoomTeam(undefined);
        liveClient.enterSpectate();
        return;
      }
      engineRef.current = null;
      menuOverLiveRef.current = false;
      disconnectMultiplayer();
      setShowEscapeMenu(false);
      soloFightHudKeyRef.current = '';
      setSoloFightHud(null);
      setPlayMode(mode);
      setConnectedPlayMode(mode);
      setLiveRoomSpectators(0);
      setSessionKind('multiplayer');
      sessionKindRef.current = 'multiplayer';
      // Hide the main menu before the first welcome frame. The server will
      // acknowledge this fresh spectator join with welcome + initial state.
      setMode('spectating');
      serverUrlRef.current = resolveServerUrl();
      spectateReturnModeRef.current = 'menu';
      spectateReturnPlayerIdRef.current = null;
      setFrozen(false);

      const ww = mode === 'soloFight' ? defaultSoloFightConfig.worldWidth : gameConfig.worldWidth;
      const wh = mode === 'soloFight' ? defaultSoloFightConfig.worldHeight : gameConfig.worldHeight;
      if (!spectateTargetRef.current) {
        if (lastAliveCenterRef.current) {
          spectateTargetRef.current = { ...lastAliveCenterRef.current };
        } else {
          spectateTargetRef.current = { x: ww / 2, y: wh / 2 };
        }
      }

      const client = new MultiplayerClient(
        playerNameRef.current || menuName || 'Spectator',
        attachMpCallbacks({ spectate: true })
      );
      client.setDeviceIdentity(deviceIdRef.current, fingerprintRef.current);
      client.setRoomMode(mode);
      mpRef.current = client;
      mpRenderRef.current = () => client.getRenderState();
      client.connect(serverUrlRef.current, { spectate: true, mode });
    },
    [disconnectMultiplayer, attachMpCallbacks, gameConfig.worldWidth, gameConfig.worldHeight, menuName, playMode, questView?.level]
  );

  const handleMouseMove = useCallback((x: number, y: number) => {
    if (showEscapeMenuRef.current) return;
    // Keep steering while chat is open — only block when escape menu is up
    if (sessionKindRef.current === 'multiplayer') {
      mpRef.current?.sendInput(x, y);
      return;
    }
    if (!engineRef.current || !playerIdRef.current) return;
    if (frozenRef.current) return;
    engineRef.current.updatePlayerTarget(playerIdRef.current, x, y);
  }, []);

  const handleSplit = useCallback(() => {
    if (showEscapeMenuRef.current || chatOpenRef.current) return;
    if (frozenRef.current) return;
    if (sessionKindRef.current === 'multiplayer') {
      mpRef.current?.split();
      return;
    }
    if (!engineRef.current || !playerIdRef.current) return;
    engineRef.current.splitPlayer(playerIdRef.current);
  }, []);

  const handleEject = useCallback(() => {
    if (showEscapeMenuRef.current || chatOpenRef.current) return;
    if (frozenRef.current) return;
    if (sessionKindRef.current === 'multiplayer') {
      mpRef.current?.eject();
      return;
    }
    if (!engineRef.current || !playerIdRef.current) return;
    engineRef.current.ejectMass(playerIdRef.current);
  }, []);

  const handleFreeze = useCallback(() => {
    if (showEscapeMenuRef.current || chatOpenRef.current) return;
    if (modeRef.current !== 'playing') return;
    if (sessionKindRef.current === 'multiplayer') {
      mpRef.current?.freeze();
      setFrozen((prev) => !prev);
      return;
    }
    if (!engineRef.current || !playerIdRef.current) return;
    const next = engineRef.current.togglePlayerFrozen(playerIdRef.current);
    setFrozen(next);
  }, []);

  const handleAddMass = useCallback(() => {
    if (showEscapeMenuRef.current || chatOpenRef.current) return;
    if (!isAdminRef.current) return;
    if (sessionKindRef.current === 'multiplayer') {
      mpRef.current?.adminAddMass(gameConfig.adminMassBoost);
      return;
    }
    if (!engineRef.current || !playerIdRef.current) return;
    engineRef.current.addMass(playerIdRef.current, gameConfig.adminMassBoost);
  }, [gameConfig.adminMassBoost]);

  const handleSkipQuest = useCallback(() => {
    if (showEscapeMenuRef.current || chatOpenRef.current) return;
    if (!isAdminRef.current) return;
    if (sessionKindRef.current === 'multiplayer') {
      mpRef.current?.adminSkipQuest();
    }
  }, []);

  const handleSpawnVirus = useCallback((x: number, y: number) => {
    if (showEscapeMenuRef.current || chatOpenRef.current) return;
    if (!isAdminRef.current) return;
    if (modeRef.current !== 'playing') return;
    if (sessionKindRef.current === 'multiplayer') {
      mpRef.current?.adminSpawnVirus(x, y);
      return;
    }
    engineRef.current?.spawnVirusAt(x, y);
  }, []);

  const handleMinimapTeleport = useCallback(() => {
    if (showEscapeMenuRef.current || chatOpenRef.current) return;
    if (!isAdminRef.current) return;
    if (modeRef.current !== 'playing') return;
    const pos = minimapHoverRef.current;
    if (!pos) return;
    if (sessionKindRef.current === 'multiplayer') {
      mpRef.current?.adminTeleport(pos.x, pos.y);
      return;
    }
    if (!engineRef.current || !playerIdRef.current) return;
    engineRef.current.teleportPlayer(playerIdRef.current, pos.x, pos.y);
  }, []);

  const handleResetStarter = useCallback(() => {
    if (showEscapeMenuRef.current || chatOpenRef.current) return;
    if (!isAdminRef.current) return;
    if (modeRef.current !== 'playing') return;
    if (sessionKindRef.current === 'multiplayer') {
      mpRef.current?.resetStarter();
      return;
    }
    if (!engineRef.current || !playerIdRef.current) return;
    engineRef.current.resetToStarter(playerIdRef.current);
  }, []);

  const handleForceMerge = useCallback(() => {
    if (showEscapeMenuRef.current || chatOpenRef.current) return;
    if (!isAdminRef.current) return;
    if (modeRef.current !== 'playing') return;
    if (sessionKindRef.current === 'multiplayer') {
      mpRef.current?.adminForceMerge();
      return;
    }
    if (!engineRef.current || !playerIdRef.current) return;
    engineRef.current.forceMergePlayer(playerIdRef.current);
  }, []);

  const handleKickAt = useCallback((x: number, y: number) => {
    if (showEscapeMenuRef.current || chatOpenRef.current) return;
    if (!isAdminRef.current) return;
    if (modeRef.current !== 'playing') return;
    if (sessionKindRef.current === 'multiplayer') {
      mpRef.current?.adminKickAt(x, y);
      return;
    }
    engineRef.current?.removePlayerAt(x, y, playerIdRef.current);
  }, []);

  const handleSpawnBot = useCallback((x: number, y: number) => {
    if (showEscapeMenuRef.current || chatOpenRef.current) return;
    if (!isAdminRef.current) return;
    if (modeRef.current !== 'playing') return;
    if (sessionKindRef.current === 'multiplayer') {
      mpRef.current?.adminSpawnBot(x, y, 500);
      return;
    }
    engineRef.current?.spawnBotAt(x, y, 500);
  }, []);

  const handleUpdateName = useCallback((newName: string) => {
    const trimmed = newName.trim().slice(0, 15);
    if (!trimmed) return;
    playerNameRef.current = trimmed;
    const admin = isAdminName(trimmed);
    setIsAdmin(admin);
    isAdminRef.current = admin;
    if (sessionKindRef.current === 'multiplayer') {
      mpRef.current?.rename(trimmed, adminPasswordRef.current);
      if (currentPlayerRef.current) {
        currentPlayerRef.current.name = trimmed;
        setCurrentPlayer({ ...currentPlayerRef.current });
      }
      return;
    }
    if (!engineRef.current || !playerIdRef.current) return;
    for (const id of ownedIdsRef.current) {
      engineRef.current.updatePlayerName(id, trimmed);
    }
    engineRef.current.updatePlayerName(playerIdRef.current, trimmed);
  }, []);

  const handleRespawn = useCallback(() => {
    const name = playerNameRef.current || currentPlayer?.name || 'Player';
    peakMassRef.current = 0;
    setFrozen(false);
    if (sessionKind === 'multiplayer') {
      const client = mpRef.current;
      if (client) {
        client.setSkin(selectedSkinIdRef.current);
        client.respawn(name);
        setMode('playing');
      } else {
        handleStartMultiplayer(name, serverUrlRef.current, adminPasswordRef.current, playMode);
      }
      return;
    }

    if (!engineRef.current) return;
    const state = engineRef.current.getState();
    for (const id of [...ownedIdsRef.current]) {
      engineRef.current.removePlayer(id);
    }
    if (currentPlayer && !ownedIdsRef.current.includes(currentPlayer.id)) {
      const playerIndex = state.players.findIndex((p) => p.id === currentPlayer.id);
      if (playerIndex !== -1) {
        state.players.splice(playerIndex, 1);
      }
    }
    const newPlayer = engineRef.current.addPlayer(name, false, {
      skin: selectedSkinIdRef.current || undefined,
    });
    playerIdRef.current = newPlayer.id;
    ownedIdsRef.current = [newPlayer.id];
    currentPlayerRef.current = newPlayer;
    setCurrentPlayer(newPlayer);
    setMode('playing');
  }, [currentPlayer, sessionKind, handleStartMultiplayer]);

  const handleSpectate = useCallback(() => {
    // From death screen, ESC must open main menu — not return to death UI
    spectateReturnModeRef.current = modeRef.current === 'dead' ? 'menu' : modeRef.current;
    spectateReturnPlayerIdRef.current = modeRef.current === 'dead' ? null : playerIdRef.current;
    if (!spectateTargetRef.current) {
      if (lastAliveCenterRef.current) {
        spectateTargetRef.current = { ...lastAliveCenterRef.current };
      } else {
        const player = currentPlayerRef.current;
        if (player && player.cells.length > 0) {
          let sx = 0;
          let sy = 0;
          let massSum = 0;
          for (const cell of player.cells) {
            const m = Math.max(1, cell.radius * cell.radius);
            sx += cell.x * m;
            sy += cell.y * m;
            massSum += m;
          }
          spectateTargetRef.current = { x: sx / massSum, y: sy / massSum };
        } else {
          const state = gameStateRef.current;
          spectateTargetRef.current = {
            x: (state?.worldWidth ?? gameConfig.worldWidth) / 2,
            y: (state?.worldHeight ?? gameConfig.worldHeight) / 2,
          };
        }
      }
    }
    playerIdRef.current = null;
    currentPlayerRef.current = undefined;
    setCurrentPlayer(undefined);
    setMode('spectating');
    setShowEscapeMenu(false);
    setFrozen(false);

    if (sessionKindRef.current === 'multiplayer' && mpRef.current) {
      const st = spectateTargetRef.current;
      if (st) mpRef.current.sendInput(st.x, st.y);
    }
  }, [gameConfig.worldWidth, gameConfig.worldHeight]);

  const handleSpectatePick = useCallback((xOrPos: number | { x: number; y: number }, y?: number) => {
    const pos =
      typeof xOrPos === 'number'
        ? { x: xOrPos, y: y ?? 0 }
        : xOrPos;
    const state = gameStateRef.current;
    const worldW = state?.worldWidth ?? gameConfig.worldWidth;
    const worldH = state?.worldHeight ?? gameConfig.worldHeight;
    spectateTargetRef.current = {
      x: Math.max(0, Math.min(worldW, pos.x)),
      y: Math.max(0, Math.min(worldH, pos.y)),
    };
    if (modeRef.current === 'menu' || modeRef.current === 'dead') {
      if (modeRef.current === 'menu') {
        if (sessionKindRef.current === 'multiplayer' && mpRef.current) {
          mpRef.current.sendInput(spectateTargetRef.current.x, spectateTargetRef.current.y);
        } else {
          handleSpectateClassic();
        }
      } else {
        handleSpectate();
      }
    }
  }, [handleSpectate, handleSpectateClassic, gameConfig.worldWidth, gameConfig.worldHeight]);

  const handleBackToMenu = useCallback(() => {
    const keptName = playerNameRef.current || menuName;
    // From death / play: keep multiplayer world + chat as spectator under main menu
    if (sessionKindRef.current === 'multiplayer' && mpRef.current) {
      menuOverLiveRef.current = true;
      if (lastAliveCenterRef.current) {
        spectateTargetRef.current = { ...lastAliveCenterRef.current };
      }
      mpRef.current.enterSpectate();
      const st = spectateTargetRef.current;
      if (st) mpRef.current.sendInput(st.x, st.y);
      playerIdRef.current = null;
      currentPlayerRef.current = undefined;
      setCurrentPlayer(undefined);
      ownedIdsRef.current = [];
      setMode('menu');
      setShowEscapeMenu(false);
      setConnectionError(null);
      setIsConnecting(false);
      setMenuName(keptName);
      playerNameRef.current = keptName;
      peakMassRef.current = 0;
      setFrozen(false);
      soloFightHudKeyRef.current = '';
      setSoloFightHud(null);
      setChatMention(null);
      spectateReturnModeRef.current = 'menu';
      spectateReturnPlayerIdRef.current = null;
      return;
    }
    if (sessionKindRef.current === 'multiplayer') {
      menuOverLiveRef.current = false;
      disconnectMultiplayer();
      startMenuEngine();
    } else if (playerIdRef.current && engineRef.current) {
      const state = engineRef.current.getState();
      const playerIndex = state.players.findIndex((p) => p.id === playerIdRef.current);
      if (playerIndex !== -1) {
        state.players.splice(playerIndex, 1);
      }
    }
    playerIdRef.current = null;
    currentPlayerRef.current = undefined;
    setCurrentPlayer(undefined);
    setMode('menu');
    setShowEscapeMenu(false);
    setConnectionError(null);
    setIsConnecting(false);
    setSessionKind('solo');
    sessionKindRef.current = 'solo';
    setMenuName(keptName);
    playerNameRef.current = keptName;
    peakMassRef.current = 0;
    setChatOpen(false);
    setFrozen(false);
    soloFightHudKeyRef.current = '';
    setSoloFightHud(null);
    spectateTargetRef.current = null;
    ownedIdsRef.current = [];
    setChatMention(null);
  }, [disconnectMultiplayer, startMenuEngine, menuName]);

  const handleBackToMenuRef = useRef(handleBackToMenu);
  handleBackToMenuRef.current = handleBackToMenu;

  const handleResume = useCallback(() => {
    const trimmed = menuName.trim().slice(0, 15);
    if (trimmed) {
      handleUpdateName(trimmed);
    }
    setShowEscapeMenu(false);
  }, [menuName, handleUpdateName]);

  const handleSendChat = useCallback((text: string) => {
    mpRef.current?.sendChat(text);
  }, []);

  const handleOpenAdminSettings = useCallback(async ({ name, password }: { name: string; password: string }) => {
    adminSettingsNameRef.current = name;
    adminPasswordRef.current = password;
    setAdminSettingsError(null);
    setAdminSaveNotice(null);
    setAdminSettingsSaving(true);
    try {
      const settings = await requestRemoteAdminSettings(
        resolveServerUrl(),
        name,
        'get',
        undefined,
        password,
        'classic'
      );
      const clean = sanitizeGameplayConfig(settings);
      setGameConfig(clean);
      setDraftConfig(clean);
    } catch (error) {
      setAdminSettingsError(error instanceof Error ? error.message : 'Не удалось загрузить настройки сервера');
    } finally {
      setAdminSettingsSaving(false);
    }
    setShowAdminSettings(true);
  }, []);

  const handleDraftConfigChange = useCallback((key: keyof GameplayConfig, value: number) => {
    setDraftConfig((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleImportConfig = useCallback((text: string) => {
    try {
      const parsed = JSON.parse(text) as GameplayConfig;
      setDraftConfig(sanitizeGameplayConfig(parsed));
      setAdminSettingsError(null);
      setAdminSaveNotice(null);
    } catch {
      setAdminSettingsError('Не удалось прочитать JSON настроек');
    }
  }, []);

  const handleExportConfig = useCallback(() => {
    const blob = new Blob([JSON.stringify(draftConfig, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'agar-settings.json';
    link.click();
    URL.revokeObjectURL(url);
  }, [draftConfig]);

  const handleSaveAdminSettings = useCallback(async () => {
    const clean = sanitizeGameplayConfig(draftConfig);
    setAdminSettingsSaving(true);
    setAdminSettingsError(null);
    setAdminSaveNotice(null);
    try {
      const settings = await requestRemoteAdminSettings(
        resolveServerUrl(),
        adminSettingsNameRef.current,
        'update',
        clean,
        adminPasswordRef.current,
        'classic'
      );
      const synced = sanitizeGameplayConfig(settings);
      setGameConfig(synced);
      setDraftConfig(synced);
      setAdminSaveNotice('Сохранено. Панель остаётся открытой — можно править дальше.');
    } catch (error) {
      setAdminSettingsError(error instanceof Error ? error.message : 'Не удалось сохранить настройки');
    } finally {
      setAdminSettingsSaving(false);
    }
  }, [draftConfig]);

  const handleSelectSkin = useCallback((skin: SkinInfo | null) => {
    const id = skin?.id ?? null;
    setSelectedSkinId(id);
    saveSelectedSkinId(id);
    selectedSkinIdRef.current = id;
    setShowSkinPicker(false);
    if (sessionKindRef.current === 'multiplayer' && mpRef.current) {
      mpRef.current.setSkin(id);
      mpRef.current.rename(playerNameRef.current, adminPasswordRef.current, id);
      mpRef.current.syncProfile({
        deviceId: deviceIdRef.current,
        fingerprint: fingerprintRef.current,
        lastNick: playerNameRef.current,
        skinId: id,
        prefs: playerPrefs as unknown as Record<string, unknown>,
      });
    }
    for (const oid of ownedIdsRef.current) {
      engineRef.current?.updatePlayerSkin(oid, id || undefined);
    }
  }, [playerPrefs]);

  const acknowledgeLevelReward = useCallback((level: number) => {
    acknowledgedLevelRewardsRef.current.add(level);
    playStartLevelRef.current = Math.max(playStartLevelRef.current ?? 0, level);
    setLevelRewardQueue((queue) => queue.filter((item) => item !== level));
    setQuestView((view) =>
      view
        ? {
            ...view,
            pendingLevelRewards: (view.pendingLevelRewards ?? []).filter((item) => item !== level),
          }
        : view
    );
    const wsUrl = new URL(resolveServerUrl());
    wsUrl.protocol = wsUrl.protocol === 'wss:' ? 'https:' : 'http:';
    wsUrl.pathname = '/api/level-rewards/ack';
    wsUrl.search = '';
    void fetch(wsUrl.toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceIdRef.current, level }),
    });
  }, []);

  const buyShopSkin = useCallback(async (skin: SkinInfo) => {
    const wsUrl = new URL(resolveServerUrl());
    wsUrl.protocol = wsUrl.protocol === 'wss:' ? 'https:' : 'http:';
    wsUrl.pathname = '/api/shop/buy';
    wsUrl.search = '';
    const response = await fetch(wsUrl.toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceIdRef.current, skinId: skin.id }),
    });
    const body = await response.json() as { error?: string; quest?: QuestPublicView };
    if (!response.ok) throw new Error(body.error || 'Не удалось купить скин');
    if (body.quest) setQuestView(body.quest);
    await refreshCustomSkins();
  }, [refreshCustomSkins]);

  const handleMentionNick = useCallback((name: string) => {
    if (sessionKindRef.current !== 'multiplayer') return;
    setChatMention(`${name}: `);
    setChatOpen(true);
  }, []);

  const handleOpenPrivateChat = useCallback((name: string) => {
    if (sessionKindRef.current !== 'multiplayer') return;
    if (name.trim().toLocaleLowerCase() === playerNameRef.current.trim().toLocaleLowerCase()) return;
    setPrivateChats((prev) => prev[name] ? prev : { ...prev, [name]: [] });
    setOpenPrivateWith(name);
    setChatOpen(true);
  }, []);

  const handleSendCoords = useCallback(() => {
    if (showEscapeMenuRef.current || chatOpenRef.current) return;
    if (sessionKindRef.current !== 'multiplayer') return;
    const m = modeRef.current;
    if (m !== 'playing' && m !== 'dead' && m !== 'spectating') return;
    const state = gameStateRef.current;
    const you = currentPlayerRef.current;
    let x = spectateTargetRef.current?.x;
    let y = spectateTargetRef.current?.y;
    if (you && you.cells.length > 0) {
      let sx = 0;
      let sy = 0;
      let massSum = 0;
      for (const cell of you.cells) {
        const mass = Math.max(1, cell.radius * cell.radius);
        sx += cell.x * mass;
        sy += cell.y * mass;
        massSum += mass;
      }
      x = sx / massSum;
      y = sy / massSum;
    }
    if (!state || x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) {
      return;
    }
    const label = getSectorLabelAt(x, y, state.worldWidth, state.worldHeight);
    mpRef.current?.sendChat(label);
  }, []);

  const handleMultibox = useCallback(() => {
    if (showEscapeMenuRef.current || chatOpenRef.current) return;
    if (modeRef.current !== 'playing') return;
    if (playModeRef.current === 'soloFight') return; // дуэль 1v1 — без мультибокса
    if (sessionKindRef.current === 'multiplayer') {
      const owned = ownedIdsRef.current;
      if (owned.length < 2) {
        mpRef.current?.multiboxSpawn();
      } else {
        mpRef.current?.multiboxSwitch();
      }
      return;
    }
    // Solo: max 2 boxes
    if (!engineRef.current || !playerIdRef.current) return;
    const engine = engineRef.current;
    const state = engine.getState();
    const owned = ownedIdsRef.current.filter((id) =>
      state.players.some((p) => p.id === id && p.cells.length > 0)
    );
    if (owned.length === 0 && playerIdRef.current) {
      ownedIdsRef.current = [playerIdRef.current];
    }
    const liveOwned = ownedIdsRef.current.filter((id) =>
      state.players.some((p) => p.id === id && p.cells.length > 0)
    );
    ownedIdsRef.current = liveOwned.length > 0 ? liveOwned : [playerIdRef.current];

    if (ownedIdsRef.current.length < 2) {
      const primary = state.players.find((p) => p.id === playerIdRef.current);
      if (!primary || primary.cells.length === 0) return;
      const box = engine.addPlayer(primary.name, false, {
        color: primary.color,
        skin: primary.skin || selectedSkinIdRef.current || undefined,
      });
      ownedIdsRef.current = [...ownedIdsRef.current, box.id];
      playerIdRef.current = box.id;
      currentPlayerRef.current = box;
      setCurrentPlayer(box);
      return;
    }
    const idx = ownedIdsRef.current.indexOf(playerIdRef.current);
    const next = ownedIdsRef.current[(idx + 1) % ownedIdsRef.current.length];
    const nextPlayer = state.players.find((p) => p.id === next && p.cells.length > 0);
    if (!nextPlayer) return;
    playerIdRef.current = nextPlayer.id;
    currentPlayerRef.current = nextPlayer;
    setCurrentPlayer(nextPlayer);
  }, []);

  const handlePlayerPrefsChange = useCallback((next: PlayerPrefs) => {
    setPlayerPrefs(next);
    savePlayerPrefs(next);
    if (sessionKindRef.current === 'multiplayer' && mpRef.current && deviceIdRef.current) {
      mpRef.current.syncProfile({
        deviceId: deviceIdRef.current,
        fingerprint: fingerprintRef.current,
        lastNick: playerNameRef.current || menuName,
        skinId: selectedSkinIdRef.current,
        prefs: next as unknown as Record<string, unknown>,
      });
    }
  }, [menuName]);

  const handleDownloadDb = useCallback(async () => {
    setAdminSettingsError(null);
    try {
      if (mpRef.current && isAdminRef.current) {
        mpRef.current.adminDownloadDb();
        return;
      }
      const json = await requestRemoteAdminDbDownload(
        resolveServerUrl(),
        adminSettingsNameRef.current || menuName,
        adminPasswordRef.current || menuPassword
      );
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `agarva-db-${Date.now()}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setAdminSaveNotice('База данных скачана');
    } catch (error) {
      setAdminSettingsError(error instanceof Error ? error.message : 'Не удалось скачать БД');
    }
  }, [menuName, menuPassword]);

  const handleUploadDb = useCallback(async (text: string) => {
    setAdminSettingsError(null);
    try {
      if (mpRef.current && isAdminRef.current) {
        mpRef.current.adminUploadDb(text);
        return;
      }
      const message = await requestRemoteAdminDbUpload(
        resolveServerUrl(),
        adminSettingsNameRef.current || menuName,
        text,
        adminPasswordRef.current || menuPassword
      );
      setAdminSaveNotice(message);
    } catch (error) {
      setAdminSettingsError(error instanceof Error ? error.message : 'Не удалось загрузить БД');
    }
  }, [menuName, menuPassword]);

  const handleWipeDatabase = useCallback(async () => {
    setAdminSettingsError(null);
    try {
      const wsUrl = new URL(resolveServerUrl());
      wsUrl.protocol = wsUrl.protocol === 'wss:' ? 'https:' : 'http:';
      wsUrl.pathname = '/api/admin/wipe';
      wsUrl.search = '';
      const response = await fetch(wsUrl.toString(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          adminNick: adminSettingsNameRef.current || menuName,
          adminPassword: adminPasswordRef.current || menuPassword,
          confirmation: 'confirm',
        }),
      });
      const body = await response.json() as { error?: string; message?: string };
      if (!response.ok) throw new Error(body.error || 'Не удалось очистить базу');
      setSelectedSkinId(null);
      selectedSkinIdRef.current = null;
      saveSelectedSkinId(null);
      setAdminSaveNotice(body.message || 'База данных очищена');
    } catch (error) {
      setAdminSettingsError(error instanceof Error ? error.message : 'Не удалось очистить базу');
    }
  }, [menuName, menuPassword]);

  const handleRestartClassic = useCallback(() => {
    setAdminSettingsError(null);
    if (!mpRef.current || !isAdminRef.current) {
      setAdminSettingsError('Перезагрузка Classic доступна только в активном подключении администратора');
      return;
    }
    mpRef.current.adminRestartClassic();
  }, []);

  const handleGetTelegramBotLogs = useCallback(() => {
    setAdminSettingsError(null);
    if (!mpRef.current || !isAdminRef.current) {
      setAdminSettingsError('Логи доступны только в активном подключении администратора');
      return;
    }
    mpRef.current.adminGetBotLogs();
  }, []);

  const showMenuOverlay = mode === 'menu' || (mode === 'playing' && showEscapeMenu);
  const menuOverLive = mode === 'menu' && sessionKind === 'multiplayer' && !!mpRef.current;
  // One always-on menu socket receives atomic occupancy for every room.
  const lobbyStats = useLobbySnapshot(showMenuOverlay);
  const modeTops = useModeTops(showMenuOverlay);
  const roomStats = lobbyStats[playMode];
  const adminKeysEnabled = isAdmin && mode === 'playing' && !showEscapeMenu;
  const gameplayKeysEnabled = mode === 'playing' && !showEscapeMenu;
  const hudScale = hudSizeScale(playerPrefs.hudSize);
  const levelSkinRewards: Record<number, SkinInfo[]> = {};
  for (const [levelText, skin] of Object.entries(LEVEL_SKIN_REWARDS)) {
    const level = Number(levelText);
    levelSkinRewards[level] = [{ ...skin, url: resolveSkinUrl(skin.id) ?? '' }];
  }
  for (const skin of customSkins) {
    if (skin.kind !== 'level' || !skin.level) continue;
    (levelSkinRewards[skin.level] ??= []).push(skin);
  }

  if (!ready || !hudState) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white text-2xl">Загрузка...</div>
      </div>
    );
  }

  const deadPlayerStub: Player | undefined =
    mode === 'dead'
      ? {
          id: 'dead',
          name: playerNameRef.current,
          cells: [],
          color: '#888',
          score: lastScore,
          isBot: false,
          targetX: 0,
          targetY: 0,
          lastSplit: 0,
          lastEject: 0,
        }
      : undefined;

  return (
    <div className="relative overflow-hidden">
      <GameCanvas
        engineRef={engineRef}
        gameStateRef={gameStateRef}
        currentPlayerRef={currentPlayerRef}
        playerIdRef={playerIdRef}
        sessionKindRef={sessionKindRef}
        mpRenderRef={mpRenderRef}
        spectateTargetRef={spectateTargetRef}
        isSpectating={mode === 'spectating' || menuOverLive}
        isPaused={showEscapeMenu}
        inputBlocked={
          showAdminSettings ||
          showSkinPicker ||
          showPlayerSettings ||
          showEscapeMenu ||
          (mode === 'menu' && !menuOverLive)
        }
        onMouseMove={handleMouseMove}
        onSplit={handleSplit}
        onEject={handleEject}
        onFreeze={handleFreeze}
        onAddMass={handleAddMass}
        onSpawnVirus={handleSpawnVirus}
        onMinimapTeleport={handleMinimapTeleport}
        onResetStarter={handleResetStarter}
        onForceMerge={handleForceMerge}
        onKickAt={handleKickAt}
        onSpawnBot={handleSpawnBot}
        onSkipQuest={handleSkipQuest}
        adminKeysEnabled={adminKeysEnabled}
        gameplayKeysEnabled={gameplayKeysEnabled}
        onSpectateMove={mode === 'spectating' ? handleSpectatePick : undefined}
        onPerfSample={setFps}
        config={gameConfig}
        skinUrl={selectedSkinUrl}
        prefs={playerPrefs}
        frozen={frozen && mode === 'playing'}
        ownedIdsRef={ownedIdsRef}
        onMultibox={handleMultibox}
        onSendCoords={handleSendCoords}
        onWorldPointerDown={() => {
          if (chatOpenRef.current) {
            setChatOpen(false);
            setChatFocused(false);
          }
        }}
        onToggleMobileChat={() => {
          if (sessionKindRef.current === 'multiplayer') setChatOpen((open) => !open);
        }}
        centerLeader={centerLeader}
      />

      {showMenuOverlay && (
        <StartScreen
          name={menuName}
          onNameChange={setMenuName}
          password={menuPassword}
          onPasswordChange={setMenuPassword}
          playMode={playMode}
          onPlayModeChange={setPlayMode}
          onStart={handleStartMultiplayer}
          onSpectate={handleSpectateClassic}
          spectateDisabled={mode === 'playing' && playMode === connectedPlayMode}
          escapeOverlay={mode === 'playing' && showEscapeMenu}
          activePlayMode={sessionKind === 'multiplayer' ? connectedPlayMode : undefined}
          onResume={handleResume}
          onAdminSettings={handleOpenAdminSettings}
          onOpenSkins={() => setShowSkinPicker(true)}
          onOpenSettings={() => setShowPlayerSettings(true)}
          onToggleFullscreen={toggleFullscreen}
          connectionError={connectionError}
          isConnecting={isConnecting}
          roomPlayers={roomStats.players}
          roomSpectators={roomStats.spectators}
          roomBlue={roomStats.blue}
          roomRed={roomStats.red}
          roomBlueMembers={roomStats.blueMembers}
          roomRedMembers={roomStats.redMembers}
          lobbyStats={lobbyStats}
          modeTops={modeTops.tops}
          weeklyTopEndsAt={modeTops.weeklyEndsAt}
          weeklyTopPrizes={weeklyTopPrizes}
          skinPreviewUrl={selectedSkinUrl}
          accountLogin={accountLogin}
          registerError={registerError}
          registerBusy={registerBusy}
          loginError={loginError}
          loginBusy={loginBusy}
          passwordResetError={passwordResetError}
          passwordResetNotice={passwordResetNotice}
          passwordResetBusy={passwordResetBusy}
          passwordResetCodeSent={passwordResetCodeSent}
          questLevel={questView?.level ?? 1}
          questXpIntoLevel={questView?.xpIntoLevel ?? 0}
          questXpPerLevel={questView?.xpPerLevel ?? 100}
          questAgarviki={questView?.agarviki ?? 0}
          questTitle={questView?.title ?? 'Задание загружается…'}
          questProgressText={
            questProgressText ?? 'Сыграйте, чтобы прогресс пошёл'
          }
          showQuestHud={playerPrefs.showQuestHud}
          onToggleShowQuestHud={(next) => {
            const prefs = sanitizePlayerPrefs({ ...playerPrefs, showQuestHud: next });
            setPlayerPrefs(prefs);
            savePlayerPrefs(prefs);
          }}
          claimedLevelRewards={questView?.claimedLevelRewards ?? []}
          levelSkinRewards={levelSkinRewards}
          telegramChannelUrl={telegramChannelUrl}
          onRegisterAccount={(login, password) => {
            setRegisterBusy(true);
            setRegisterError(null);
            const ids = getOrCreateDeviceId();
            deviceIdRef.current = ids.deviceId;
            fingerprintRef.current = ids.fingerprint;
            if (mpRef.current) {
              mpRef.current.setDeviceIdentity(ids.deviceId, ids.fingerprint);
              mpRef.current.registerAccount(login, password);
              return;
            }
            const ws = new WebSocket(resolveServerUrl());
            ws.onopen = () => {
              ws.send(JSON.stringify({
                type: 'registerAccount',
                deviceId: ids.deviceId,
                fingerprint: ids.fingerprint,
                login,
                password,
              }));
            };
            ws.onmessage = (ev) => {
              try {
                const msg = JSON.parse(String(ev.data));
                if (msg.type === 'registerAccountResult') {
                  setRegisterBusy(false);
                  if (!msg.ok) setRegisterError(msg.message);
                  else if (msg.accountLogin) {
                    setAccountLogin(msg.accountLogin);
                    try { localStorage.setItem('agarvaAccountLogin', msg.accountLogin); } catch {}
                  }
                  ws.close();
                }
              } catch {}
            };
            ws.onerror = () => {
              setRegisterBusy(false);
              setRegisterError('Ошибка соединения');
            };
          }}
          onLoginAccount={(login, password) => {
            setLoginBusy(true);
            setLoginError(null);
            const ids = getOrCreateDeviceId();
            deviceIdRef.current = ids.deviceId;
            fingerprintRef.current = ids.fingerprint;
            if (mpRef.current) {
              mpRef.current.setDeviceIdentity(ids.deviceId, ids.fingerprint);
              mpRef.current.loginAccount(login, password);
              return;
            }
            const ws = new WebSocket(resolveServerUrl());
            ws.onopen = () => {
              ws.send(JSON.stringify({
                type: 'loginAccount',
                deviceId: ids.deviceId,
                fingerprint: ids.fingerprint,
                login,
                password,
              }));
            };
            ws.onmessage = (ev) => {
              try {
                const msg = JSON.parse(String(ev.data));
                if (msg.type === 'loginAccountResult') {
                  setLoginBusy(false);
                  if (!msg.ok) setLoginError(msg.message);
                  else if (msg.accountLogin) {
                    setAccountLogin(msg.accountLogin);
                    try { localStorage.setItem('agarvaAccountLogin', msg.accountLogin); } catch {}
                  }
                  ws.close();
                }
              } catch {}
            };
            ws.onerror = () => {
              setLoginBusy(false);
              setLoginError('Ошибка соединения');
            };
          }}
          onRequestPasswordReset={(login) => {
            setPasswordResetBusy(true);
            setPasswordResetError(null);
            setPasswordResetNotice(null);
            setPasswordResetCodeSent(false);
            if (mpRef.current) {
              mpRef.current.requestPasswordReset(login);
              return;
            }
            const ws = new WebSocket(resolveServerUrl());
            ws.onopen = () => ws.send(JSON.stringify({ type: 'requestPasswordReset', login, deviceId: deviceIdRef.current || undefined }));
            ws.onmessage = (ev) => {
              try {
                const msg = JSON.parse(String(ev.data));
                if (msg.type === 'passwordResetResult' && msg.action === 'request') {
                  setPasswordResetBusy(false);
                  if (msg.ok) setPasswordResetCodeSent(true);
                  else setPasswordResetError(msg.message);
                  ws.close();
                }
              } catch {}
            };
            ws.onerror = () => {
              setPasswordResetBusy(false);
              setPasswordResetError('Ошибка соединения');
            };
          }}
          onConfirmPasswordReset={(login, code, newPassword) => {
            setPasswordResetBusy(true);
            setPasswordResetError(null);
            setPasswordResetNotice(null);
            if (mpRef.current) {
              mpRef.current.confirmPasswordReset(login, code, newPassword);
              return;
            }
            const ws = new WebSocket(resolveServerUrl());
            ws.onopen = () => ws.send(JSON.stringify({ type: 'confirmPasswordReset', login, code, newPassword }));
            ws.onmessage = (ev) => {
              try {
                const msg = JSON.parse(String(ev.data));
                if (msg.type === 'passwordResetResult' && msg.action === 'confirm') {
                  setPasswordResetBusy(false);
                  if (msg.ok) {
                    setPasswordResetCodeSent(false);
                    setPasswordResetNotice(msg.message);
                  } else {
                    setPasswordResetError(msg.message);
                  }
                  ws.close();
                }
              } catch {}
            };
            ws.onerror = () => {
              setPasswordResetBusy(false);
              setPasswordResetError('Ошибка соединения');
            };
          }}
        />
      )}

      <PlayerSettingsPanel
        open={showPlayerSettings}
        prefs={playerPrefs}
        onChange={handlePlayerPrefsChange}
        onClose={() => setShowPlayerSettings(false)}
      />

      <AdminSettingsPanel
        open={showAdminSettings}
        settings={draftConfig}
        sourceLabel="server"
        isSaving={adminSettingsSaving}
        error={adminSettingsError}
        saveNotice={adminSaveNotice}
        onClose={() => {
          setShowAdminSettings(false);
          setAdminSaveNotice(null);
        }}
        onChange={handleDraftConfigChange}
        onSave={handleSaveAdminSettings}
        onImport={handleImportConfig}
        onExport={handleExportConfig}
        onDownloadDb={handleDownloadDb}
        onUploadDb={handleUploadDb}
        onWipeDatabase={handleWipeDatabase}
        onRestartClassic={handleRestartClassic}
        onGetBotLogs={handleGetTelegramBotLogs}
        botLogs={telegramBotLogs}
        customSkins={customSkins}
        telegramChannelUrl={telegramChannelUrl}
        weeklyTopPrizes={weeklyTopPrizes}
        onSaveWeeklyTopPrizes={async (prizes) => {
          const wsUrl = new URL(resolveServerUrl());
          wsUrl.protocol = wsUrl.protocol === 'wss:' ? 'https:' : 'http:';
          wsUrl.pathname = '/api/admin/public-config'; wsUrl.search = '';
          const response = await fetch(wsUrl.toString(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
            adminNick: adminSettingsNameRef.current || menuName, adminPassword: adminPasswordRef.current || menuPassword,
            telegramChannelUrl, weeklyTopPrizes: prizes,
          }) });
          const body = await response.json() as { error?: string; weeklyTopPrizes?: Record<PlayRoomMode, number> };
          if (!response.ok) throw new Error(body.error || 'Не удалось сохранить награды');
          if (body.weeklyTopPrizes) setWeeklyTopPrizes(body.weeklyTopPrizes);
          setAdminSaveNotice('Недельные награды сохранены');
        }}
        onSaveTelegramChannel={async (url) => {
          const wsUrl = new URL(resolveServerUrl());
          wsUrl.protocol = wsUrl.protocol === 'wss:' ? 'https:' : 'http:';
          wsUrl.pathname = '/api/admin/public-config';
          wsUrl.search = '';
          const response = await fetch(wsUrl.toString(), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              adminNick: adminSettingsNameRef.current || menuName,
              adminPassword: adminPasswordRef.current || menuPassword,
              telegramChannelUrl: url,
            }),
          });
          const body = await response.json() as { error?: string; telegramChannelUrl?: string };
          if (!response.ok) throw new Error(body.error || 'Не удалось сохранить канал');
          setTelegramChannelUrl(body.telegramChannelUrl ?? '');
          setAdminSaveNotice('Ссылка на Telegram-канал сохранена');
        }}
        onUploadSkin={async (file, name, kind, price, level) => {
          setAdminSettingsError(null);
          try {
            await uploadCustomSkin(
              file,
              name,
              adminSettingsNameRef.current || menuName,
              adminPasswordRef.current || menuPassword,
              kind,
              price,
              level
            );
            await refreshCustomSkins();
            setAdminSaveNotice(kind === 'shop' ? 'Скин добавлен в магазин' : kind === 'level' ? 'Скин добавлен как награда за уровень' : 'Скин добавлен и доступен всем игрокам');
          } catch (error) {
            setAdminSettingsError(error instanceof Error ? error.message : 'Не удалось добавить скин');
            throw error;
          }
        }}
        onDeleteSkin={async (skin) => {
          setAdminSettingsError(null);
          try {
            await deleteCustomSkin(
              skin,
              adminSettingsNameRef.current || menuName,
              adminPasswordRef.current || menuPassword
            );
            if (selectedSkinIdRef.current === skin.id) {
              setSelectedSkinId(null);
              selectedSkinIdRef.current = null;
              saveSelectedSkinId(null);
            }
            await refreshCustomSkins();
            setAdminSaveNotice('Скин удалён');
          } catch (error) {
            setAdminSettingsError(error instanceof Error ? error.message : 'Не удалось удалить скин');
            throw error;
          }
        }}
      />

      <SkinPicker
        open={showSkinPicker}
        selectedId={selectedSkinId}
        unlockedSkinIds={questView?.unlockedSkinIds ?? []}
        agarviki={questView?.agarviki ?? 0}
        onBuy={buyShopSkin}
        onSelect={handleSelectSkin}
        onClose={() => setShowSkinPicker(false)}
      />

      {mode === 'menu' && levelRewardQueue.length > 0 && (() => {
        const level = levelRewardQueue[0];
        const skins = levelSkinRewards[level] ?? [];
        return (
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/95 p-5 pointer-events-auto">
            <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-amber-300/40 bg-gradient-to-b from-amber-500/20 to-slate-950 p-8 text-center shadow-2xl">
              <button
                type="button"
                aria-label="Закрыть"
                onClick={() => acknowledgeLevelReward(level)}
                className="absolute right-4 top-4 rounded-full bg-white/10 px-3 py-1 text-xl text-white hover:bg-white/20"
              >×</button>
              <div className="text-amber-200 text-sm font-bold uppercase tracking-[0.2em]">Новый уровень</div>
              <h2 className="mt-2 text-4xl font-black text-white">Уровень {level}!</h2>
              <div className="mt-5 text-2xl font-bold text-amber-300">+10 агарвиков</div>
              {skins.length > 0 && (
                <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {skins.map((skin) => (
                    <div key={skin.id}>
                      {skin.url && <img src={skin.url} alt={skin.name} className="mx-auto h-28 w-28 rounded-full border-4 border-amber-200 object-cover shadow-xl" />}
                      <div className="mt-3 text-lg font-bold text-white">Скин «{skin.name}»</div>
                      <div className="text-sm text-slate-300">Добавлен в личные скины</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {(mode !== 'menu' || menuOverLive) && !showEscapeMenu && !isTouchDevice && (
        <div
          className="contents"
          style={{
            // scale applied via child wrappers
          }}
        >
          <div style={{ zoom: hudScale } as React.CSSProperties}>
            {(connectedPlayMode === 'duoFight' || connectedPlayMode === 'trioFight') && teamFightHud ? (
              <TeamFightHud {...teamFightHud} />
            ) : (connectedPlayMode === 'soloFight' || playMode === 'soloFight') && soloFightHud ? (
              <SoloFightHud {...soloFightHud} spectators={liveRoomSpectators} />
            ) : (
              <Leaderboard
                entries={leaderboard}
                currentPlayerName={currentPlayer?.name || playerNameRef.current}
                onClickNick={sessionKind === 'multiplayer' ? handleMentionNick : undefined}
                onPrivateMessage={sessionKind === 'multiplayer' ? handleOpenPrivateChat : undefined}
                spectators={liveRoomSpectators}
              />
            )}
          </div>
          {hudState && (
            <div style={{ zoom: hudScale } as React.CSSProperties}>
              <Minimap
                gameState={hudState}
                currentPlayer={currentPlayer}
                canTeleport={isAdmin && mode === 'playing'}
                spectateTarget={
                  mode === 'spectating' || menuOverLive ? spectateTargetRef.current : null
                }
                onHoverWorld={(pos) => {
                  minimapHoverRef.current = pos;
                }}
                onPickWorld={
                  mode === 'spectating' || mode === 'dead' || menuOverLive
                    ? handleSpectatePick
                    : undefined
                }
              />
            </div>
          )}
          {sessionKind === 'multiplayer' && isAdmin && mode === 'playing' && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-amber-900/70 text-amber-200 text-xs px-3 py-1 rounded select-none">
              ADMIN
            </div>
          )}
        </div>
      )}

      {sessionKind === 'multiplayer' && (mode !== 'menu' || menuOverLive) && !showEscapeMenu && (
        <div style={{ zoom: hudScale } as React.CSSProperties}>
          <ChatPanel
            messages={chatMessages}
            privateChats={privateChats}
            visible={
              mode === 'playing' ||
              mode === 'dead' ||
              mode === 'spectating' ||
              menuOverLive
            }
            inputOpen={
              chatOpen &&
              (mode === 'playing' || mode === 'dead' || mode === 'spectating') &&
              !showEscapeMenu
            }
            onCloseInput={() => {
              setChatOpen(false);
              setChatFocused(false);
            }}
            onSend={handleSendChat}
            onSendPrivate={(name, text) => {
              if (name.trim().toLocaleLowerCase() !== playerNameRef.current.trim().toLocaleLowerCase()) {
                mpRef.current?.sendPrivateMessage(name, text);
              }
            }}
            onInputFocusChange={setChatFocused}
            onClickNick={handleMentionNick}
            onPrivateMessage={handleOpenPrivateChat}
            mentionPrefix={chatMention}
            onMentionConsumed={() => setChatMention(null)}
            openPrivateWith={openPrivateWith}
            onPrivateOpened={() => setOpenPrivateWith(null)}
            ownName={playerNameRef.current}
            mobileLayout={isTouchDevice ? playerPrefs.mobileControls.chat : undefined}
          />
        </div>
      )}

      {mode === 'playing' && !showEscapeMenu && (
        <div style={{ zoom: hudScale } as React.CSSProperties}>
          <HUD
            player={currentPlayer}
            fps={fps}
            pingMs={pingMs}
            onRespawn={handleRespawn}
            showQuest={!!accountLogin && playerPrefs.showQuestHud && !!questView}
            questTitle={questView?.title}
            questProgressText={
              questProgressText
            }
          />
        </div>
      )}

      {mode === 'dead' && (
        <HUD
          player={currentPlayer && currentPlayer.cells.length === 0 ? currentPlayer : deadPlayerStub}
          fps={fps}
          pingMs={pingMs}
          onRespawn={handleRespawn}
          onSpectate={handleSpectate}
          onBackToMenu={handleBackToMenu}
        />
      )}

      {mode === 'spectating' && !isTouchDevice && (
        <div className="absolute top-4 left-4 bg-black/70 backdrop-blur-sm rounded-lg px-4 py-2 select-none">
          <div className="text-white font-bold text-lg">Режим наблюдения</div>
          <div className="text-gray-400 text-xs">
            {playMode === 'soloFight' ? 'Соло файт' : playMode === 'duoFight' ? 'Дуо файт' : playMode === 'trioFight' ? 'Трио файт' : 'Классик'} · ESC — выход
          </div>
        </div>
      )}
    </div>
  );
}
