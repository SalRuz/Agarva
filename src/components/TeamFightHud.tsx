interface TeamFightHudProps {
  mode: 'duoFight' | 'trioFight';
  phase: 'waiting' | 'countdown' | 'fighting' | 'between' | 'ended' | 'resetting';
  countdown: number;
  fightSecondsLeft?: number;
  blue: { alive: number; total: number; members: string[]; streaks: Record<string, number> };
  red: { alive: number; total: number; members: string[]; streaks: Record<string, number> };
  spectators?: number;
}

export function TeamFightHud({ mode, phase, countdown, fightSecondsLeft, blue, red, spectators = 0 }: TeamFightHudProps) {
  const label = phase === 'waiting' ? 'Ожидание игроков…' : phase === 'countdown' ? `Старт через ${countdown}` : phase === 'ended' ? `Сброс через ${countdown}` : phase === 'fighting' ? `Бой · ${Math.floor((fightSecondsLeft ?? 0) / 60)}:${String((fightSecondsLeft ?? 0) % 60).padStart(2, '0')}` : 'Сброс карты…';
  return <div className="absolute top-4 right-4 z-30 select-none pointer-events-none">
    <div className="bg-black/75 backdrop-blur-sm rounded-lg px-4 py-3 min-w-[230px] border border-violet-500/30">
      <div className="text-violet-300 font-bold text-sm text-center mb-2">{mode === 'duoFight' ? 'ДУО ФАЙТ' : 'ТРИО ФАЙТ'}</div>
      <div className="text-white text-center text-lg font-bold mb-2">{label}</div>
      <div className="flex justify-between gap-4 text-sm">
        <div className="text-blue-300">Синие {blue.alive}/{blue.total}<div className="text-white/70 max-w-[95px] truncate">{blue.members.map((name) => `${name} 🔥${blue.streaks[name] ?? 0}`).join(', ') || '—'}</div></div>
        <div className="text-red-300 text-right">Красные {red.alive}/{red.total}<div className="text-white/70 max-w-[95px] truncate">{red.members.map((name) => `${name} 🔥${red.streaks[name] ?? 0}`).join(', ') || '—'}</div></div>
      </div>
      <div className="text-center text-xs text-sky-300 mt-2">Спектаторы: {spectators}</div>
    </div>
  </div>;
}
