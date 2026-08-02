interface SoloFightHudProps {
  phase: 'waiting' | 'countdown' | 'fighting' | 'between' | 'ended' | 'resetting';
  countdown: number;
  fightSecondsLeft?: number;
  a: { name: string; score: number };
  b: { name: string; score: number };
  spectators?: number;
}

function formatFightClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

export function SoloFightHud({ phase, countdown, fightSecondsLeft, a, b, spectators = 0 }: SoloFightHudProps) {
  const phaseLabel =
    phase === 'waiting'
      ? 'Ожидание соперника…'
      : phase === 'countdown'
        ? `Старт через ${countdown}`
        : phase === 'ended'
          ? `Очистка карты через ${countdown}`
          : phase === 'between' || phase === 'resetting'
            ? 'Сброс карты…'
            : typeof fightSecondsLeft === 'number'
              ? `Бой · ${formatFightClock(fightSecondsLeft)}`
              : 'Бой';

  return (
    <div className="absolute top-4 right-4 z-30 select-none pointer-events-none">
      <div className="bg-black/75 backdrop-blur-sm rounded-lg px-4 py-3 min-w-[220px] border border-rose-500/30">
        <div className="text-rose-300 font-bold text-sm text-center mb-2 tracking-wide">СОЛО ФАЙТ</div>
        <div className="text-white text-center text-lg font-bold mb-2">{phaseLabel}</div>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between gap-4 text-white">
            <span className="truncate max-w-[120px]">{a.name || '—'}</span>
            <span className="font-mono text-emerald-300">🔥 {a.score}</span>
          </div>
          <div className="flex justify-between gap-4 text-white">
            <span className="truncate max-w-[120px]">{b.name || '—'}</span>
            <span className="font-mono text-emerald-300">🔥 {b.score}</span>
          </div>
        </div>
        <div className="mt-2 text-center text-xs text-sky-300">Спектаторы: {spectators}</div>
      </div>
    </div>
  );
}
