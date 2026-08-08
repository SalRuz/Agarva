import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameplayConfig } from '../../shared/gameConfig';
import type { SkinInfo } from '../skins/loadSkins';

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
      { key: 'worldWidth', label: 'Ширина карты', help: 'Физическая ширина мира (классик).', step: 100 },
      { key: 'worldHeight', label: 'Высота карты', help: 'Физическая высота мира (классик).', step: 100 },
      {
        key: 'soloFightWorldSize',
        label: 'Масштаб карты соло файта',
        help: 'Сторона квадратной карты режима «Соло файт» (физика как в классике).',
        step: 100,
      },
      { key: 'serverTickHz', label: 'Tick rate сервера', help: 'Частота обновления сервера в секунду.', step: 1 },
      { key: 'foodNetMax', label: 'Лимит еды в снапшоте', help: 'Сколько кусочков еды максимум отправлять клиенту (1–1500).', step: 1 },
      { key: 'ejectNetMax', label: 'Макс. W в обзоре', help: 'Сколько W максимум отображать и отправлять клиенту в его обзоре (1–1500).', step: 1 },
      { key: 'lowTrafficMode', label: 'Экономия трафика (0/1)', help: '1 = меньше трафика: еда обновляется реже, но клетки, вирусы и W остаются на обычной частоте.', step: 1 },
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
      { key: 'splitBoost', label: 'Сила деления', help: 'Базовая начальная скорость разлёта после пробела.', step: 0.1 },
      { key: 'splitLaunchSharpness', label: 'Резкость вылета (общая)', help: 'Множитель резкости/плавности вылета частей (1 = по умолчанию; >1 резче и быстрее старт, <1 мягче).', step: 0.05 },
      { key: 'splitLaunchSharpnessSmall', label: 'Резкость мелких частей', help: 'Доп. множитель для более мелких осколков при делении.', step: 0.05 },
      { key: 'splitLaunchSharpnessLarge', label: 'Резкость крупных частей', help: 'Доп. множитель для более крупных осколков при делении.', step: 0.05 },
      { key: 'centerCursorSplitChainEnabled', label: 'Цепь при курсоре в центре (0/1)', help: '1 = пробел при курсоре в центре сохраняет одно направление и строит цепь; 0 = прежнее раздельное направление частей.', step: 1 },
      { key: 'splitInheritVelocityEnabled', label: 'Наследование скорости при сплите (0/1)', help: '1 = новая часть получает скорость родителя плюс импульс; 0 = только новый импульс, как в старой физике.', step: 1 },
      { key: 'splitFriction', label: 'Трение деления', help: 'Как быстро затухает сплит-буст.', step: 0.001 },
      { key: 'splitSpawnOffset', label: 'Смещение новой части', help: 'На каком расстоянии новая часть появляется при делении.', step: 0.01 },
      { key: 'mergeBaseMs', label: 'База таймера слияния', help: 'Базовая часть merge-таймера в миллисекундах.', step: 100 },
      { key: 'mergeMassFactor', label: 'Фактор массы для merge', help: 'Сколько миллисекунд добавляется за 1 массы.', step: 0.1 },
      { key: 'mergeCoverage', label: 'Порог слияния', help: 'Какая доля маленькой клетки должна войти в большую для merge.', step: 0.01 },
      { key: 'eatMassMult', label: 'Множитель съедания', help: 'Насколько тяжелее нужно быть, чтобы съесть другую клетку.', step: 0.01 },
      { key: 'eatCoverage', label: 'Порог съедания', help: 'Какая доля цели должна зайти внутрь для поглощения.', step: 0.01 },
      { key: 'separationStiffness', label: 'Жёсткость разделения', help: 'Сила расталкивания своих частей до merge.', step: 0.01 },
      { key: 'separationIterations', label: 'Итерации разделения', help: 'Сколько проходов коллизий своих частей делается за тик.', step: 1 },
      { key: 'squeezeThroughEnabled', label: 'Протискивание мелких (0/1)', help: '1 = мелкие свои клетки могут постепенно протискиваться между крупными, слегка раздвигая их.', step: 1 },
      { key: 'autoSplitEnabled', label: 'Автосплит при большой массе (0/1)', help: '1 = включено: если одна клетка достигла порога массы, она автоматически делится на 2 части в сторону курсора.', step: 1 },
      { key: 'autoSplitMassThreshold', label: 'Порог автосплита', help: 'Масса одной клетки, при которой срабатывает автосплит (по умолчанию 22500).', step: 100 },
    ],
  },
  {
    title: 'Еда',
    fields: [
      { key: 'foodMass', label: 'Масса еды', help: 'Сколько массы даёт одна маленькая частица.', step: 0.1 },
      { key: 'foodCountMp', label: 'Лимит мелкой еды (кап)', help: 'Целевое максимальное количество мелких пеллет на карте.', step: 1 },
      { key: 'foodRespawnThreshold', label: 'Порог респавна еды', help: 'Когда еды меньше этого числа, сервер добавляет новую.', step: 1 },
      { key: 'foodRespawnBatch', label: 'Скорость спавна еды', help: 'Сколько пеллет сервер добавляет за тик, когда еды меньше порога. Больше = быстрее восстановление.', step: 1 },
      { key: 'foodViewRadius', label: 'Базовый FOV еды', help: 'Базовая дальность видимости еды.', step: 10 },
      { key: 'foodViewScale', label: 'Множитель FOV частиц', help: '1 = обычный обзор; 1.5 = примерно в полтора раза дальше.', step: 0.1 },
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
      { key: 'virusPopKeepInertia', label: 'Сохранять инерцию после колючки (0/1)', help: '1 = после взрыва об колючку основная клетка и осколки сохраняют текущий импульс; 0 = останавливаются, как раньше.', step: 1 },
      { key: 'virusSplitSpeed', label: 'Скорость вылета колючки', help: 'Скорость новой летящей колючки после перекорма.', step: 0.1 },
      { key: 'virusFriction', label: 'Трение летящей колючки', help: 'Как быстро затухает скорость летящей колючки.', step: 0.001 },
      { key: 'virusEjectCoverage', label: 'Порог кормления колючки', help: 'Насколько глубоко W должна войти в колючку.', step: 0.01 },
      { key: 'virusAbsorbCoverage', label: 'Порог поглощения колючки', help: 'Какая доля колючки должна войти в клетку, чтобы она поглотилась / взорвала игрока.', step: 0.01 },
      { key: 'virusBounceFromEject', label: 'Отскок колючки от W (0/1)', help: '1 = летящая колючка отскакивает от выброшенной массы (W) в обратную сторону; 0 = выключено.', step: 1 },
      { key: 'virusEjectInteractionMode', label: 'Режим W/колючек: 1/2', help: '1 = старый отскок. 2 = отскок только при встрече летящей колючки и летящей W; неподвижная колючка всегда поглощает W и стреляет после заполнения.', step: 1 },
      { key: 'virusPopSharpnessSmall', label: 'Резкость мелких осколков (вирус)', help: 'Множитель скорости вылета мелких частей при взрыве об колючку.', step: 0.05 },
      { key: 'virusPopSharpnessLarge', label: 'Резкость крупных осколков (вирус)', help: 'Множитель скорости вылета крупных частей при взрыве об колючку.', step: 0.05 },
      { key: 'virusPopRangeSmall', label: 'Дальность мелких осколков (вирус)', help: 'Множитель дистанции разлёта мелких частей при взрыве.', step: 0.05 },
      { key: 'virusPopRangeLarge', label: 'Дальность крупных осколков (вирус)', help: 'Множитель дистанции разлёта крупных частей при взрыве.', step: 0.05 },
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
      { key: 'ejectMaxCount', label: 'Максимум W на карте', help: 'Мягкий предел количества W на карте (по умолчанию 3000).', step: 1 },
    ],
  },
  {
    title: 'Распад, боты и админ',
    fields: [
      { key: 'massDecayPerSec', label: 'Распад массы в секунду', help: 'Какой процент массы теряется в секунду.', step: 0.0001 },
      { key: 'massDecayMin', label: 'Порог распада', help: 'Ниже этой массы распад не применяется.', step: 1 },
      { key: 'botAiIntervalMs', label: 'Интервал ИИ ботов', help: 'Как часто боты пересчитывают решение.', step: 1 },
      { key: 'botCountMp', label: 'Боты на сервере', help: 'Целевое число ботов на сервере.', step: 1 },
      { key: 'adminMassBoost', label: 'Q: сколько массы добавить', help: 'Сколько массы даёт админская кнопка Q.', step: 1 },
      { key: 'cursorSlowdownEnabled', label: 'Замедление у курсора (0/1)', help: '1 = клетка чуть ползёт, когда курсор на ней / рядом (стелс).', step: 1 },
      { key: 'cursorSlowdownFactor', label: 'Сила замедления у курсора', help: 'Множитель скорости в центре зоны (0.55 ≈ чуть медленнее).', step: 0.01 },
      { key: 'cursorSlowdownRadiusMult', label: 'Радиус зоны замедления', help: 'Во сколько радиусов клетки действует замедление (1.05 ≈ до края).', step: 0.01 },
    ],
  },
  {
    title: 'Обзор и наблюдение',
    fields: [
      { key: 'playViewRadiusMult', label: 'FOV в игре (множитель)', help: 'Множитель радиуса видимости клеток/колючек во время игры (баз. = размер сектора).', step: 0.05 },
      { key: 'spectateViewRadiusMult', label: 'FOV в наблюдении (множитель)', help: 'Множитель радиуса видимости при spectate / после смерти.', step: 0.05 },
      { key: 'spectatePanSpeed', label: 'Скорость панорамы', help: 'Как быстро камера едет за курсором в режиме наблюдения.', step: 1 },
      { key: 'spectateMinZoom', label: 'Мин. зум наблюдения', help: 'Минимальный zoom колёсиком в spectate (отдаление; низкое значение нужно, чтобы огромные клетки влезали в кадр). Игроки ограничены ~0.4–2.2.', step: 0.01 },
      { key: 'spectateMaxZoom', label: 'Макс. зум наблюдения', help: 'Максимальный zoom колёсиком в spectate (приближение). По умолчанию очень высокий (~250 ≈ «безлимит»).', step: 1 },
      { key: 'cameraBaseScale', label: 'Базовый масштаб камеры', help: 'Общий множитель масштаба камеры (и в игре, и в наблюдении).', step: 0.01 },
    ],
  },
  {
    title: 'Локальная визуализация',
    fields: [
      { key: 'nameScale', label: 'Размер ника (доля радиуса)', help: 'Размер ника относительно радиуса клетки (≈0.28 как в классике).', step: 0.01 },
      { key: 'nameStrokeWidth', label: 'Толщина обводки ника', help: 'Толщина обводки относительно шрифта (0 = почти без обводки; 0.02 по умолчанию).', step: 0.005 },
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
  onDownloadDb?: () => void;
  onUploadDb?: (text: string) => void;
  onWipeDatabase?: () => void;
  onRestartClassic?: () => void;
  onGetBotLogs?: () => void;
  botLogs?: string;
  customSkins?: SkinInfo[];
  onUploadSkin?: (file: File, name: string, kind: 'global' | 'shop' | 'level', price: number, level: number) => Promise<void>;
  onDeleteSkin?: (skin: SkinInfo) => Promise<void>;
  telegramChannelUrl?: string;
  onSaveTelegramChannel?: (url: string) => Promise<void>;
  weeklyTopPrizes?: Record<'classic' | 'soloFight' | 'duoFight' | 'trioFight', number>;
  onSaveWeeklyTopPrizes?: (prizes: Record<'classic' | 'soloFight' | 'duoFight' | 'trioFight', number>) => Promise<void>;
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
  onDownloadDb,
  onUploadDb,
  onWipeDatabase,
  onRestartClassic,
  onGetBotLogs,
  botLogs = '',
  customSkins = [],
  onUploadSkin,
  onDeleteSkin,
  telegramChannelUrl = '',
  onSaveTelegramChannel,
  weeklyTopPrizes = { classic: 60, soloFight: 60, duoFight: 60, trioFight: 60 },
  onSaveWeeklyTopPrizes,
}: AdminSettingsPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dbFileInputRef = useRef<HTMLInputElement>(null);
  const [wipeConfirmation, setWipeConfirmation] = useState('');
  const [wipeOpen, setWipeOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const skinFileInputRef = useRef<HTMLInputElement>(null);
  const [skinName, setSkinName] = useState('');
  const [skinBusy, setSkinBusy] = useState(false);
  const [skinKind, setSkinKind] = useState<'global' | 'shop' | 'level'>('global');
  const [skinPrice, setSkinPrice] = useState('0');
  const [skinLevel, setSkinLevel] = useState('1');
  const [telegramUrl, setTelegramUrl] = useState(telegramChannelUrl);
  const [prizes, setPrizes] = useState(weeklyTopPrizes);
  const totalFields = useMemo(() => SECTIONS.reduce((sum, section) => sum + section.fields.length, 0), []);

  if (!open) return null;

  return (
    <div
      className="absolute inset-0 z-50 bg-black/85 backdrop-blur-sm p-4 md:p-6"
      onKeyDown={(e) => e.stopPropagation()}
      onKeyUp={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div
        className="h-full w-full rounded-3xl border border-white/15 bg-slate-950/95 shadow-2xl flex flex-col overflow-hidden"
        onWheel={(e) => e.stopPropagation()}
      >
        <div className="border-b border-white/10 px-6 py-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold text-white">Админские настройки</h2>
            <p className="text-sm text-slate-300 mt-1">
              Источник: {sourceLabel}. Полей: {totalFields}. Изменения применяются после `Сохранить`.
              Физика «Соло файт» всегда совпадает с классиком; отдельно задаётся только масштаб карты режима.
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

          <section className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
            <h3 className="text-xl font-semibold text-white mb-2">Глобальная база данных</h3>
            <p className="text-xs text-slate-400 mb-3">
              Топы файт-режимов, ники и настройки игроков (по устройству), админ-конфиг. Файл: data/agarva.db.json
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => onDownloadDb?.()}
                className="px-4 py-2 rounded-xl bg-amber-600 text-white hover:bg-amber-700 transition"
              >
                Скачать БД
              </button>
              <button
                type="button"
                onClick={() => dbFileInputRef.current?.click()}
                className="px-4 py-2 rounded-xl bg-white/10 text-white hover:bg-white/20 transition"
              >
                Загрузить БД
              </button>
              <input
                ref={dbFileInputRef}
                type="file"
                accept="application/json"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const text = await file.text();
                  onUploadDb?.(text);
                  e.currentTarget.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => {
                  setWipeConfirmation('');
                  setWipeOpen(true);
                }}
                className="px-4 py-2 rounded-xl bg-red-700 text-white hover:bg-red-800 transition"
              >
                Стереть всю базу данных
              </button>
              <button
                type="button"
                onClick={() => {
                  onGetBotLogs?.();
                  setLogsOpen(true);
                }}
                className="px-4 py-2 rounded-xl bg-violet-700 text-white hover:bg-violet-800 transition"
              >
                Логи Telegram-бота
              </button>
            </div>
          </section>

          <section className="rounded-2xl border border-sky-400/25 bg-sky-500/5 p-4">
            <h3 className="text-xl font-semibold text-white mb-2">Сервер</h3>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => {
                  if (window.confirm('Перезагрузить только Classic? Поле, еда, W, колючки и игроки Classic будут сброшены. Соло/Дуо/Трио не затрагиваются.')) onRestartClassic?.();
                }}
                className="mt-2 rounded-xl bg-red-700 px-4 py-2 text-white hover:bg-red-800 transition"
              >
                Перезагрузить классик сервер
              </button>
            </div>
          </section>

          <section className="rounded-2xl border border-amber-400/25 bg-amber-500/5 p-4">
            <h3 className="text-xl font-semibold text-white mb-2">Недельные награды</h3>
            <p className="mb-3 text-xs text-slate-400">Агарвики, которые получает #1 по итогам недели в каждом режиме.</p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {([['classic', 'Классик'], ['soloFight', 'Соло'], ['duoFight', 'Дуо'], ['trioFight', 'Трио']] as const).map(([mode, label]) => (
                <label key={mode} className="text-sm text-slate-200">{label}
                  <input type="number" min="0" value={prizes[mode]} onChange={(e) => setPrizes((current) => ({ ...current, [mode]: Math.max(0, Number(e.target.value) || 0) }))} className="mt-1 w-full rounded-lg border border-white/15 bg-slate-900 px-3 py-2 text-white" />
                </label>
              ))}
            </div>
            <button type="button" onClick={() => void onSaveWeeklyTopPrizes?.(prizes)} className="mt-3 rounded-xl bg-amber-600 px-4 py-2 text-white">Сохранить награды</button>
          </section>

          <section className="rounded-2xl border border-fuchsia-400/25 bg-fuchsia-500/5 p-4">
            <h3 className="text-xl font-semibold text-white mb-2">Пользовательские скины</h3>
            <p className="text-xs text-slate-400 mb-3">
              PNG, JPG или WEBP до 10 МБ. После загрузки скин сразу появится у всех игроков в выборе скинов.
            </p>
            <div className="flex flex-wrap gap-3 items-end">
              <label className="block">
                <span className="mb-1 block text-xs text-slate-300">Название</span>
                <input
                  value={skinName}
                  onChange={(event) => setSkinName(event.target.value)}
                  maxLength={40}
                  className="rounded-lg border border-white/15 bg-slate-900 px-3 py-2 text-white"
                  placeholder="Например, мой скин"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-slate-300">Раздел</span>
                <select value={skinKind} onChange={(event) => setSkinKind(event.target.value as 'global' | 'shop' | 'level')} className="rounded-lg border border-white/15 bg-slate-900 px-3 py-2 text-white">
                  <option value="global">Глобальный</option>
                  <option value="shop">Магазин</option>
                  <option value="level">Награда за уровень</option>
                </select>
              </label>
              {skinKind === 'shop' && <label className="block"><span className="mb-1 block text-xs text-slate-300">Цена, агарвики</span><input value={skinPrice} onChange={(e) => setSkinPrice(e.target.value)} inputMode="numeric" className="w-28 rounded-lg border border-white/15 bg-slate-900 px-3 py-2 text-white" /></label>}
              {skinKind === 'level' && <label className="block"><span className="mb-1 block text-xs text-slate-300">Уровень</span><input value={skinLevel} onChange={(e) => setSkinLevel(e.target.value)} inputMode="numeric" className="w-28 rounded-lg border border-white/15 bg-slate-900 px-3 py-2 text-white" /></label>}
              <button
                type="button"
                disabled={skinBusy}
                onClick={() => skinFileInputRef.current?.click()}
                className="rounded-xl bg-fuchsia-700 px-4 py-2 text-white disabled:opacity-50"
              >
                {skinBusy ? 'Загрузка…' : 'Добавить фото'}
              </button>
              <input
                ref={skinFileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  event.currentTarget.value = '';
                  if (!file || !onUploadSkin) return;
                  setSkinBusy(true);
                  try {
                    await onUploadSkin(file, skinName, skinKind, Number(skinPrice), Number(skinLevel));
                    setSkinName('');
                  } finally {
                    setSkinBusy(false);
                  }
                }}
              />
            </div>
            {customSkins.length > 0 ? (
              <>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-amber-300/25 bg-amber-500/5 p-3">
                  <div className="text-sm font-semibold text-amber-100">Награды за уровни</div>
                  {customSkins.filter((skin) => skin.kind === 'level').length ? customSkins.filter((skin) => skin.kind === 'level').map((skin) => (
                    <div key={skin.id} className="mt-1 text-xs text-slate-200">Уровень {skin.level ?? 1} · {skin.name} · <span className="font-mono text-slate-400">{skin.id}</span></div>
                  )) : <div className="mt-1 text-xs text-slate-500">Нет добавленных скинов.</div>}
                </div>
                <div className="rounded-xl border border-sky-300/25 bg-sky-500/5 p-3">
                  <div className="text-sm font-semibold text-sky-100">Магазин</div>
                  {customSkins.filter((skin) => skin.kind === 'shop').length ? customSkins.filter((skin) => skin.kind === 'shop').map((skin) => (
                    <div key={skin.id} className="mt-1 text-xs text-slate-200">{skin.name} · {skin.price ?? 0} агарвиков · <span className="font-mono text-slate-400">{skin.id}</span></div>
                  )) : <div className="mt-1 text-xs text-slate-500">Нет добавленных скинов.</div>}
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {customSkins.map((skin) => (
                  <div key={skin.id} className="rounded-xl border border-white/10 bg-black/20 p-2">
                    <img src={skin.url} alt={skin.name} className="aspect-square w-full rounded-lg object-cover" />
                    <div className="mt-2 truncate text-sm text-white" title={skin.name}>{skin.name}</div>
                    <button
                      type="button"
                      disabled={skinBusy}
                      onClick={async () => {
                        if (!onDeleteSkin || !window.confirm(`Удалить скин «${skin.name}»?`)) return;
                        setSkinBusy(true);
                        try {
                          await onDeleteSkin(skin);
                        } finally {
                          setSkinBusy(false);
                        }
                      }}
                      className="mt-2 w-full rounded-lg bg-red-800 px-2 py-1 text-xs text-white disabled:opacity-50"
                    >
                      Удалить
                    </button>
                  </div>
                ))}
              </div>
              </>
            ) : (
              <p className="mt-4 text-sm text-slate-400">Пока нет загруженных скинов.</p>
            )}
          </section>

          <section className="rounded-2xl border border-sky-400/25 bg-sky-500/5 p-4">
            <h3 className="text-xl font-semibold text-white mb-2">Telegram-канал</h3>
            <p className="mb-3 text-xs text-slate-400">Пустая ссылка скрывает кнопку в главном меню.</p>
            <div className="flex flex-wrap gap-3">
              <input value={telegramUrl} onChange={(event) => setTelegramUrl(event.target.value)} placeholder="https://t.me/..." className="min-w-64 flex-1 rounded-lg border border-white/15 bg-slate-900 px-3 py-2 text-white" />
              <button type="button" onClick={() => void onSaveTelegramChannel?.(telegramUrl)} className="rounded-xl bg-sky-600 px-4 py-2 text-white">Сохранить канал</button>
            </div>
          </section>

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
      {wipeOpen && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-md rounded-2xl border border-red-500/40 bg-slate-950 p-6 shadow-2xl">
            <h3 className="text-xl font-bold text-red-200">Стереть всю базу?</h3>
            <p className="mt-2 text-sm text-slate-300">
              Необратимо удалятся аккаунты, Telegram-привязки, профили устройств, топы и сохранённый админ-конфиг.
              Введите <strong>confirm</strong> или <strong>конфирм</strong> для подтверждения.
            </p>
            <input
              autoFocus
              value={wipeConfirmation}
              onChange={(event) => setWipeConfirmation(event.target.value)}
              className="mt-4 w-full rounded-lg border border-white/15 bg-slate-900 px-3 py-2 text-white"
              placeholder="confirm"
            />
            <div className="mt-4 flex justify-end gap-3">
              <button type="button" onClick={() => setWipeOpen(false)} className="rounded-xl bg-white/10 px-4 py-2 text-white">Отмена</button>
              <button
                type="button"
                disabled={!/^(confirm|конфирм)$/iu.test(wipeConfirmation.trim())}
                onClick={() => {
                  onWipeDatabase?.();
                  setWipeOpen(false);
                }}
                className="rounded-xl bg-red-700 px-4 py-2 font-semibold text-white disabled:opacity-40"
              >
                Стереть навсегда
              </button>
            </div>
          </div>
        </div>
      )}
      {logsOpen && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/80 p-4">
          <div className="flex h-[80vh] w-full max-w-4xl flex-col rounded-2xl border border-violet-400/30 bg-slate-950 p-5 shadow-2xl">
            <div className="mb-3 flex items-center justify-between gap-4">
              <h3 className="text-xl font-bold text-white">Логи Telegram-бота</h3>
              <div className="flex gap-2">
                <button type="button" onClick={() => onGetBotLogs?.()} className="rounded-lg bg-violet-700 px-3 py-1.5 text-sm text-white">Обновить</button>
                <button type="button" onClick={() => setLogsOpen(false)} className="rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white">Закрыть</button>
              </div>
            </div>
            <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded-xl bg-black/40 p-4 text-xs text-emerald-200">
              {botLogs || 'Запрашиваю логи…'}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
