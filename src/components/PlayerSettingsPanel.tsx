import { useEffect, useState, type WheelEventHandler } from 'react';
import {
  formatKeyCode,
  type HudSizeMode,
  type PlayerPrefs,
} from '../settings/playerPrefs';

interface PlayerSettingsPanelProps {
  open: boolean;
  prefs: PlayerPrefs;
  onChange: (next: PlayerPrefs) => void;
  onClose: () => void;
}

type BindTarget = 'keySplit' | 'keyEject' | 'keyFreeze' | null;

export function PlayerSettingsPanel({ open, prefs, onChange, onClose }: PlayerSettingsPanelProps) {
  const [listening, setListening] = useState<BindTarget>(null);

  useEffect(() => {
    if (!open) setListening(null);
  }, [open]);

  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') {
        setListening(null);
        return;
      }
      // Clear eject bind with Backspace/Delete → LMB only
      if (listening === 'keyEject' && (e.code === 'Backspace' || e.code === 'Delete')) {
        onChange({ ...prefs, keyEject: '' });
        setListening(null);
        return;
      }
      onChange({ ...prefs, [listening]: e.code });
      setListening(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [listening, onChange, prefs]);

  if (!open) return null;

  const toggle = (key: keyof PlayerPrefs, value: boolean) => {
    onChange({ ...prefs, [key]: value });
  };

  const setHudSize = (hudSize: HudSizeMode) => {
    onChange({ ...prefs, hudSize });
  };

  const bindBtn = (target: Exclude<BindTarget, null>, label: string, value: string) => (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2">
      <div>
        <div className="text-white text-sm font-medium">{label}</div>
        <div className="text-xs text-slate-400">Сейчас: {formatKeyCode(value)}</div>
      </div>
      <button
        type="button"
        onClick={() => setListening(target)}
        className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${
          listening === target
            ? 'bg-amber-500 text-black'
            : 'bg-white/10 text-white hover:bg-white/20'
        }`}
      >
        {listening === target ? 'Нажмите…' : 'Сменить'}
      </button>
    </div>
  );

  const stopWheel: WheelEventHandler = (e) => {
    e.stopPropagation();
  };

  return (
    <div
      className="absolute inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      onKeyDown={(e) => e.stopPropagation()}
      onKeyUp={(e) => e.stopPropagation()}
      onWheel={stopWheel}
    >
      <div
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-white/15 bg-slate-950/95 p-5 shadow-2xl"
        onWheel={stopWheel}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="text-2xl font-bold text-white">Настройки</h2>
            <p className="text-sm text-slate-400 mt-1">Сохраняются локально в браузере</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg bg-white/10 text-white hover:bg-white/20"
          >
            Закрыть
          </button>
        </div>

        <section className="space-y-2 mb-5">
          <h3 className="text-white font-semibold">Показывать массу</h3>
          {(
            [
              ['showMassSelf', 'У себя'],
              ['showMassOthers', 'У других игроков'],
              ['showMassBots', 'У ботов'],
            ] as const
          ).map(([key, label]) => (
            <label
              key={key}
              className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-white text-sm"
            >
              <span>{label}</span>
              <input
                type="checkbox"
                checked={prefs[key]}
                onChange={(e) => toggle(key, e.target.checked)}
              />
            </label>
          ))}
        </section>

        <section className="space-y-2 mb-5">
          <h3 className="text-white font-semibold">Размер окон HUD</h3>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ['standard', 'Обычный'],
                ['smaller', 'Меньше'],
                ['evenSmaller', 'Ещё меньше'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setHudSize(value)}
                className={`px-2 py-2 rounded-lg text-sm font-medium ${
                  prefs.hudSize === value
                    ? 'bg-emerald-600 text-white'
                    : 'bg-white/10 text-white/80 hover:bg-white/20'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-2 mb-5">
          <h3 className="text-white font-semibold">Скины</h3>
          <label className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-white text-sm">
            <span>Отключить скины</span>
            <input
              type="checkbox"
              checked={prefs.disableSkins}
              onChange={(e) => toggle('disableSkins', e.target.checked)}
            />
          </label>
        </section>

        <section className="space-y-2">
          <h3 className="text-white font-semibold">Клавиши</h3>
          {bindBtn('keySplit', 'Деление', prefs.keySplit)}
          {bindBtn('keyEject', 'Выброс массы', prefs.keyEject)}
          {bindBtn('keyFreeze', 'Стоп / продолжить', prefs.keyFreeze)}
        </section>
      </div>
    </div>
  );
}
