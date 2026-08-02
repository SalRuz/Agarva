import { HudPanel } from './HudPanel';

interface LeaderboardProps {
  entries: { name: string; score: number; isBot: boolean }[];
  currentPlayerName?: string;
  onClickNick?: (name: string) => void;
  spectators?: number;
}

export function Leaderboard({ entries, currentPlayerName, onClickNick, spectators = 0 }: LeaderboardProps) {
  return (
    <div className="absolute top-4 right-4 z-30">
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
                  className="truncate max-w-[100px] text-left bg-transparent border-0 p-0 hover:underline cursor-pointer"
                  style={{ color: 'inherit' }}
                  onClick={() => onClickNick?.(entry.name)}
                  title="Упомянуть в чате"
                >
                  {entry.isBot ? '🤖' : '👤'} {entry.name}
                </button>
              </span>
              <span className="font-mono shrink-0">{entry.score}</span>
            </li>
          ))}
        </ul>
        <div className="mt-2 text-center text-xs text-sky-300">Спектаторы: {spectators}</div>
      </HudPanel>
    </div>
  );
}
