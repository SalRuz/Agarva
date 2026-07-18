import { GameState, Player } from '../types/game';
import { getPlayerCenter } from '../utils/gameUtils';

interface MinimapProps {
  gameState: GameState;
  currentPlayer?: Player;
}

export function Minimap({ gameState, currentPlayer }: MinimapProps) {
  const scale = 150 / gameState.worldWidth;

  return (
    <div className="absolute bottom-4 right-4 bg-black/70 backdrop-blur-sm rounded-lg p-2">
      <div 
        className="relative border border-white/30 rounded"
        style={{ width: 150, height: 150 }}
      >
        {/* Players */}
        {gameState.players.map(player => {
          if (player.cells.length === 0) return null;
          const center = getPlayerCenter(player);
          const isCurrentPlayer = currentPlayer?.id === player.id;
          
          return (
            <div
              key={player.id}
              className={`absolute rounded-full ${isCurrentPlayer ? 'ring-2 ring-white' : ''}`}
              style={{
                left: center.x * scale - 3,
                top: center.y * scale - 3,
                width: isCurrentPlayer ? 8 : 4,
                height: isCurrentPlayer ? 8 : 4,
                backgroundColor: player.cells[0]?.color || '#fff',
                transform: isCurrentPlayer ? 'translate(-2px, -2px)' : undefined
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
