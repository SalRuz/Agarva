import { useState, useEffect, useRef, useCallback } from 'react';
import { GameEngine } from './engine/GameEngine';
import { GameCanvas } from './components/GameCanvas';
import { Leaderboard } from './components/Leaderboard';
import { Minimap } from './components/Minimap';
import { StartScreen } from './components/StartScreen';
import { PauseMenu } from './components/PauseMenu';
import { HUD } from './components/HUD';
import { ChatPanel, type ChatLine } from './components/ChatPanel';
import { AdminSettingsPanel } from './components/AdminSettingsPanel';
import { SkinPicker } from './components/SkinPicker';
import { GameState, Player } from './types/game';
import { MultiplayerClient, resolveServerUrl } from './net/MultiplayerClient';
import { BOT_COUNT_SOLO, HUD_HZ } from '../shared/constants';
import { cloneGameplayConfig, defaultGameplayConfig, sanitizeGameplayConfig, type GameplayConfig } from '../shared/gameConfig';
import { isAdminName } from '../shared/physics';
import { requestRemoteAdminSettings } from './net/adminSettings';
import {
  loadSelectedSkinId,
  resolveSkinUrl,
  saveSelectedSkinId,
  type SkinInfo,
} from './skins/loadSkins';

type GameMode = 'menu' | 'playing' | 'dead' | 'spectating';
type SessionKind = 'solo' | 'multiplayer';

export function App() {
  const [mode, setMode] = useState<GameMode>('menu');
  const [sessionKind, setSessionKind] = useState<SessionKind>('solo');
  /** Throttled snapshot for HUD / minimap / leaderboard (~8 Hz) — NOT every frame */
  const [hudState, setHudState] = useState<GameState | null>(null);
  const [currentPlayer, setCurrentPlayer] = useState<Player | undefined>();
  const [leaderboard, setLeaderboard] = useState<{ name: string; score: number; isBot: boolean }[]>([]);
  const [isWPressed, setIsWPressed] = useState(false);
  const [showPauseMenu, setShowPauseMenu] = useState(false);
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
  const [adminSettingsError, setAdminSettingsError] = useState<string | null>(null);
  const [adminSettingsSaving, setAdminSettingsSaving] = useState(false);
  const [adminSettingsSource, setAdminSettingsSource] = useState<'solo' | 'multiplayer'>('solo');
  const [adminSaveNotice, setAdminSaveNotice] = useState<string | null>(null);
  const [showSkinPicker, setShowSkinPicker] = useState(false);
  const [selectedSkinId, setSelectedSkinId] = useState<string | null>(() => loadSelectedSkinId());
  const selectedSkinUrl = resolveSkinUrl(selectedSkinId);

  const engineRef = useRef<GameEngine | null>(null);
  const playerIdRef = useRef<string | null>(null);
  const mpRef = useRef<MultiplayerClient | null>(null);
  const sessionKindRef = useRef<SessionKind>('solo');
  const serverUrlRef = useRef(resolveServerUrl());
  const gameStateRef = useRef<GameState | null>(null);
  const currentPlayerRef = useRef<Player | undefined>(undefined);
  const modeRef = useRef<GameMode>('menu');
  const showPauseMenuRef = useRef(false);
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

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    showPauseMenuRef.current = showPauseMenu;
  }, [showPauseMenu]);

  useEffect(() => {
    chatOpenRef.current = chatOpen;
  }, [chatOpen]);

  useEffect(() => {
    isAdminRef.current = isAdmin;
  }, [isAdmin]);

  const startSoloEngine = useCallback(() => {
    const engine = new GameEngine({
      botCount: gameConfig.botCountSolo || BOT_COUNT_SOLO,
      foodCount: gameConfig.foodCountSolo,
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
    startSoloEngine();
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
          setLastScore(player.score);
          setMode('dead');
          setShowPauseMenu(false);
        }
        setPingMs(null);
      } else {
        const state = gameStateRef.current;
        if (!state) return;
        setHudState(state);
        const player = currentPlayerRef.current;
        setCurrentPlayer(player);
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
    const handleKeyDown = (e: KeyboardEvent) => {
      if (chatOpenRef.current) return;
      if (e.code === 'KeyW' && mode === 'playing' && !showPauseMenu) {
        e.preventDefault();
        setIsWPressed(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'KeyW') {
        setIsWPressed(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [mode, showPauseMenu]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.code !== 'Escape') return;
      if (chatOpenRef.current) {
        e.preventDefault();
        setChatOpen(false);
        setChatFocused(false);
        return;
      }
      if (modeRef.current === 'playing') {
        e.preventDefault();
        setShowPauseMenu((prev) => !prev);
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
          setMode('menu');
        }
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, []);

  // Enter toggles chat in multiplayer (playing, dead, or spectating)
  useEffect(() => {
    const handleEnter = (e: KeyboardEvent) => {
      if (e.code !== 'Enter') return;
      if (sessionKindRef.current !== 'multiplayer') return;
      const m = modeRef.current;
      if (m !== 'playing' && m !== 'dead' && m !== 'spectating') return;
      if (showPauseMenuRef.current) return;
      // If chat input is focused, form submit handles send — ignore here
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
    isAdminRef.current = false;
  }, []);

  const handleStartSolo = useCallback((name: string) => {
    disconnectMultiplayer();
    setConnectionError(null);
    setIsConnecting(false);
    setSessionKind('solo');
    sessionKindRef.current = 'solo';
    playerNameRef.current = name;

    startSoloEngine();
    const player = engineRef.current!.addPlayer(name);
    playerIdRef.current = player.id;
    currentPlayerRef.current = player;
    gameStateRef.current = engineRef.current!.getState();
    setCurrentPlayer(player);
    setHudState(engineRef.current!.getState());
    const admin = isAdminName(name);
    setIsAdmin(admin);
    isAdminRef.current = admin;
    setMode('playing');
    setShowPauseMenu(false);
  }, [disconnectMultiplayer, startSoloEngine]);

  const handleStartMultiplayer = useCallback((name: string, serverUrl: string) => {
    setConnectionError(null);
    setIsConnecting(true);
    engineRef.current = null;
    disconnectMultiplayer();

    setSessionKind('multiplayer');
    sessionKindRef.current = 'multiplayer';
    serverUrlRef.current = serverUrl || resolveServerUrl();
    playerNameRef.current = name;
    setIsAdmin(false);
    isAdminRef.current = false;
    setChatMessages([]);

    const client = new MultiplayerClient(name, {
      onWelcome: (id, _world, adminFlag) => {
        playerIdRef.current = id;
        setIsConnecting(false);
        setMode('playing');
        setShowPauseMenu(false);
        const admin = adminFlag ?? isAdminName(playerNameRef.current);
        setIsAdmin(admin);
        isAdminRef.current = admin;
      },
      onAdminStatus: (ok) => {
        setIsAdmin(ok);
        isAdminRef.current = ok;
      },
      onWorld: (w, h) => {
        if (gameStateRef.current) {
          gameStateRef.current.worldWidth = w;
          gameStateRef.current.worldHeight = h;
        }
      },
      onChat: (msg) => {
        setChatMessages((prev) => [
          ...prev.slice(-79),
          { name: msg.name, text: msg.text, t: msg.t, color: msg.color },
        ]);
      },
      onSettings: (settings) => {
        const clean = sanitizeGameplayConfig(settings);
        setGameConfig(clean);
        setDraftConfig(clean);
      },
      onState: (state, you, lb) => {
        gameStateRef.current = state;
        if (you) {
          currentPlayerRef.current = you;
          playerNameRef.current = you.name;
          setLastScore(you.score);
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
        }
        setLeaderboard(lb);
      },
      onDied: () => {
        if (lastAliveCenterRef.current) {
          spectateTargetRef.current = { ...lastAliveCenterRef.current };
        }
        setMode('dead');
        setShowPauseMenu(false);
        // Keep chat usable after death
        currentPlayerRef.current = undefined;
        setCurrentPlayer(undefined);
      },
      onError: (message) => {
        setConnectionError(message);
        setIsConnecting(false);
      },
      onStatus: (status) => {
        if (status === 'error' || status === 'disconnected') {
          setIsConnecting(false);
        }
      },
    });

    mpRef.current = client;
    mpRenderRef.current = () => client.getRenderState();
    client.connect(serverUrlRef.current);
  }, [disconnectMultiplayer]);

  const handleMouseMove = useCallback((x: number, y: number) => {
    if (showPauseMenuRef.current || chatOpenRef.current) return;
    if (sessionKindRef.current === 'multiplayer') {
      mpRef.current?.sendInput(x, y);
      return;
    }
    if (!engineRef.current || !playerIdRef.current) return;
    engineRef.current.updatePlayerTarget(playerIdRef.current, x, y);
  }, []);

  const handleSplit = useCallback(() => {
    if (showPauseMenuRef.current || chatOpenRef.current) return;
    if (sessionKindRef.current === 'multiplayer') {
      mpRef.current?.split();
      return;
    }
    if (!engineRef.current || !playerIdRef.current) return;
    engineRef.current.splitPlayer(playerIdRef.current);
  }, []);

  const handleEject = useCallback(() => {
    if (showPauseMenuRef.current || chatOpenRef.current) return;
    if (sessionKindRef.current === 'multiplayer') {
      mpRef.current?.eject();
      return;
    }
    if (!engineRef.current || !playerIdRef.current) return;
    engineRef.current.ejectMass(playerIdRef.current);
  }, []);

  const handleAddMass = useCallback(() => {
    if (showPauseMenuRef.current || chatOpenRef.current) return;
    if (!isAdminRef.current) return;
    if (sessionKindRef.current === 'multiplayer') {
      mpRef.current?.adminAddMass(gameConfig.adminMassBoost);
      return;
    }
    if (!engineRef.current || !playerIdRef.current) return;
    engineRef.current.addMass(playerIdRef.current, gameConfig.adminMassBoost);
  }, [gameConfig.adminMassBoost]);

  const handleSpawnVirus = useCallback((x: number, y: number) => {
    if (showPauseMenuRef.current || chatOpenRef.current) return;
    if (!isAdminRef.current) return;
    if (modeRef.current !== 'playing') return;
    if (sessionKindRef.current === 'multiplayer') {
      mpRef.current?.adminSpawnVirus(x, y);
      return;
    }
    engineRef.current?.spawnVirusAt(x, y);
  }, []);

  const handleMinimapTeleport = useCallback(() => {
    if (showPauseMenuRef.current || chatOpenRef.current) return;
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
    if (showPauseMenuRef.current || chatOpenRef.current) return;
    if (modeRef.current !== 'playing') return;
    if (sessionKindRef.current === 'multiplayer') {
      mpRef.current?.resetStarter();
      return;
    }
    if (!engineRef.current || !playerIdRef.current) return;
    engineRef.current.resetToStarter(playerIdRef.current);
  }, []);

  const handleUpdateName = useCallback((newName: string) => {
    const trimmed = newName.trim().slice(0, 15);
    if (!trimmed) return;
    playerNameRef.current = trimmed;
    const admin = isAdminName(trimmed);
    setIsAdmin(admin);
    isAdminRef.current = admin;
    if (sessionKindRef.current === 'multiplayer') {
      mpRef.current?.rename(trimmed);
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
    if (sessionKind === 'multiplayer') {
      const client = mpRef.current;
      if (client) {
        client.respawn(name);
        setMode('playing');
      } else {
        handleStartMultiplayer(name, serverUrlRef.current);
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
        }
      }
    }
    playerIdRef.current = null;
    currentPlayerRef.current = undefined;
    setCurrentPlayer(undefined);
    setMode('spectating');
    setShowPauseMenu(false);
  }, []);

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
      handleSpectate();
    }
  }, [handleSpectate, gameConfig.worldWidth, gameConfig.worldHeight]);

  const handleBackToMenu = useCallback(() => {
    if (sessionKindRef.current === 'multiplayer') {
      disconnectMultiplayer();
      startSoloEngine();
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
    setShowPauseMenu(false);
    setConnectionError(null);
    setIsConnecting(false);
    setSessionKind('solo');
    sessionKindRef.current = 'solo';
    setChatOpen(false);
  }, [disconnectMultiplayer, startSoloEngine]);

  const handleResume = useCallback(() => {
    setShowPauseMenu(false);
  }, []);

  const handleSendChat = useCallback((text: string) => {
    mpRef.current?.sendChat(text);
  }, []);

  const handleOpenAdminSettings = useCallback(async ({ name, mode }: { name: string; mode: 'solo' | 'multiplayer' }) => {
    adminSettingsNameRef.current = name;
    setAdminSettingsError(null);
    setAdminSaveNotice(null);
    setAdminSettingsSource(mode);
    if (mode === 'multiplayer') {
      setAdminSettingsSaving(true);
      try {
        const settings = await requestRemoteAdminSettings(resolveServerUrl(), name, 'get');
        const clean = sanitizeGameplayConfig(settings);
        setGameConfig(clean);
        setDraftConfig(clean);
      } catch (error) {
        setAdminSettingsError(error instanceof Error ? error.message : 'Не удалось загрузить настройки сервера');
      } finally {
        setAdminSettingsSaving(false);
      }
    } else {
      const local = engineRef.current?.getConfig() ?? gameConfig;
      setDraftConfig(sanitizeGameplayConfig(local));
    }
    setShowAdminSettings(true);
  }, [gameConfig]);

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
      if (adminSettingsSource === 'multiplayer') {
        const settings = await requestRemoteAdminSettings(resolveServerUrl(), adminSettingsNameRef.current, 'update', clean);
        const synced = sanitizeGameplayConfig(settings);
        setGameConfig(synced);
        setDraftConfig(synced);
      } else {
        engineRef.current?.setConfig(clean);
        setGameConfig(clean);
        setDraftConfig(clean);
        const state = engineRef.current?.getState();
        if (state) {
          gameStateRef.current = state;
          setHudState(state);
        }
      }
      setAdminSaveNotice('Сохранено. Панель остаётся открытой — можно править дальше.');
    } catch (error) {
      setAdminSettingsError(error instanceof Error ? error.message : 'Не удалось сохранить настройки');
    } finally {
      setAdminSettingsSaving(false);
    }
  }, [adminSettingsSource, draftConfig]);

  const handleSelectSkin = useCallback((skin: SkinInfo | null) => {
    const id = skin?.id ?? null;
    setSelectedSkinId(id);
    saveSelectedSkinId(id);
    setShowSkinPicker(false);
  }, []);

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
        isPaused={showPauseMenu}
        inputBlocked={chatFocused || chatOpen || showAdminSettings || showSkinPicker}
        onMouseMove={handleMouseMove}
        onSplit={handleSplit}
        onEject={handleEject}
        onAddMass={handleAddMass}
        onSpawnVirus={handleSpawnVirus}
        onMinimapTeleport={handleMinimapTeleport}
        onResetStarter={handleResetStarter}
        onSpectateMove={mode === 'spectating' ? handleSpectatePick : undefined}
        onPerfSample={setFps}
        isWPressed={isWPressed}
        config={gameConfig}
        skinUrl={selectedSkinUrl}
      />

      {mode === 'menu' && (
        <StartScreen
          onStartSolo={handleStartSolo}
          onStartMultiplayer={handleStartMultiplayer}
          onSpectate={handleSpectate}
          onAdminSettings={handleOpenAdminSettings}
          onOpenSkins={() => setShowSkinPicker(true)}
          connectionError={connectionError}
          isConnecting={isConnecting}
        />
      )}

      <AdminSettingsPanel
        open={showAdminSettings}
        settings={draftConfig}
        sourceLabel={adminSettingsSource === 'multiplayer' ? 'multiplayer server' : 'solo engine'}
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

      {mode !== 'menu' && (
        <>
          <Leaderboard entries={leaderboard} currentPlayerName={currentPlayer?.name || playerNameRef.current} />
          {hudState && (
            <Minimap
              gameState={hudState}
              currentPlayer={currentPlayer}
              canTeleport={isAdmin}
              spectateTarget={mode === 'spectating' ? spectateTargetRef.current : null}
              onHoverWorld={(pos) => {
                minimapHoverRef.current = pos;
              }}
              onPickWorld={mode === 'spectating' || mode === 'dead' ? handleSpectatePick : undefined}
            />
          )}
          {sessionKind === 'multiplayer' && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-sky-900/70 text-sky-200 text-xs px-3 py-1 rounded flex gap-2 items-center">
              <span>ONLINE</span>
              {isAdmin && <span className="text-amber-300">ADMIN</span>}
            </div>
          )}
        </>
      )}

      {sessionKind === 'multiplayer' && mode !== 'menu' && (
        <ChatPanel
          messages={chatMessages}
          visible={mode === 'playing' || mode === 'dead' || mode === 'spectating'}
          inputOpen={
            chatOpen &&
            (mode === 'playing' || mode === 'dead' || mode === 'spectating') &&
            !showPauseMenu
          }
          onCloseInput={() => {
            setChatOpen(false);
            setChatFocused(false);
          }}
          onSend={handleSendChat}
          onInputFocusChange={setChatFocused}
        />
      )}

      {mode === 'playing' && !showPauseMenu && (
        <HUD player={currentPlayer} fps={fps} pingMs={pingMs} onRespawn={handleRespawn} />
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
        <div className="absolute top-4 left-4 bg-black/70 backdrop-blur-sm rounded-lg px-4 py-2">
          <div className="text-white font-bold text-lg">Режим наблюдения</div>
          <div className="text-gray-400 text-sm">
            {hudState.players.filter((p) => p.cells.length > 0).length} игроков в игре
          </div>
        </div>
      )}

      {showPauseMenu && mode === 'playing' && (
        <PauseMenu
          currentName={currentPlayer?.name || playerNameRef.current}
          onUpdateName={handleUpdateName}
          onResume={handleResume}
          onBackToMenu={handleBackToMenu}
        />
      )}
    </div>
  );
}
