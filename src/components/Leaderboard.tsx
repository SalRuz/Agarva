import { useState } from 'react';
import { HudPanel } from './HudPanel';

interface LeaderboardProps {
  entries: { name: string; score: number; isBot: boolean; level?: number; hideLevel?: boolean }[];
  currentPlayerName?: string;
  onClickNick?: (name: string) => void;
  onPrivateMessage?: (name: string) => void;
  spectators?: number;
}

function levelBadgeClass(level: number): string {
  if (level >= 201) return 'bg-sky-500 text-white';
  if (level >= 151) return 'bg-red-500 text-white';
  if (level >= 101) return 'bg-orange-500 text-white';
  if (level >= 51) return 'bg-yellow-400 text-black';
  return 'bg-emerald-500 text-white';
}

export function Leaderboard({ entries, currentPlayerName, onClickNick, onPrivateMessage, spectators = 0 }: LeaderboardProps) {
  const [contextMenu, setContextMenu] = useState<{ name: string; x: number; y: number } | null>(null);
  return (
    <div className="absolute top-4 right-4 z-30" onClick={() => setContextMenu(null)}>
      <HudPanel
        id="leaderboard"
        title="Лидеры"
        className="bg-black/70 backdrop-blur-sm rounded-lg p-3 min-w-[200px]"
      >
        <ul className="space-y-1">
          {entries.map((entry, index) => (
            <li
              key={index}
              className={`flex items-center justify-between text-sm px-2 py-1 rounded ${
                entry.name === currentPlayerName
                  ? 'bg-yellow-500/30 text-yellow-300'
                  : entry.isBot
                    ? 'text-gray-300'
                    : 'text-white'
              }`}
            >
              <span className="flex items-center gap-2 min-w-0">
                <span className="w-5 text-center font-mono shrink-0">
                  {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`}
                </span>
                <button
                  type="button"
                  className="truncate max-w-[110px] text-left bg-transparent border-0 p-0 hover:underline cursor-pointer inline-flex items-center gap-1.5"
                  style={{ color: 'inherit' }}
                  onClick={() => onClickNick?.(entry.name)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (!entry.isBot && entry.name !== currentPlayerName && !/^(?:🏆\s*)?система$/iu.test(entry.name.trim())) {
                      setContextMenu({ name: entry.name, x: event.clientX, y: event.clientY });
                    }
                  }}
                  title="ЛКМ — упомянуть; ПКМ — написать личное сообщение"
                >
                  {entry.isBot ? (
                    <span aria-hidden>🤖</span>
                  ) : entry.hideLevel ? (
                    <span aria-label="Уровень скрыт" title="Уровень скрыт">👤</span>
                  ) : (
                    <span
                      className={`inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none ${levelBadgeClass(entry.level ?? 0)}`}
                      title={`Уровень ${entry.level ?? 0}`}
                    >
                      {entry.level ?? 0}
                    </span>
                  )}
                  <span className="truncate">{entry.name}</span>
                </button>
              </span>
              <span className="font-mono shrink-0">{entry.score}</span>
            </li>
          ))}
        </ul>
        <div className="mt-2 text-center text-xs text-sky-300">Спектаторы: {spectators}</div>
      </HudPanel>
      {contextMenu && (
        <button
          type="button"
          className="fixed z-[70] rounded bg-slate-900 px-3 py-2 text-sm text-white shadow-xl ring-1 ring-white/20 hover:bg-slate-800"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => {
            event.stopPropagation();
            onPrivateMessage?.(contextMenu.name);
            setContextMenu(null);
          }}
        >
          Написать личное сообщение
        </button>
      )}
    </div>
  );
}
