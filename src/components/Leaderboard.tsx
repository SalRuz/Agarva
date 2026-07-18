interface LeaderboardProps {
  entries: { name: string; score: number; isBot: boolean }[];
  currentPlayerName?: string;
}

export function Leaderboard({ entries, currentPlayerName }: LeaderboardProps) {
  return (
    <div className="absolute top-4 right-4 bg-black/70 backdrop-blur-sm rounded-lg p-4 min-w-[200px]">
      <h2 className="text-white font-bold text-lg mb-3 text-center border-b border-white/20 pb-2">
        🏆 Лидеры
      </h2>
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
            <span className="flex items-center gap-2">
              <span className="w-5 text-center font-mono">
                {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`}
              </span>
              <span className="truncate max-w-[100px]">
                {entry.isBot ? '🤖' : '👤'} {entry.name}
              </span>
            </span>
            <span className="font-mono">{entry.score}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
