import { useCallback, useRef } from 'react';
import { GameState, Player } from '../types/game';
import {
  getPlayerCenter,
  getSectorAt,
  getSectorLabel,
  getSectorSize,
  SECTOR_COLS,
  SECTOR_ROWS,
  SECTOR_ROW_LABELS,
} from '../utils/gameUtils';
import { HudPanel } from './HudPanel';

interface MinimapProps {
  gameState: GameState;
  currentPlayer?: Player;
  onHoverWorld?: (pos: { x: number; y: number } | null) => void;
  onPickWorld?: (pos: { x: number; y: number }) => void;
  canTeleport?: boolean;
  spectateTarget?: { x: number; y: number } | null;
}

const SIZE = 150;

export function Minimap({
  gameState,
  currentPlayer,
  onHoverWorld,
  onPickWorld,
  canTeleport,
  spectateTarget,
}: MinimapProps) {
  const ww = gameState.worldWidth || 1;
  const wh = gameState.worldHeight || 1;
  const scaleX = SIZE / ww;
  const scaleY = SIZE / wh;
  const { sw, sh } = getSectorSize(ww, wh);
  const mapRef = useRef<HTMLDivElement>(null);

  let playerSectorLabel = '—';
  let playerSector = { row: -1, col: -1 };
  if (currentPlayer && currentPlayer.cells.length > 0) {
    const center = getPlayerCenter(currentPlayer);
    playerSector = getSectorAt(center.x, center.y, ww, wh);
    playerSectorLabel = getSectorLabel(playerSector.row, playerSector.col);
  }

  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const el = mapRef.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const lx = clientX - rect.left;
      const ly = clientY - rect.top;
      if (lx < 0 || ly < 0 || lx > rect.width || ly > rect.height) return null;
      return {
        x: (lx / rect.width) * ww,
        y: (ly / rect.height) * wh,
      };
    },
    [ww, wh]
  );

  const title = `${playerSectorLabel}${canTeleport ? ' · 1=TP' : ''}`;

  return (
    <div className="absolute bottom-4 right-4 z-30">
      <HudPanel id="minimap" title={title} className="bg-black/70 backdrop-blur-sm rounded-lg p-2">
        <div
          ref={mapRef}
          className={`relative border border-white/30 rounded overflow-hidden ${
            canTeleport ? 'cursor-crosshair' : ''
          }`}
          style={{ width: SIZE, height: SIZE }}
          onMouseMove={(e) => {
            if (!onHoverWorld) return;
            onHoverWorld(toWorld(e.clientX, e.clientY));
          }}
          onMouseLeave={() => onHoverWorld?.(null)}
          onClick={(e) => {
            const pos = toWorld(e.clientX, e.clientY);
            if (pos) onPickWorld?.(pos);
          }}
        >
          {Array.from({ length: SECTOR_ROWS }, (_, row) =>
            Array.from({ length: SECTOR_COLS }, (_, col) => {
              const isPlayer = row === playerSector.row && col === playerSector.col;
              return (
                <div
                  key={`${row}-${col}`}
                  className="absolute border border-white/15 pointer-events-none"
                  style={{
                    left: col * sw * scaleX,
                    top: row * sh * scaleY,
                    width: sw * scaleX,
                    height: sh * scaleY,
                    backgroundColor: isPlayer ? 'rgba(56, 189, 248, 0.28)' : 'transparent',
                  }}
                >
                  <span
                    className={`absolute inset-0 flex items-center justify-center font-mono leading-none select-none ${
                      isPlayer ? 'text-sky-200/90 text-[9px] font-semibold' : 'text-white/25 text-[8px]'
                    }`}
                  >
                    {SECTOR_ROW_LABELS[row]}
                    {col + 1}
                  </span>
                </div>
              );
            })
          )}

          {gameState.players.map((player) => {
            if (player.cells.length === 0) return null;
            const center = getPlayerCenter(player);
            const isCurrentPlayer = currentPlayer?.id === player.id;

            return (
              <div
                key={player.id}
                className={`absolute rounded-full z-10 pointer-events-none ${
                  isCurrentPlayer ? 'ring-2 ring-white' : ''
                }`}
                style={{
                  left: center.x * scaleX - (isCurrentPlayer ? 4 : 2),
                  top: center.y * scaleY - (isCurrentPlayer ? 4 : 2),
                  width: isCurrentPlayer ? 8 : 4,
                  height: isCurrentPlayer ? 8 : 4,
                  backgroundColor: player.cells[0]?.color || '#fff',
                }}
              />
            );
          })}

          {spectateTarget ? (
            <div
              className="absolute rounded-full pointer-events-none"
              style={{
                left: spectateTarget.x * scaleX - 6,
                top: spectateTarget.y * scaleY - 6,
                width: 12,
                height: 12,
                backgroundColor: 'rgba(255,255,255,0.10)',
                border: '2px solid rgba(255,255,255,0.35)',
                boxShadow: '0 0 10px rgba(255,255,255,0.18)',
              }}
            />
          ) : null}
        </div>
      </HudPanel>
    </div>
  );
}
