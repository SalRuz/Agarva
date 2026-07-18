import { useRef, useEffect, useCallback } from 'react';
import { GameState, Player } from '../types/game';
import { getPlayerCenter, getVirusColor, WORLD_WIDTH, WORLD_HEIGHT } from '../utils/gameUtils';

interface GameCanvasProps {
  gameState: GameState;
  currentPlayer?: Player;
  isSpectating: boolean;
  onMouseMove: (x: number, y: number) => void;
  onSplit: () => void;
  onEject: () => void;
  onAddMass: () => void;
  isWPressed: boolean;
}

export function GameCanvas({ 
  gameState, currentPlayer, isSpectating, 
  onMouseMove, onSplit, onEject, onAddMass, isWPressed 
}: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraRef = useRef({ x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2, scale: 1, targetScale: 1 });

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    let targetX = WORLD_WIDTH / 2;
    let targetY = WORLD_HEIGHT / 2;
    let targetScale = 1;

    if (isSpectating) {
      const scaleX = width / WORLD_WIDTH;
      const scaleY = height / WORLD_HEIGHT;
      targetScale = Math.min(scaleX, scaleY) * 0.95;
    } else if (currentPlayer && currentPlayer.cells.length > 0) {
      const center = getPlayerCenter(currentPlayer);
      targetX = center.x;
      targetY = center.y;
    }

    cameraRef.current.x += (targetX - cameraRef.current.x) * 0.1;
    cameraRef.current.y += (targetY - cameraRef.current.y) * 0.1;
    cameraRef.current.scale += (cameraRef.current.targetScale - cameraRef.current.scale) * 0.1;
    const camera = cameraRef.current;

    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.scale(camera.scale, camera.scale);
    ctx.translate(-camera.x, -camera.y);

    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 1;
    const gridSize = 50;
    const startX = Math.floor((camera.x - width / camera.scale / 2) / gridSize) * gridSize;
    const startY = Math.floor((camera.y - height / camera.scale / 2) / gridSize) * gridSize;
    const endX = camera.x + width / camera.scale / 2;
    const endY = camera.y + height / camera.scale / 2;

    for (let x = startX; x < endX; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, Math.max(0, startY));
      ctx.lineTo(x, Math.min(gameState.worldHeight, endY));
      ctx.stroke();
    }
    for (let y = startY; y < endY; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(Math.max(0, startX), y);
      ctx.lineTo(Math.min(gameState.worldWidth, endX), y);
      ctx.stroke();
    }

    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 10;
    ctx.strokeRect(0, 0, gameState.worldWidth, gameState.worldHeight);

    for (const food of gameState.food) {
      if (food.x < camera.x - width / camera.scale / 2 - 50 ||
          food.x > camera.x + width / camera.scale / 2 + 50 ||
          food.y < camera.y - height / camera.scale / 2 - 50 ||
          food.y > camera.y + height / camera.scale / 2 + 50) continue;

      ctx.beginPath();
      ctx.arc(food.x, food.y, food.radius, 0, Math.PI * 2);
      ctx.fillStyle = food.color;
      ctx.fill();
    }

    for (const mass of gameState.ejectedMass) {
      if (mass.x < camera.x - width / camera.scale / 2 - 50 ||
          mass.x > camera.x + width / camera.scale / 2 + 50 ||
          mass.y < camera.y - height / camera.scale / 2 - 50 ||
          mass.y > camera.y + height / camera.scale / 2 + 50) continue;

      ctx.beginPath();
      ctx.arc(mass.x, mass.y, mass.radius, 0, Math.PI * 2);
      ctx.fillStyle = mass.color;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    for (const virus of gameState.viruses) {
      if (virus.x < camera.x - width / camera.scale / 2 - 100 ||
          virus.x > camera.x + width / camera.scale / 2 + 100 ||
          virus.y < camera.y - height / camera.scale / 2 - 100 ||
          virus.y > camera.y + height / camera.scale / 2 + 100) continue;

      const colors = getVirusColor(virus.charge);
      ctx.fillStyle = colors.fill;
      ctx.strokeStyle = colors.stroke;
      ctx.lineWidth = 3;

      ctx.beginPath();
      const spikes = 20;
      for (let i = 0; i < spikes * 2; i++) {
        const angle = (i / (spikes * 2)) * Math.PI * 2;
        const r = i % 2 === 0 ? virus.radius : virus.radius * 0.85;
        const x = virus.x + Math.cos(angle) * r;
        const y = virus.y + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    const allCells: { cell: typeof gameState.players[0]['cells'][0]; playerName: string; isCurrentPlayer: boolean }[] = [];
    for (const player of gameState.players) {
      for (const cell of player.cells) {
        allCells.push({
          cell,
          playerName: player.name,
          isCurrentPlayer: currentPlayer?.id === player.id
        });
      }
    }
    allCells.sort((a, b) => a.cell.visualRadius - b.cell.visualRadius);

    for (const { cell, playerName, isCurrentPlayer } of allCells) {
      if (cell.x < camera.x - width / camera.scale / 2 - cell.visualRadius * 2 ||
          cell.x > camera.x + width / camera.scale / 2 + cell.visualRadius * 2 ||
          cell.y < camera.y - height / camera.scale / 2 - cell.visualRadius * 2 ||
          cell.y > camera.y + height / camera.scale / 2 + cell.visualRadius * 2) continue;

      ctx.beginPath();
      ctx.arc(cell.x, cell.y, cell.visualRadius, 0, Math.PI * 2);
      ctx.fillStyle = cell.color;
      ctx.fill();

      ctx.strokeStyle = isCurrentPlayer ? '#ffffff' : 'rgba(0,0,0,0.3)';
      ctx.lineWidth = isCurrentPlayer ? 4 : 2;
      ctx.stroke();

      const fontSize = Math.max(12, cell.visualRadius * 0.4);
      ctx.font = `bold ${fontSize}px Arial`;
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 3;
      ctx.strokeText(playerName, cell.x, cell.y);
      ctx.fillText(playerName, cell.x, cell.y);

      if (cell.visualRadius > 30) {
        const mass = Math.floor(Math.PI * cell.visualRadius * cell.visualRadius / 100);
        const massFontSize = fontSize * 0.6;
        ctx.font = `${massFontSize}px Arial`;
        ctx.strokeText(mass.toString(), cell.x, cell.y + fontSize * 0.8);
        ctx.fillText(mass.toString(), cell.x, cell.y + fontSize * 0.8);
      }
    }

    ctx.restore();
  }, [gameState, currentPlayer, isSpectating]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    let animationId: number;
    const animate = () => {
      draw();
      animationId = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationId);
    };
  }, [draw]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isSpectating) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const camera = cameraRef.current;
    const worldX = (mouseX - canvas.width / 2) / camera.scale + camera.x;
    const worldY = (mouseY - canvas.height / 2) / camera.scale + camera.y;
    
    onMouseMove(worldX, worldY);
  }, [onMouseMove, isSpectating]);

  // Зум колесиком мыши
  const handleWheel = useCallback((e: WheelEvent) => {
    if (isSpectating) return; // в наблюдении зум не нужен
    e.preventDefault();
    const zoomSpeed = 0.1;
    const delta = e.deltaY > 0 ? -zoomSpeed : zoomSpeed;
    cameraRef.current.targetScale = Math.max(0.2, Math.min(2, cameraRef.current.targetScale + delta));
  }, [isSpectating]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.code === 'Space') {
      e.preventDefault();
      onSplit();
    } else if (e.code === 'KeyQ') {
      e.preventDefault();
      onAddMass();
    }
  }, [onSplit, onAddMass]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('wheel', handleWheel);
    };
  }, [handleKeyDown, handleWheel]);

  // Спам W при зажатии
  useEffect(() => {
    if (!isWPressed || isSpectating) return;
    
    onEject();
    
    const interval = setInterval(() => {
      onEject();
    }, 150);
    
    return () => clearInterval(interval);
  }, [isWPressed, onEject, isSpectating]);

  return (
    <canvas
      ref={canvasRef}
      onMouseMove={handleMouseMove}
      className="block cursor-crosshair"
    />
  );
}