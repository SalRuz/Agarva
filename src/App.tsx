import { useState, useEffect, useRef, useCallback } from 'react';
import { GameEngine } from './engine/GameEngine';
import { GameCanvas } from './components/GameCanvas';
import { Leaderboard } from './components/Leaderboard';
import { Minimap } from './components/Minimap';
import { StartScreen } from './components/StartScreen';
import { PauseMenu } from './components/PauseMenu';
import { HUD } from './components/HUD';
import { GameState, Player } from './types/game';

type GameMode = 'menu' | 'playing' | 'dead' | 'spectating';

export function App() {
  const [mode, setMode] = useState<GameMode>('menu');
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [currentPlayer, setCurrentPlayer] = useState<Player | undefined>();
  const [leaderboard, setLeaderboard] = useState<{ name: string; score: number; isBot: boolean }[]>([]);
  const [isWPressed, setIsWPressed] = useState(false);
  const [showPauseMenu, setShowPauseMenu] = useState(false);

  const engineRef = useRef<GameEngine | null>(null);
  const playerIdRef = useRef<string | null>(null);

  useEffect(() => {
    const engine = new GameEngine(25);
    engineRef.current = engine;

    const gameLoop = setInterval(() => {
      engine.update();
      setGameState({ ...engine.getState() });
      setLeaderboard(engine.getLeaderboard());

      if (playerIdRef.current) {
        const player = engine.getState().players.find(p => p.id === playerIdRef.current);
        setCurrentPlayer(player);
      }
    }, 1000 / 60);

    return () => {
      clearInterval(gameLoop);
    };
  }, []);

  // Проверка смерти
  useEffect(() => {
    if (mode === 'playing' && currentPlayer && currentPlayer.cells.length === 0) {
      setMode('dead');
      setShowPauseMenu(false);
    }
  }, [currentPlayer, mode]);

  // W key press/release
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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

  // ESC — пауза-меню (только в режиме игры)
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.code === 'Escape' && mode === 'playing') {
        e.preventDefault();
        setShowPauseMenu(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [mode]);

  const handleStart = useCallback((name: string) => {
    if (!engineRef.current) return;
    const player = engineRef.current.addPlayer(name);
    playerIdRef.current = player.id;
    setCurrentPlayer(player);
    setMode('playing');
    setShowPauseMenu(false);
  }, []);

  const handleMouseMove = useCallback((x: number, y: number) => {
    if (!engineRef.current || !playerIdRef.current || showPauseMenu) return;
    engineRef.current.updatePlayerTarget(playerIdRef.current, x, y);
  }, [showPauseMenu]);

  const handleSplit = useCallback(() => {
    if (!engineRef.current || !playerIdRef.current || showPauseMenu) return;
    engineRef.current.splitPlayer(playerIdRef.current);
  }, [showPauseMenu]);

  const handleEject = useCallback(() => {
    if (!engineRef.current || !playerIdRef.current || showPauseMenu) return;
    engineRef.current.ejectMass(playerIdRef.current);
  }, [showPauseMenu]);

  const handleAddMass = useCallback(() => {
    if (!engineRef.current || !playerIdRef.current || showPauseMenu) return;
    engineRef.current.addMass(playerIdRef.current, 100);
  }, [showPauseMenu]);

  const handleUpdateName = useCallback((newName: string) => {
    if (!engineRef.current || !playerIdRef.current) return;
    engineRef.current.updatePlayerName(playerIdRef.current, newName);
  }, []);

  const handleRespawn = useCallback(() => {
    if (!engineRef.current || !currentPlayer) return;
    const state = engineRef.current.getState();
    const playerIndex = state.players.findIndex(p => p.id === currentPlayer.id);
    if (playerIndex !== -1) {
      state.players.splice(playerIndex, 1);
    }
    const newPlayer = engineRef.current.addPlayer(currentPlayer.name);
    playerIdRef.current = newPlayer.id;
    setCurrentPlayer(newPlayer);
    setMode('playing');
  }, [currentPlayer]);

  const handleSpectate = useCallback(() => {
    playerIdRef.current = null;
    setCurrentPlayer(undefined);
    setMode('spectating');
    setShowPauseMenu(false);
  }, []);

  const handleBackToMenu = useCallback(() => {
    if (playerIdRef.current && engineRef.current) {
      const state = engineRef.current.getState();
      const playerIndex = state.players.findIndex(p => p.id === playerIdRef.current);
      if (playerIndex !== -1) {
        state.players.splice(playerIndex, 1);
      }
    }
    playerIdRef.current = null;
    setCurrentPlayer(undefined);
    setMode('menu');
    setShowPauseMenu(false);
  }, []);

  const handleResume = useCallback(() => {
    setShowPauseMenu(false);
  }, []);

  if (!gameState) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white text-2xl">Загрузка...</div>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden">
      <GameCanvas
        gameState={gameState}
        currentPlayer={currentPlayer}
        isSpectating={mode === 'spectating'}
        onMouseMove={handleMouseMove}
        onSplit={handleSplit}
        onEject={handleEject}
        onAddMass={handleAddMass}
        isWPressed={isWPressed}
      />
      
      {mode === 'menu' && (
        <StartScreen onStart={handleStart} />
      )}
      
      {mode !== 'menu' && (
        <>
          <Leaderboard entries={leaderboard} currentPlayerName={currentPlayer?.name} />
          <Minimap gameState={gameState} currentPlayer={currentPlayer} />
        </>
      )}
      
      {mode === 'playing' && !showPauseMenu && (
        <HUD player={currentPlayer} onRespawn={handleRespawn} />
      )}
      
      {mode === 'dead' && (
        <HUD 
          player={currentPlayer} 
          onRespawn={handleRespawn}
          onSpectate={handleSpectate}
          onBackToMenu={handleBackToMenu}
        />
      )}
      
      {mode === 'spectating' && (
        <div className="absolute top-4 left-4 bg-black/70 backdrop-blur-sm rounded-lg px-4 py-2">
          <div className="text-white font-bold text-lg">👁 Режим наблюдения</div>
          <div className="text-gray-400 text-sm">{gameState.players.filter(p => p.cells.length > 0).length} игроков в игре</div>
        </div>
      )}

      {/* Пауза-меню поверх игры */}
      {showPauseMenu && mode === 'playing' && (
        <PauseMenu
          currentName={currentPlayer?.name || ''}
          onUpdateName={handleUpdateName}
          onResume={handleResume}
          onBackToMenu={handleBackToMenu}
        />
      )}
    </div>
  );
}