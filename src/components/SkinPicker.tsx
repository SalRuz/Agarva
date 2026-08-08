import { useEffect, useState } from 'react';
import { listPersonalSkins, listShopSkins, listSkins, loadCustomSkins, type SkinInfo } from '../skins/loadSkins';

interface SkinPickerProps {
  open: boolean;
  selectedId: string | null;
  unlockedSkinIds: string[];
  agarviki?: number;
  onBuy?: (skin: SkinInfo) => Promise<void>;
  onSelect: (skin: SkinInfo | null) => void;
  onClose: () => void;
}

export function SkinPicker({ open, selectedId, unlockedSkinIds, agarviki = 0, onBuy, onSelect, onClose }: SkinPickerProps) {
  const [, setRevision] = useState(0);
  useEffect(() => {
    if (!open) return;
    void loadCustomSkins().then(() => setRevision((revision) => revision + 1));
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Escape') return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const skins = listSkins();
  const personalSkins = listPersonalSkins(unlockedSkinIds);
  const shopSkins = listShopSkins(unlockedSkinIds);
  const renderSkin = (skin: SkinInfo) => (
    <button
      key={skin.id}
      type="button"
      onClick={() => onSelect(skin)}
      className={`rounded-2xl border p-3 text-left transition ${
        selectedId === skin.id
          ? 'border-emerald-400 bg-emerald-500/20'
          : 'border-white/10 bg-white/5 hover:bg-white/10'
      }`}
    >
      <div className="aspect-square rounded-full overflow-hidden bg-slate-800 mb-3">
        <img src={skin.url} alt={skin.name} className="w-full h-full object-cover" />
      </div>
      <div className="text-white font-semibold text-sm truncate">{skin.name}</div>
    </button>
  );

  return (
    <div
      className="absolute inset-0 z-50 bg-black/85 backdrop-blur-sm p-4 md:p-6 flex items-center justify-center"
      onKeyDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div
        className="w-full max-w-3xl max-h-[90vh] rounded-3xl border border-white/15 bg-slate-950/95 shadow-2xl flex flex-col overflow-hidden"
        onWheel={(e) => e.stopPropagation()}
      >
        <div className="border-b border-white/10 px-6 py-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold text-white">Скины</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-white/10 text-white hover:bg-white/20 transition"
          >
            Закрыть
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-amber-200">Личные скины</h3>
          {personalSkins.length ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">{personalSkins.map(renderSkin)}</div>
          ) : (
            <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-400">
              Получайте уровни или покупайте скины за агарвики.
            </div>
          )}

          <h3 className="mb-3 mt-7 text-sm font-bold uppercase tracking-wide text-sky-200">Магазин · {agarviki} агарвиков</h3>
          {shopSkins.length ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {shopSkins.map((skin) => (
                <div key={skin.id} className="rounded-2xl border border-sky-300/20 bg-sky-500/5 p-3">
                  <img src={skin.url} alt={skin.name} className="mb-3 aspect-square w-full rounded-full object-cover" />
                  <div className="truncate text-sm font-semibold text-white">{skin.name}</div>
                  <button type="button" disabled={!onBuy || agarviki < (skin.price ?? 0)} onClick={() => void onBuy?.(skin)}
                    className="mt-2 w-full rounded-lg bg-sky-600 px-2 py-1.5 text-xs font-bold text-white disabled:opacity-40">
                    Купить · {skin.price ?? 0}
                  </button>
                </div>
              ))}
            </div>
          ) : <div className="text-xs text-slate-400">Магазин пока пуст.</div>}

          <h3 className="mb-3 mt-7 text-sm font-bold uppercase tracking-wide text-slate-300">Глобальные скины</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            <button
              type="button"
              onClick={() => onSelect(null)}
              className={`rounded-2xl border p-3 text-left transition ${
                !selectedId
                  ? 'border-emerald-400 bg-emerald-500/20'
                  : 'border-white/10 bg-white/5 hover:bg-white/10'
              }`}
            >
              <div className="aspect-square rounded-full bg-gradient-to-br from-emerald-400 to-sky-500 mb-3" />
              <div className="text-white font-semibold text-sm">Без скина</div>
            </button>

            {skins.map(renderSkin)}
          </div>

          {skins.length === 0 && (
            <div className="mt-6 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-amber-100 text-sm">
              Пока нет скинов. Добавь изображения (png/jpg/webp/gif/svg) в папку{' '}
              <code className="text-amber-200">skins/</code> рядом с проектом и перезапусти.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
