import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameplayConfig } from '../../shared/gameConfig';

type ConfigKey = keyof GameplayConfig;

interface FieldDef {
  key: ConfigKey;
  label: string;
  help: string;
  step?: number;
}

interface SectionDef {
  title: string;
  fields: FieldDef[];
}

const SECTIONS: SectionDef[] = [
  {
    title: 'Мир и сервер',
    fields: [
      { key: 'worldWidth', label: 'Ширина карты', help: 'Физическая ширина мира.', step: 100 },
      { key: 'worldHeight', label: 'Высота карты', help: 'Физическая высота мира.', step: 100 },
      { key: 'serverTickHz', label: 'Tick rate сервера', help: 'Частота обновления сервера в секунду.', step: 1 },
      { key: 'foodNetMax', label: 'Лимит еды в снапшоте', help: 'Сколько кусочков еды максимум отправлять клиенту.', step: 1 },
      { key: 'ejectNetMax', label: 'Лимит W в снапшоте', help: 'Сколько W максимум отправлять клиенту.', step: 1 },
    ],
  },
  {
    title: 'Игрок',
    fields: [
      { key: 'initialMass', label: 'Стартовая масса', help: 'Масса новой клетки при спавне.', step: 1 },
      { key: 'minSplitMass', label: 'Минимальная масса для деления', help: 'Ниже этого значения пробел не делит клетку.', step: 1 },
      { key: 'maxCellsPerPlayer', label: 'Максимум частей', help: 'Сколько клеток максимум может иметь игрок.', step: 1 },
      { key: 'maxCellMass', label: 'Макс. масса клетки', help: 'Жёсткий верхний предел массы одной клетки.', step: 10 },
      { key: 'speedCoeff', label: 'Коэффициент скорости', help: 'Базовая константа формулы скорости.', step: 0.01 },
      { key: 'speedExponent', label: 'Экспонента скорости', help: 'Насколько сильнее клетка замедляется с ростом.', step: 0.001 },
      { key: 'speedSmallBoost', label: 'Буст маленьких клеток', help: 'Дополнительная скорость для маленьких масс.', step: 0.01 },
      { key: 'speedMin', label: 'Минимальная скорость', help: 'Нижний предел скорости больших клеток.', step: 0.01 },
      { key: 'speedProgressionSoften', label: 'Смягчение прогрессии скорости', help: 'Чем больше, тем мягче спад скорости от роста.', step: 0.1 },
      { key: 'speedGlobalMult', label: 'Глобальный множитель скорости', help: 'Итоговый множитель ко всей формуле скорости.', step: 0.01 },
      { key: 'moveLerp', label: 'Move lerp', help: 'Зарезервировано под клиентское сглаживание управления.', step: 0.01 },
      { key: 'moveStopBase', label: 'Базовая мёртвая зона', help: 'Дистанция до курсора, на которой клетка перестаёт идти.', step: 0.1 },
      { key: 'moveStopRadiusFrac', label: 'Мёртвая зона от радиуса', help: 'Добавка к stop-дистанции от размера клетки.', step: 0.001 },
      { key: 'boostSteer', label: 'Поворот в бусте', help: 'Насколько клетка рулится во время сплит-бустов.', step: 0.001 },
      { key: 'boostPassMult', label: 'Порог boost-pass', help: 'Во сколько раз скорость должна превысить cruise, чтобы буст считался активным.', step: 0.01 },
    ],
  },
  {
    title: 'Деление и слияние',
    fields: [
      { key: 'splitBoost', label: 'Сила деления', help: 'Начальная скорость разлёта после пробела.', step: 0.1 },
      { key: 'splitFriction', label: 'Трение деления', help: 'Как быстро затухает сплит-буст.', step: 0.001 },
      { key: 'splitSpawnOffset', label: 'Смещение новой части', help: 'На каком расстоянии новая часть появляется при делении.', step: 0.01 },
      { key: 'mergeBaseMs', label: 'База таймера слияния', help: 'Базовая часть merge-таймера в миллисекундах.', step: 100 },
      { key: 'mergeMassFactor', label: 'Фактор массы для merge', help: 'Сколько миллисекунд добавляется за 1 массы.', step: 0.1 },
      { key: 'mergeCoverage', label: 'Порог слияния', help: 'Какая доля маленькой клетки должна войти в большую для merge.', step: 0.01 },
      { key: 'eatMassMult', label: 'Множитель съедания', help: 'Насколько тяжелее нужно быть, чтобы съесть другую клетку.', step: 0.01 },
      { key: 'eatCoverage', label: 'Порог съедания', help: 'Какая доля цели должна зайти внутрь для поглощения.', step: 0.01 },
      { key: 'separationStiffness', label: 'Жёсткость разделения', help: 'Сила расталкивания своих частей до merge.', step: 0.01 },
      { key: 'separationIterations', label: 'Итерации разделения', help: 'Сколько проходов коллизий своих частей делается за тик.', step: 1 },
      { key: 'autoSplitEnabled', label: 'Автосплит при большой массе (0/1)', help: '1 = включено: если одна клетка достигла порога массы, она автоматически делится на 2 части в сторону курсора.', step: 1 },
      { key: 'autoSplitMassThreshold', label: 'Порог автосплита', help: 'Масса одной клетки, при которой срабатывает автосплит (по умолчанию 22500).', step: 100 },
    ],
  },
  {
    title: 'Еда',
    fields: [
      { key: 'foodMass', label: 'Масса еды', help: 'Сколько массы даёт одна маленькая частица.', step: 0.1 },
      { key: 'foodCountSolo', label: 'Еда в solo', help: 'Целевое количество еды для solo.', step: 1 },
      { key: 'foodCountMp', label: 'Еда в multiplayer', help: 'Целевое количество еды для сервера.', step: 1 },
      { key: 'foodRespawnThreshold', label: 'Порог респавна еды', help: 'Когда еды меньше этого числа, сервер добавляет новую.', step: 1 },
      { key: 'foodRespawnBatch', label: 'Пачка респавна еды', help: 'Сколько еды добавляется за один респавн.', step: 1 },
      { key: 'foodViewRadius', label: 'Базовый FOV еды', help: 'Базовая дальность видимости еды.', step: 10 },
      { key: 'foodViewPerSumRadius', label: 'FOV от суммы радиусов', help: 'Насколько обзор растёт от общей суммы клеток.', step: 0.1 },
      { key: 'foodViewPerMaxRadius', label: 'FOV от максимального радиуса', help: 'Насколько обзор растёт от самой большой клетки.', step: 0.1 },
      { key: 'foodViewMax', label: 'Максимальный FOV', help: 'Жёсткий максимум обзора.', step: 10 },
    ],
  },
  {
    title: 'Колючки',
    fields: [
      { key: 'virusMass', label: 'Масса колючки', help: 'Размер обычной колючки.', step: 1 },
      { key: 'virusBonusMass', label: 'Бонус массы от колючки', help: 'Сколько общей массы добавляется при взрыве об колючку.', step: 1 },
      { key: 'virusMinEatMass', label: 'Минимум массы для взрыва об колючку', help: 'Ниже этой массы клетка не активирует колючку.', step: 1 },
      { key: 'virusCount', label: 'Количество колючек', help: 'Сколько колючек поддерживать на карте.', step: 1 },
      { key: 'virusMaxCharge', label: 'Заряд колючки', help: 'Сколько W нужно скормить, чтобы колючка выстрелила.', step: 1 },
      { key: 'virusPopSpeed', label: 'Скорость разлёта частей', help: 'Базовая скорость осколков после взрыва об колючку.', step: 0.1 },
      { key: 'virusSplitSpeed', label: 'Скорость вылета колючки', help: 'Скорость новой летящей колючки после перекорма.', step: 0.1 },
      { key: 'virusFriction', label: 'Трение летящей колючки', help: 'Как быстро затухает скорость летящей колючки.', step: 0.001 },
      { key: 'virusEjectCoverage', label: 'Порог кормления колючки', help: 'Насколько глубоко W должна войти в колючку.', step: 0.01 },
    ],
  },
  {
    title: 'Вэшки',
    fields: [
      { key: 'ejectLoss', label: 'Потеря массы при W', help: 'Сколько массы теряет клетка при выстреле.', step: 0.1 },
      { key: 'ejectGain', label: 'Масса одной W', help: 'Сколько массы получает клетка, когда ест W.', step: 0.1 },
      { key: 'ejectPickupMinMass', label: 'Мин. масса для подбора W', help: 'Минимальная масса клетки, чтобы она могла съесть W.', step: 0.1 },
      { key: 'ejectPickupCoverage', label: 'Порог подбора W', help: 'Насколько глубоко W должна войти в клетку.', step: 0.01 },
      { key: 'ejectSpeed', label: 'Скорость W', help: 'Начальная скорость выстреленной W.', step: 0.1 },
      { key: 'ejectMinMass', label: 'Минимум массы для W', help: 'Ниже этой массы W выстрелить нельзя.', step: 0.1 },
      { key: 'ejectCooldown', label: 'Кулдаун W', help: 'Пауза между выстрелами W в миллисекундах.', step: 1 },
      { key: 'ejectGracePeriod', label: 'Grace период W', help: 'Сколько миллисекунд родная клетка не может подобрать свою W.', step: 1 },
      { key: 'ejectFriction', label: 'Трение W', help: 'Как быстро замедляется W.', step: 0.001 },
      { key: 'ejectMaxCount', label: 'Максимум W на карте', help: 'Мягкий предел количества W на карте.', step: 1 },
    ],
  },
  {
    title: 'Распад, боты и админ',
    fields: [
      { key: 'massDecayPerSec', label: 'Распад массы в секунду', help: 'Какой процент массы теряется в секунду.', step: 0.0001 },
      { key: 'massDecayMin', label: 'Порог распада', help: 'Ниже этой массы распад не применяется.', step: 1 },
      { key: 'botAiIntervalMs', label: 'Интервал ИИ ботов', help: 'Как часто боты пересчитывают решение.', step: 1 },
      { key: 'botCountSolo', label: 'Боты в solo', help: 'Стартовое число ботов в solo.', step: 1 },
      { key: 'botCountMp', label: 'Боты на сервере', help: 'Целевое число ботов на сервере.', step: 1 },
      { key: 'adminMassBoost', label: 'Q: сколько массы добавить', help: 'Сколько массы даёт админская кнопка Q.', step: 1 },
    ],
  },
  {
    title: 'Наблюдение',
    fields: [
      { key: 'spectatePanSpeed', label: 'Скорость панорамы', help: 'Как быстро камера едет за курсором в режиме наблюдения.', step: 1 },
      { key: 'spectateMinZoom', label: 'Мин. зум наблюдения', help: 'Минимальный zoom колёсиком в spectate.', step: 0.01 },
      { key: 'spectateMaxZoom', label: 'Макс. зум наблюдения', help: 'Максимальный zoom колёсиком в spectate.', step: 0.1 },
      { key: 'cameraBaseScale', label: 'Базовый масштаб камеры', help: 'Общий множитель масштаба камеры (и в игре, и в наблюдении).', step: 0.01 },
    ],
  },
  {
    title: 'Локальная визуализация',
    fields: [
      { key: 'visualGrowLerp', label: 'Плавность роста', help: 'Насколько быстро визуальный радиус догоняет рост массы.', step: 0.001 },
      { key: 'visualShrinkLerp', label: 'Плавность уменьшения', help: 'Насколько быстро визуальный радиус догоняет потерю массы.', step: 0.001 },
      { key: 'cameraZoomRef', label: 'Опорный зум', help: 'Базовый размер для формулы камеры.', step: 0.1 },
      { key: 'cameraZoomPower', label: 'Сила зума', help: 'Насколько сильнее камера отдаляется при росте.', step: 0.01 },
    ],
  },
];

function ConfigNumberField({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (next: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setText(String(value));
  }, [value]);

  const commit = () => {
    focusedRef.current = false;
    const normalized = text.trim().replace(',', '.');
    if (normalized === '' || normalized === '-' || normalized === '.' || normalized === '-.') {
      setText(String(value));
      return;
    }
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) {
      setText(String(value));
      return;
    }
    onCommit(parsed);
    setText(String(parsed));
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      value={text}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
      }}
      onKeyUp={(e) => e.stopPropagation()}
      className="w-full rounded-lg bg-slate-900 border border-white/15 px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
    />
  );
}

interface AdminSettingsPanelProps {
  open: boolean;
  settings: GameplayConfig;
  isSaving?: boolean;
  sourceLabel: string;
  error?: string | null;
  saveNotice?: string | null;
  onClose: () => void;
  onChange: (key: ConfigKey, value: number) => void;
  onSave: () => void;
  onImport: (text: string) => void;
  onExport: () => void;
}

export function AdminSettingsPanel({
  open,
  settings,
  isSaving = false,
  sourceLabel,
  error,
  saveNotice,
  onClose,
  onChange,
  onSave,
  onImport,
  onExport,
}: AdminSettingsPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const totalFields = useMemo(() => SECTIONS.reduce((sum, section) => sum + section.fields.length, 0), []);

  if (!open) return null;

  return (
    <div
      className="absolute inset-0 z-50 bg-black/85 backdrop-blur-sm p-4 md:p-6"
      onKeyDown={(e) => e.stopPropagation()}
      onKeyUp={(e) => e.stopPropagation()}
    >
      <div className="h-full w-full rounded-3xl border border-white/15 bg-slate-950/95 shadow-2xl flex flex-col overflow-hidden">
        <div className="border-b border-white/10 px-6 py-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold text-white">Админские настройки</h2>
            <p className="text-sm text-slate-300 mt-1">
              Источник: {sourceLabel}. Полей: {totalFields}. Изменения применяются после `Сохранить`.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-white/10 text-white hover:bg-white/20 transition"
          >
            Закрыть
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {error && (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-200 text-sm">
              {error}
            </div>
          )}
          {saveNotice && (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-emerald-200 text-sm">
              {saveNotice}
            </div>
          )}

          {SECTIONS.map((section) => (
            <section key={section.title} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <h3 className="text-xl font-semibold text-white mb-4">{section.title}</h3>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                {section.fields.map((field) => (
                  <label key={field.key} className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="text-white font-medium">{field.label}</div>
                    <div className="text-xs text-slate-400 mt-1 mb-3">{field.help}</div>
                    <ConfigNumberField
                      value={settings[field.key]}
                      onCommit={(next) => onChange(field.key, next)}
                    />
                  </label>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="border-t border-white/10 px-6 py-4 flex flex-wrap gap-3 justify-between items-center">
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={onExport}
              className="px-4 py-2 rounded-xl bg-sky-600 text-white hover:bg-sky-700 transition"
            >
              Скачать JSON
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2 rounded-xl bg-white/10 text-white hover:bg-white/20 transition"
            >
              Загрузить JSON
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const text = await file.text();
                onImport(text);
                e.currentTarget.value = '';
              }}
            />
          </div>

          <button
            type="button"
            onClick={onSave}
            disabled={isSaving}
            className="px-5 py-2 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-60 transition"
          >
            {isSaving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  );
}
