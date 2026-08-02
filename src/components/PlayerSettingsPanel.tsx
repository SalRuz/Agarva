import { useEffect, useState, type WheelEventHandler } from 'react';
import {
  formatKeyCode,
  mouseButtonCode,
  type HudSizeMode,
  type PlayerPrefs,
} from '../settings/playerPrefs';

interface PlayerSettingsPanelProps {
  open: boolean;
  prefs: PlayerPrefs;
  onChange: (next: PlayerPrefs) => void;
  onClose: () => void;
}

type BindKey =
  | 'keySplit'
  | 'keySplitSecondary'
  | 'keyEject'
  | 'keyEjectSecondary'
  | 'keyFreeze'
  | 'keyFreezeSecondary'
  | 'keyMultibox'
  | 'keyMultiboxSecondary'
  | 'keyCoords'
  | 'keyCoordsSecondary';
type BindTarget = BindKey | null;

export function PlayerSettingsPanel({ open, prefs, onChange, onClose }: PlayerSettingsPanelProps) {
  const [listening, setListening] = useState<BindTarget>(null);

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.code !== 'Escape') return;
      if (listening) {
        e.preventDefault();
        e.stopPropagation();
        setListening(null);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onEsc, true);
    return () => window.removeEventListener('keydown', onEsc, true);
  }, [open, listening, onClose]);

  useEffect(() => {
    if (!open) setListening(null);
  }, [open]);

  useEffect(() => {
    if (!listening) return;

    const applyBind = (code: string) => {
      onChange({ ...prefs, [listening]: code });
      setListening(null);
    };

    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') {
        setListening(null);
        return;
      }
      // Backspace/Delete clear the selected bind. Clearing primary eject restores LMB-only.
      if (e.code === 'Backspace' || e.code === 'Delete') {
        onChange({ ...prefs, [listening]: '' });
        setListening(null);
        return;
      }
      applyBind(e.code);
    };

    const onMouse = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      applyBind(mouseButtonCode(e.button));
    };

    const onContextMenu = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };

    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onMouse, true);
    window.addEventListener('contextmenu', onContextMenu, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onMouse, true);
      window.removeEventListener('contextmenu', onContextMenu, true);
    };
  }, [listening, onChange, prefs]);

  if (!open) return null;

  const toggle = (key: keyof PlayerPrefs, value: boolean) => {
    onChange({ ...prefs, [key]: value });
  };

  const setHudSize = (hudSize: HudSizeMode) => {
    onChange({ ...prefs, hudSize });
  };

  const bindBtn = (target: BindKey, value: string) => (
    <button
      type="button"
      onClick={() => setListening(target)}
      className={`px-2 py-1 rounded-lg text-xs font-semibold ${
        listening === target
          ? 'bg-amber-500 text-black'
          : 'bg-white/10 text-white hover:bg-white/20'
      }`}
    >
      {listening === target ? 'Нажмите…' : value ? formatKeyCode(value) : 'Не задано'}
    </button>
  );

  const bindRow = (primary: BindKey, secondary: BindKey, label: string, primaryValue: string, secondaryValue: string) => (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2">
      <div>
        <div className="text-white text-sm font-medium">{label}</div>
        <div className="text-xs text-slate-400">Основная и дополнительная клавиши</div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <span className="text-[10px] uppercase tracking-wide text-slate-500">Основная</span>
        {bindBtn(primary, primaryValue)}
        <span className="text-[10px] uppercase tracking-wide text-slate-500">Доп.</span>
        {bindBtn(secondary, secondaryValue)}
      </div>
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
          <label className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-white text-sm">
            <span>Показывать массу</span>
            <input
              type="checkbox"
              checked={prefs.showMass}
              onChange={(e) => toggle('showMass', e.target.checked)}
            />
          </label>
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
          <h3 className="text-white font-semibold">Клавиши и мышь</h3>
          <p className="text-xs text-slate-400 -mt-1 mb-1">
            Для каждого действия доступны две клавиши или кнопки мыши. Backspace/Delete очищает выбранную.
          </p>
          {bindRow('keySplit', 'keySplitSecondary', 'Деление', prefs.keySplit, prefs.keySplitSecondary)}
          {bindRow('keyEject', 'keyEjectSecondary', 'Выброс массы', prefs.keyEject, prefs.keyEjectSecondary)}
          {bindRow('keyFreeze', 'keyFreezeSecondary', 'Стоп / продолжить', prefs.keyFreeze, prefs.keyFreezeSecondary)}
          {bindRow('keyMultibox', 'keyMultiboxSecondary', 'Мультибокс', prefs.keyMultibox, prefs.keyMultiboxSecondary)}
          {bindRow('keyCoords', 'keyCoordsSecondary', 'Координаты в чат', prefs.keyCoords, prefs.keyCoordsSecondary)}
        </section>
      </div>
    </div>
  );
}
