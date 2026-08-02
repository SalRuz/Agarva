import { useState, useEffect, useRef, useCallback } from 'react';
import { GameEngine } from './engine/GameEngine';
import { GameCanvas } from './components/GameCanvas';
import { Leaderboard } from './components/Leaderboard';
import { Minimap } from './components/Minimap';
import { StartScreen, useLobbySnapshot, type PlayRoomMode } from './components/StartScreen';
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

type GameMode = 'menu' | 'playing' | 'dead' | 'spectating';
type SessionKind = 'solo' | 'multiplayer';

export function App() {
  const [mode, setMode] = useState<GameMode>('menu');
  const [sessionKind, setSessionKind] = useState<SessionKind>('solo');
  /** Throttled snapshot for HUD / minimap / leaderboard (~8 Hz) — NOT every frame */
  const [hudState, setHudState] = useState<GameState | null>(null);
  const [currentPlayer, setCurrentPlayer] = useState<Player | undefined>();
  const [leaderboard, setLeaderboard] = useState<{ name: string; score: number; isBot: boolean }[]>([]);
  const [showEscapeMenu, setShowEscapeMenu] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [ready, setReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatLine[]>([]);
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
  const selectedSkinUrl = resolveSkinUrl(selectedSkinId);
  const [menuName, setMenuName] = useState(() => {
    try {
      return localStorage.getItem('agarvaMenuNick') || '';
    } catch {
      return '';
    }
  });
  const [menuPassword, setMenuPassword] = useState('');
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
  const preferFullscreenRef = useRef(
    (() => {
      try {
        return localStorage.getItem('agarvaPreferFullscreen') === '1';
      } catch {
        return false;
      }
    })()
  );

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
  }, []);

  useEffect(() => {
    void refreshCustomSkins();
  }, [refreshCustomSkins]);

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
        if (msg.skinId) {
          setSelectedSkinId(msg.skinId);
          saveSelectedSkinId(msg.skinId);
          selectedSkinIdRef.current = msg.skinId;
        }
        if (msg.accountLogin) {
          setAccountLogin(msg.accountLogin);
          try { localStorage.setItem('agarvaAccountLogin', msg.accountLogin); } catch {}
        }
        if (msg.prefs) {
          const prefs = sanitizePlayerPrefs(msg.prefs);
          setPlayerPrefs(prefs);
          savePlayerPrefs(prefs);
        }
      } catch {}
      try { ws.close(); } catch {}
    };
    return () => {
      closed = true;
      try { if (ws) ws.close(); } catch {}
    };
  }, []);

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
    preferFullscreenRef.current = entering;
    try {
      localStorage.setItem('agarvaPreferFullscreen', entering ? '1' : '0');
    } catch {
      /* preference remains available for this session */
    }
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
    const keepEscapeForGame = (event: KeyboardEvent) => {
      if (event.code !== 'Escape' || !preferFullscreenRef.current) return;
      const target = event.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) return;
      const opensGameMenu =
        modeRef.current === 'playing' ||
        modeRef.current === 'spectating' ||
        (modeRef.current === 'menu' && menuOverLiveRef.current);
      if (!opensGameMenu) return;
      // Intercept Escape before the browser's fullscreen shortcut. The normal
      // Escape handler below still opens/closes the in-game menu.
      event.preventDefault();
    };
    const restorePreferredFullscreen = () => {
      const fullscreenDocument = document as Document & { webkitFullscreenElement?: Element | null };
      if (
        !preferFullscreenRef.current ||
        document.fullscreenElement ||
        fullscreenDocument.webkitFullscreenElement
      ) {
        return;
      }
      const root = document.documentElement as HTMLElement & {
        webkitRequestFullscreen?: () => Promise<void> | void;
      };
      // Browsers that reserve Escape may leave fullscreen before keydown can
      // cancel it. Re-enter on the state change while the user gesture is fresh.
      requestAnimationFrame(() => {
        if (
          !preferFullscreenRef.current ||
          document.fullscreenElement ||
          fullscreenDocument.webkitFullscreenElement
        ) {
          return;
        }
        Promise.resolve(root.requestFullscreen?.() ?? root.webkitRequestFullscreen?.()).catch(() => {});
      });
    };
    window.addEventListener('keydown', keepEscapeForGame, true);
    document.addEventListener('fullscreenchange', restorePreferredFullscreen);
    document.addEventListener('webkitfullscreenchange', restorePreferredFullscreen);
    return () => {
      window.removeEventListener('keydown', keepEscapeForGame, true);
      document.removeEventListener('fullscreenchange', restorePreferredFullscreen);
      document.removeEventListener('webkitfullscreenchange', restorePreferredFullscreen);
    };
  }, []);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.code !== 'Escape') return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (chatOpenRef.current) {
        e.preventDefault();
        setChatOpen(false);
        setChatFocused(false);
        return;
      }
      if (showAdminSettings || showSkinPicker || showPlayerSettings) {
        if (e.code === 'Escape' && showSkinPicker) {
          e.preventDefault();
          setShowSkinPicker(false);
        }
        return;
      }
      if (modeRef.current === 'playing') {
        e.preventDefault();
        setShowEscapeMenu((prev) => {
          if (!prev) {
            setMenuName(playerNameRef.current || menuName);
          }
          return !prev;
        });
        return;
      }
      if (modeRef.current === 'spectating') {
        e.preventDefault();
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
        e.preventDefault();
        setPlayMode(connectedPlayMode);
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
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
          { name: msg.name, text: msg.text, t: msg.t, color: msg.color, fromTg: msg.fromTg },
        ]);
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
        accountLogin?: string;
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
        if (profile.skinId) {
          setSelectedSkinId(profile.skinId);
          saveSelectedSkinId(profile.skinId);
          selectedSkinIdRef.current = profile.skinId;
        }
        if (profile.accountLogin) {
          setAccountLogin(profile.accountLogin);
          try {
            localStorage.setItem('agarvaAccountLogin', profile.accountLogin);
          } catch {
            /* ignore */
          }
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
      onState: (state: GameState, you: Player | undefined, lb: { name: string; score: number; isBot: boolean }[], ownedIds?: string[]) => {
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
        // Use the existing socket so the server releases the old room (and
        // any fight slot) before making this session a spectator in the new one.
        if (liveClient.getRoomMode() === mode) {
          setIsConnecting(false);
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
    [disconnectMultiplayer, attachMpCallbacks, gameConfig.worldWidth, gameConfig.worldHeight, menuName, playMode]
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

  const handleMentionNick = useCallback((name: string) => {
    if (sessionKindRef.current !== 'multiplayer') return;
    setChatMention(`${name}: `);
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

  const handleWipeDatabase = useCallback(() => {
    setAdminSettingsError(null);
    if (!mpRef.current || !isAdminRef.current) {
      setAdminSettingsError('Очистка БД доступна только в активном подключении администратора');
      return;
    }
    mpRef.current.adminWipeDatabase();
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
  const roomStats = lobbyStats[playMode];
  const adminKeysEnabled = isAdmin && mode === 'playing' && !showEscapeMenu;
  const gameplayKeysEnabled = mode === 'playing' && !showEscapeMenu;
  const hudScale = hudSizeScale(playerPrefs.hudSize);

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
          soloFightTop={[]}
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
        onGetBotLogs={handleGetTelegramBotLogs}
        botLogs={telegramBotLogs}
        customSkins={customSkins}
        onUploadSkin={async (file, name) => {
          setAdminSettingsError(null);
          try {
            await uploadCustomSkin(
              file,
              name,
              adminSettingsNameRef.current || menuName,
              adminPasswordRef.current || menuPassword
            );
            await refreshCustomSkins();
            setAdminSaveNotice('Скин добавлен и доступен всем игрокам');
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
        onSelect={handleSelectSkin}
        onClose={() => setShowSkinPicker(false)}
      />

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

      {sessionKind === 'multiplayer' && (mode !== 'menu' || menuOverLive) && !showEscapeMenu && !isTouchDevice && (
        <div style={{ zoom: hudScale } as React.CSSProperties}>
          <ChatPanel
            messages={chatMessages}
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
            onInputFocusChange={setChatFocused}
            onClickNick={handleMentionNick}
            mentionPrefix={chatMention}
            onMentionConsumed={() => setChatMention(null)}
          />
        </div>
      )}

      {mode === 'playing' && !showEscapeMenu && (
        <div style={{ zoom: hudScale } as React.CSSProperties}>
          <HUD player={currentPlayer} fps={fps} pingMs={pingMs} onRespawn={handleRespawn} />
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
