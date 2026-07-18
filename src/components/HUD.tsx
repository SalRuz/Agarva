import { Player } from '../types/game';
import { getTotalMass } from '../utils/gameUtils';

interface HUDProps {
  player?: Player;
  onRespawn: () => void;
  onSpectate?: () => void;
  onBackToMenu?: () => void;
}

export function HUD({ player, onRespawn, onSpectate, onBackToMenu }: HUDProps) {
  const isDead = player && player.cells.length === 0;
  const mass = player ? getTotalMass(player) : 0;

  return (
    <>
      {player && !isDead && (
        <div className="absolute top-4 left-4 bg-black/70 backdrop-blur-sm rounded-lg px-4 py-2">
          <div className="text-white font-bold text-lg">
            Масса: <span className="text-green-400">{Math.floor(mass)}</span>
          </div>
          <div className="text-gray-400 text-sm">
            Клетки: {player.cells.length}
          </div>
        </div>
      )}

      {isDead && (
        <div className="absolute inset-0 bg-black/60 flex items-center justify-center pointer-events-none">
          <div className="text-center pointer-events-auto">
            <h2 className="text-4xl font-bold text-red-500 mb-4">Вас съели! 💀</h2>
            <p className="text-gray-400 mb-6">Финальная масса: {player?.score}</p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={onRespawn}
                className="px-8 py-3 rounded-lg bg-gradient-to-r from-green-500 to-emerald-600 text-white font-bold text-lg hover:from-green-600 hover:to-emerald-700 transition-all"
              >
                ▶ Играть снова
              </button>
              {onSpectate && (
                <button
                  onClick={onSpectate}
                  className="px-8 py-3 rounded-lg bg-white/10 border border-white/20 text-white font-bold text-lg hover:bg-white/20 transition-all"
                >
                  👁 Наблюдать
                </button>
              )}
            </div>
            {onBackToMenu && (
              <button
                onClick={onBackToMenu}
                className="mt-3 px-6 py-2 rounded-lg bg-black/50 text-gray-400 text-sm hover:text-white transition-all"
              >
                ← В меню
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}