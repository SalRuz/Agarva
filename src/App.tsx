import { useState, useEffect, useRef, useCallback } from 'react';
import { GameEngine } from './engine/GameEngine';
import { GameCanvas } from './components/GameCanvas';
import { Leaderboard } from './components/Leaderboard';
import { Minimap } from './components/Minimap';
import { StartScreen, useRoomStats } from './components/StartScreen';
import { HUD } from './components/HUD';
import { ChatPanel, type ChatLine } from './components/ChatPanel';
import { AdminSettingsPanel } from './components/AdminSettingsPanel';
import { PlayerSettingsPanel } from './components/PlayerSettingsPanel';
import { SkinPicker } from './components/SkinPicker';
import { GameState, Player } from './types/game';
import { MultiplayerClient, resolveServerUrl } from './net/MultiplayerClient';
import { HUD_HZ } from '../shared/constants';
import { cloneGameplayConfig, defaultGameplayConfig, sanitizeGameplayConfig, type GameplayConfig } from '../shared/gameConfig';
import { isAdminName } from '../shared/physics';
import { requestRemoteAdminSettings } from './net/adminSettings';
import {
  loadSelectedSkinId,
  resolveSkinUrl,
  saveSelectedSkinId,
  type SkinInfo,
} from './skins/loadSkins';
import {
  hudSizeScale,
  loadPlayerPrefs,
  savePlayerPrefs,
  type PlayerPrefs,
} from './settings/playerPrefs';

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
  const [chatFocused, setChatFocused] = useState(false);
  const [lastScore, setLastScore] = useState(0);
  const [fps, setFps] = useState<number | null>(null);
  const [pingMs, setPingMs] = useState<number | null>(null);
  const [gameConfig, setGameConfig] = useState<GameplayConfig>(() => cloneGameplayConfig(defaultGameplayConfig));
  const [draftConfig, setDraftConfig] = useState<GameplayConfig>(() => cloneGameplayConfig(defaultGameplayConfig));
  const [showAdminSettings, setShowAdminSettings] = useState(false);
  const [showPlayerSettings, setShowPlayerSettings] = useState(false);
  const [playerPrefs, setPlayerPrefs] = useState<PlayerPrefs>(() => loadPlayerPrefs());
  const [adminSettingsError, setAdminSettingsError] = useState<string | null>(null);
  const [adminSettingsSaving, setAdminSettingsSaving] = useState(false);
  const [adminSaveNotice, setAdminSaveNotice] = useState<string | null>(null);
  const [showSkinPicker, setShowSkinPicker] = useState(false);
  const [selectedSkinId, setSelectedSkinId] = useState<string | null>(() => loadSelectedSkinId());
  const selectedSkinUrl = resolveSkinUrl(selectedSkinId);
  const [menuName, setMenuName] = useState('');
  const [menuPassword, setMenuPassword] = useState('');
  const [frozen, setFrozen] = useState(false);

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
  const mpRenderRef = useRef<
    (() => { state: GameState; you: Player | undefined } | null) | null
  >(null);
  const adminSettingsNameRef = useRef('salruz');
  const adminPasswordRef = useRef<string | undefined>(undefined);
  const peakMassRef = useRef(0);
  const frozenRef = useRef(false);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

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
          if (lastAliveCenterRef.current) {
            spectateTargetRef.current = { ...lastAliveCenterRef.current };
          }
          setLastScore(Math.floor(peakMassRef.current));
          setMode('dead');
          setShowEscapeMenu(false);
          setFrozen(false);
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
    }, 1000);
    return () => clearInterval(interval);
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
      if (showAdminSettings || showSkinPicker || showPlayerSettings) return;
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
        if (spectateReturnModeRef.current === 'dead') {
          setMode('dead');
        } else {
          // Leave MP spectate back to menu
          handleBackToMenuRef.current();
        }
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [showAdminSettings, showSkinPicker, showPlayerSettings, menuName]);

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
    setChatMessages([]);
    setChatOpen(false);
    setIsAdmin(false);
    setPingMs(null);
    setFrozen(false);
    isAdminRef.current = false;
  }, []);

  const attachMpCallbacks = useCallback(
    (opts?: { spectate?: boolean }) => ({
      onWelcome: (id: string, _world: { w: number; h: number }, adminFlag?: boolean) => {
        playerIdRef.current = opts?.spectate ? null : id;
        setIsConnecting(false);
        if (opts?.spectate) {
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
          { name: msg.name, text: msg.text, t: msg.t, color: msg.color },
        ]);
      },
      onSettings: (settings: GameplayConfig) => {
        const clean = sanitizeGameplayConfig(settings);
        setGameConfig(clean);
        setDraftConfig(clean);
      },
      onState: (state: GameState, you: Player | undefined, lb: { name: string; score: number; isBot: boolean }[]) => {
        gameStateRef.current = state;
        if (you) {
          currentPlayerRef.current = you;
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
      },
      onError: (message: string) => {
        setConnectionError(message);
        setIsConnecting(false);
      },
      onStatus: (status: string) => {
        if (status === 'error' || status === 'disconnected') {
          setIsConnecting(false);
        }
      },
    }),
    []
  );

  const handleStartMultiplayer = useCallback((name: string, serverUrl: string, password?: string) => {
    setConnectionError(null);
    setIsConnecting(true);
    engineRef.current = null;
    disconnectMultiplayer();
    setShowEscapeMenu(false);

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
    setChatMessages([]);
    setFrozen(false);

    const client = new MultiplayerClient(name, attachMpCallbacks(), password);
    mpRef.current = client;
    mpRenderRef.current = () => client.getRenderState();
    client.connect(serverUrlRef.current);
  }, [disconnectMultiplayer, attachMpCallbacks]);

  const handleSpectateClassic = useCallback(() => {
    setConnectionError(null);
    setIsConnecting(true);
    engineRef.current = null;
    disconnectMultiplayer();
    setShowEscapeMenu(false);
    setSessionKind('multiplayer');
    sessionKindRef.current = 'multiplayer';
    serverUrlRef.current = resolveServerUrl();
    spectateReturnModeRef.current = 'menu';
    spectateReturnPlayerIdRef.current = null;
    setFrozen(false);

    const ww = gameConfig.worldWidth;
    const wh = gameConfig.worldHeight;
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
    mpRef.current = client;
    mpRenderRef.current = () => client.getRenderState();
    client.connect(serverUrlRef.current, { spectate: true });
  }, [disconnectMultiplayer, attachMpCallbacks, gameConfig.worldWidth, gameConfig.worldHeight, menuName]);

  const handleMouseMove = useCallback((x: number, y: number) => {
    if (showEscapeMenuRef.current || chatOpenRef.current) return;
    if (sessionKindRef.current === 'multiplayer') {
      // Always send view center (playing target OR spectate FOV)
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
    engineRef.current.updatePlayerName(playerIdRef.current, trimmed);
  }, []);

  const handleRespawn = useCallback(() => {
    const name = playerNameRef.current || currentPlayer?.name || 'Player';
    peakMassRef.current = 0;
    setFrozen(false);
    if (sessionKind === 'multiplayer') {
      const client = mpRef.current;
      if (client) {
        client.respawn(name);
        setMode('playing');
      } else {
        handleStartMultiplayer(name, serverUrlRef.current, adminPasswordRef.current);
      }
      return;
    }

    if (!engineRef.current) return;
    const state = engineRef.current.getState();
    if (currentPlayer) {
      const playerIndex = state.players.findIndex((p) => p.id === currentPlayer.id);
      if (playerIndex !== -1) {
        state.players.splice(playerIndex, 1);
      }
    }
    const newPlayer = engineRef.current.addPlayer(name);
    playerIdRef.current = newPlayer.id;
    currentPlayerRef.current = newPlayer;
    setCurrentPlayer(newPlayer);
    setMode('playing');
  }, [currentPlayer, sessionKind, handleStartMultiplayer]);

  const handleSpectate = useCallback(() => {
    spectateReturnModeRef.current = modeRef.current;
    spectateReturnPlayerIdRef.current = playerIdRef.current;
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
    // Seed camera immediately for mouse follow
    if (spectateTargetRef.current) {
      // no-op: GameCanvas reads spectateTargetRef
    }
    playerIdRef.current = null;
    currentPlayerRef.current = undefined;
    setCurrentPlayer(undefined);
    setMode('spectating');
    setShowEscapeMenu(false);
    setFrozen(false);

    // If already on MP after death, keep connection and ensure view inputs flow
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
        handleSpectateClassic();
      } else {
        handleSpectate();
      }
    }
  }, [handleSpectate, handleSpectateClassic, gameConfig.worldWidth, gameConfig.worldHeight]);

  const handleBackToMenu = useCallback(() => {
    const keptName = playerNameRef.current || menuName;
    if (sessionKindRef.current === 'multiplayer') {
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
    spectateTargetRef.current = null;
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
      const settings = await requestRemoteAdminSettings(resolveServerUrl(), name, 'get', undefined, password);
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
        adminPasswordRef.current
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
    setShowSkinPicker(false);
  }, []);

  const handlePlayerPrefsChange = useCallback((next: PlayerPrefs) => {
    setPlayerPrefs(next);
    savePlayerPrefs(next);
  }, []);

  const showMenuOverlay = mode === 'menu' || (mode === 'playing' && showEscapeMenu);
  const roomStats = useRoomStats(showMenuOverlay);
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
        isSpectating={mode === 'spectating'}
        isPaused={showEscapeMenu}
        inputBlocked={
          chatFocused ||
          chatOpen ||
          showAdminSettings ||
          showSkinPicker ||
          showPlayerSettings ||
          showEscapeMenu ||
          mode === 'menu'
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
      />

      {showMenuOverlay && (
        <StartScreen
          name={menuName}
          onNameChange={setMenuName}
          password={menuPassword}
          onPasswordChange={setMenuPassword}
          onStart={handleStartMultiplayer}
          onSpectate={mode === 'menu' ? handleSpectateClassic : undefined}
          spectateDisabled={mode === 'playing'}
          escapeOverlay={mode === 'playing' && showEscapeMenu}
          onResume={handleResume}
          onAdminSettings={handleOpenAdminSettings}
          onOpenSkins={() => setShowSkinPicker(true)}
          onOpenSettings={() => setShowPlayerSettings(true)}
          connectionError={connectionError}
          isConnecting={isConnecting}
          roomPlayers={roomStats.players}
          roomLobby={roomStats.lobby}
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
        sourceLabel="multiplayer server"
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
      />

      <SkinPicker
        open={showSkinPicker}
        selectedId={selectedSkinId}
        onSelect={handleSelectSkin}
        onClose={() => setShowSkinPicker(false)}
      />

      {mode !== 'menu' && !showEscapeMenu && (
        <div
          className="contents"
          style={{
            // scale applied via child wrappers
          }}
        >
          <div style={{ zoom: hudScale } as React.CSSProperties}>
            <Leaderboard entries={leaderboard} currentPlayerName={currentPlayer?.name || playerNameRef.current} />
          </div>
          {hudState && (
            <div style={{ zoom: hudScale } as React.CSSProperties}>
              <Minimap
                gameState={hudState}
                currentPlayer={currentPlayer}
                canTeleport={isAdmin && mode === 'playing'}
                spectateTarget={mode === 'spectating' ? spectateTargetRef.current : null}
                onHoverWorld={(pos) => {
                  minimapHoverRef.current = pos;
                }}
                onPickWorld={mode === 'spectating' || mode === 'dead' ? handleSpectatePick : undefined}
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

      {sessionKind === 'multiplayer' && mode !== 'menu' && !showEscapeMenu && (
        <div style={{ zoom: hudScale } as React.CSSProperties}>
          <ChatPanel
            messages={chatMessages}
            visible={mode === 'playing' || mode === 'dead' || mode === 'spectating'}
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

      {mode === 'spectating' && (
        <div className="absolute top-4 left-4 bg-black/70 backdrop-blur-sm rounded-lg px-4 py-2 select-none">
          <div className="text-white font-bold text-lg">Режим наблюдения</div>
          <div className="text-gray-400 text-xs">Классик · ESC — выход</div>
        </div>
      )}
    </div>
  );
}
