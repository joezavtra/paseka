/**
 * Настройки силовой раскладки: всё, что можно покрутить, не пересобирая
 * приложение.
 *
 * Умолчания подобраны глазом на панели — на дереве, где это выглядит лучше
 * всего. Замеры, из которых выросли сами формулы (почему заряд листа слабее
 * заряда папки, почему у отталкивания есть предел дальности, почему длина
 * ребра зависит от ветвления), остались в докблоках `web/layout/graph.ts`;
 * они обосновывают устройство, а не конкретные числа ниже.
 *
 * Инварианты, которые стоит сохранять при подборе: заряд листа заметно слабее
 * заряда папки — иначе кластер из сотни файлов растянет цепочку транзитных
 * папок в ниточку через полэкрана; предел дальности не ниже примерно 150 —
 * ниже соседние поддеревья перестают расходиться и сливаются в один ком.
 */
export interface LayoutParams {
  /** Отталкивание узла без рисуемых потомков: файла, свёрнутой папки, скрытого поддерева. */
  leafCharge: number;
  /** Базовое отталкивание ветвящегося каталога. */
  dirCharge: number;
  /** Добавка к отталкиванию каталога за каждый пиксель его радиуса. */
  dirChargePerRadius: number;
  /** Дальше этого расстояния отталкивание не действует. */
  chargeDistanceMax: number;
  /** Длина ребра к единственному ребёнку. */
  linkMin: number;
  /** Потолок длины ребра: страховка от вырожденного дерева, а не средство формы. */
  linkMax: number;
  /** Плотность упаковки кружков в папке: меньше — папка просторнее. */
  packFill: number;
  /** Доля радиуса папки, на которой стоят её дети. */
  folderFill: number;
  /** Жёсткость ребра к единственному ребёнку. */
  chainStrength: number;
  /** Жёсткость ребра у ветвящейся папки. */
  branchStrength: number;
  /** Зазор между краями кружков при разведении. */
  collidePadding: number;
  /** Сила разведения: 0 — выключено, 1 — жёстко. */
  collideStrength: number;
  /** Скорость остывания: больше — быстрее замирает. */
  alphaDecay: number;
  /** Затухание скорости: больше — вязче среда. */
  velocityDecay: number;
}

export const DEFAULT_LAYOUT_PARAMS: LayoutParams = {
  leafCharge: -22,
  dirCharge: -150,
  dirChargePerRadius: -12.5,
  chargeDistanceMax: 490,
  linkMin: 10,
  linkMax: 1200,
  packFill: 0.8,
  folderFill: 0.8,
  chainStrength: 1,
  branchStrength: 0.7,
  collidePadding: 2,
  collideStrength: 0.8,
  alphaDecay: 0.015,
  velocityDecay: 0.6,
};

/** Описание одного ползунка: панель строится из этого списка, а не руками. */
export interface ParamSpec {
  key: keyof LayoutParams;
  /** Подпись на панели. */
  label: string;
  min: number;
  max: number;
  step: number;
  /** Что означает величина — уходит в подсказку при наведении. */
  hint: string;
}

/**
 * Порядок здесь — порядок на панели: сперва то, что сильнее всего меняет
 * картинку (отталкивание), потом рёбра, потом разведение и остывание.
 */
export const LAYOUT_PARAM_SPECS: readonly ParamSpec[] = [
  {
    key: 'leafCharge',
    label: 'Заряд файла',
    min: -60,
    max: 0,
    step: 1,
    hint: 'Отталкивание файла и свёрнутой папки. Именно оно раздувает дерево: заряд действует между всеми парами и растёт как квадрат числа узлов.',
  },
  {
    key: 'dirCharge',
    label: 'Заряд папки',
    min: -150,
    max: 0,
    step: 1,
    hint: 'Базовое отталкивание ветвящегося каталога — оно разводит поддеревья.',
  },
  {
    key: 'dirChargePerRadius',
    label: 'Заряд за радиус',
    min: -20,
    max: 0,
    step: 0.5,
    hint: 'Добавка к заряду каталога за каждый пиксель радиуса: крупный узел требует больше места.',
  },
  {
    key: 'chargeDistanceMax',
    label: 'Радиус отталкивания',
    min: 40,
    max: 2000,
    step: 10,
    hint: 'Дальше этого расстояния заряд не действует. Ниже ~150 соседние папки слипаются, выше ~400 дерево растягивает само себя.',
  },
  {
    key: 'linkMin',
    label: 'Ребро: минимум',
    min: 2,
    max: 80,
    step: 1,
    hint: 'Длина ребра к единственному ребёнку. Цепочка транзитных папок состоит из таких рёбер.',
  },
  {
    key: 'linkMax',
    label: 'Ребро: потолок',
    min: 20,
    max: 4000,
    step: 20,
    hint: 'Страховка от вырожденного дерева, где одно поддерево занимает весь репозиторий. На здоровом дереве не срабатывает.',
  },
  {
    key: 'packFill',
    label: 'Плотность упаковки',
    min: 0.4,
    max: 1,
    step: 0.05,
    hint: 'Насколько плотно кружки укладываются в папку. Меньше — папка просторнее, и содержимое свободнее гуляет внутри.',
  },
  {
    key: 'folderFill',
    label: 'Заполнение папки',
    min: 0.3,
    max: 1.2,
    step: 0.05,
    hint: 'Доля радиуса папки, на которой стоят её дети: меньше — содержимое к центру, около единицы — по ободу.',
  },
  {
    key: 'chainStrength',
    label: 'Жёсткость цепочки',
    min: 0,
    max: 1,
    step: 0.05,
    hint: 'Жёсткость ребра к единственному ребёнку. Мягкое звено — это пружина, растягивающая цепочку папок.',
  },
  {
    key: 'branchStrength',
    label: 'Жёсткость ветвления',
    min: 0,
    max: 1,
    step: 0.05,
    hint: 'Жёсткость ребра у ветвящейся папки: слишком жёсткое сминает детей в кучу вокруг родителя.',
  },
  {
    key: 'collidePadding',
    label: 'Зазор кружков',
    min: 0,
    max: 20,
    step: 0.5,
    hint: 'Сколько пикселей мира держать между краями кружков.',
  },
  {
    key: 'collideStrength',
    label: 'Сила разведения',
    min: 0,
    max: 1,
    step: 0.05,
    hint: 'Ноль — узлы снова могут перекрываться.',
  },
  {
    key: 'alphaDecay',
    label: 'Остывание',
    min: 0.002,
    max: 0.1,
    step: 0.001,
    hint: 'Скорость остывания симуляции: больше — быстрее замирает, меньше — дольше ищет равновесие.',
  },
  {
    key: 'velocityDecay',
    label: 'Вязкость',
    min: 0.05,
    max: 0.95,
    step: 0.05,
    hint: 'Затухание скорости: больше — движение вязче и спокойнее.',
  },
];

/** Ползунок по ключу; бросает, если ключа нет, — список и тип обязаны совпадать. */
export function specFor(key: keyof LayoutParams): ParamSpec {
  const spec = LAYOUT_PARAM_SPECS.find((candidate) => candidate.key === key);
  if (!spec) throw new Error(`нет описания параметра ${key}`);
  return spec;
}

/**
 * Приводит что угодно к годным настройкам: чужие ключи выбрасываются, числа
 * зажимаются в границы своего ползунка, негодные значения заменяются
 * умолчанием.
 *
 * Нужно потому, что настройки переживают перезагрузку в хранилище браузера, а
 * оттуда приходит произвольная строка: пользователь мог править её руками,
 * версия приложения могла смениться, а `NaN` в силе — это молча застывшая
 * раскладка без единого следа в консоли.
 */
export function sanitizeParams(input: unknown): LayoutParams {
  const source = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  const result = { ...DEFAULT_LAYOUT_PARAMS };
  for (const spec of LAYOUT_PARAM_SPECS) {
    const value = source[spec.key];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    result[spec.key] = Math.min(spec.max, Math.max(spec.min, value));
  }
  return result;
}

/**
 * Версия набора настроек. Поднимается, когда меняется смысл параметров или их
 * умолчания, — сохранённое от прежней версии тогда читается как умолчание.
 *
 * Без этого обновление проходит незаметно и вредно: старое значение обычно
 * лежит внутри новых границ, `sanitizeParams` его пропускает, и человек,
 * однажды покрутивший ползунки, продолжает видеть прежнюю картинку, не
 * догадываясь, что смотрит на позапрошлую физику.
 */
export const PARAMS_VERSION = 2;

/** Настройки в строку для хранилища, вместе с версией набора. */
export function encodeParams(params: LayoutParams): string {
  return JSON.stringify({ v: PARAMS_VERSION, ...params });
}

/**
 * Настройки из строки хранилища; любой мусор и любая чужая версия дают
 * умолчания. Поле версии в `LayoutParams` не протекает: `sanitizeParams`
 * берёт только описанные ключи.
 */
export function decodeParams(text: string | null): LayoutParams {
  if (text === null) return { ...DEFAULT_LAYOUT_PARAMS };
  try {
    const parsed: unknown = JSON.parse(text);
    const version =
      typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>)['v'] : undefined;
    if (version !== PARAMS_VERSION) return { ...DEFAULT_LAYOUT_PARAMS };
    return sanitizeParams(parsed);
  } catch {
    return { ...DEFAULT_LAYOUT_PARAMS };
  }
}
