/** Начиная с какого экранного радиуса узел подписывается сам по себе. */
export const MIN_LABEL_RADIUS_PX = 9;
/** Сколько подписей рисуется в кадре: дальше они превращаются в кашу. */
export const DEFAULT_LABEL_LIMIT = 24;
/** Поле в экранных пикселях за краем вида, в котором узел ещё считается видимым. */
const EDGE_MARGIN_PX = 40;
/** Ниже этой яркости узел считается погашенным фильтром и не подписывается сам собой. */
const DIMMED_ALPHA_THRESHOLD = 0.5;

/**
 * Русское числительное для счётчика файлов. Вынесено отдельной функцией и
 * покрыто трудными числами (11–14, 21, 111) намеренно: «11 файла» в подписи
 * читается как небрежность во всём инструменте.
 */
export function pluralFiles(count: number): string {
  const abs = Math.abs(Math.trunc(count));
  const tens = abs % 100;
  const ones = abs % 10;
  if (tens >= 11 && tens <= 14) return `${abs} файлов`;
  if (ones === 1) return `${abs} файл`;
  if (ones >= 2 && ones <= 4) return `${abs} файла`;
  return `${abs} файлов`;
}

/** Подпись узла: у свёрнутой папки — с числом спрятанных файлов. */
export function labelFor(name: string, files: number): string {
  return files > 0 ? `${name} · ${pluralFiles(files)}` : name;
}

/** Всё, что нужно знать о сцене, чтобы решить, какие узлы подписывать. */
export interface LabelInput {
  /** Рисуемая маска; индекс — идентификатор пути. */
  active: Uint8Array;
  /** Пары x, y в мировых координатах. */
  positions: Float32Array;
  radius: Float32Array;
  /** Яркость узла от фильтра: 1 — попал, около нуля — погашен. */
  alpha: Float32Array;
  /** Найденное поиском; индекс — идентификатор пути. */
  hit: Uint8Array;
}

/** Камера принимается структурно, чтобы тест не поднимал DOM. */
export interface LabelCamera {
  scale: number;
  toScreen(worldX: number, worldY: number): [number, number];
}

export interface LabelOptions {
  /** Путь под курсором мыши; -1 или отсутствие — наведения нет. */
  hovered?: number;
  /** Сколько подписей разрешено вернуть. */
  limit?: number;
}

/**
 * Отбирает узлы для подписи на текущем кадре и возвращает их идентификаторы
 * пути в порядке отрисовки: наведённый — первым, за ним найденные поиском, а
 * дальше остальные отобранные — по убыванию экранного радиуса. Список не
 * длиннее `limit`.
 *
 * Правило отбора одного узла:
 * - рисуется (`active === 1`) — иначе подписывать нечего;
 * - виден на экране (с полем в EDGE_MARGIN_PX по обе стороны);
 * - крупный (экранный радиус ≥ MIN_LABEL_RADIUS_PX) подписывается сам по
 *   себе; мелкий — только если он наведён или найден поиском;
 * - погашенный фильтром (alpha < DIMMED_ALPHA_THRESHOLD) не подписывается,
 *   кроме наведённого: на него пользователь показывает явно, и молчать в
 *   ответ нельзя. Найденность поиском не даёт этой поблажки — фильтр гасит
 *   узел осознанно, и подпись поверх погашенной ветки читалась бы как отмена
 *   фильтра.
 */
export function selectLabels(
  input: LabelInput,
  camera: LabelCamera,
  width: number,
  height: number,
  options: LabelOptions = {},
): number[] {
  const hovered = options.hovered ?? -1;
  const limit = options.limit ?? DEFAULT_LABEL_LIMIT;

  const picked: number[] = [];
  const screenRadius: number[] = [];

  for (let path = 0; path < input.active.length; path++) {
    if (input.active[path] !== 1) continue;

    const isHovered = path === hovered;
    const dimmed = input.alpha[path]! < DIMMED_ALPHA_THRESHOLD;
    // Погашенный узел молчит, кроме наведённого — на него пользователь
    // показывает явно, и ответ на явный жест не может быть тишиной.
    if (dimmed && !isHovered) continue;

    const [sx, sy] = camera.toScreen(input.positions[path * 2]!, input.positions[path * 2 + 1]!);
    const r = Math.max(0, input.radius[path]!) * camera.scale;
    if (sx + r < -EDGE_MARGIN_PX || sy + r < -EDGE_MARGIN_PX) continue;
    if (sx - r > width + EDGE_MARGIN_PX || sy - r > height + EDGE_MARGIN_PX) continue;

    const large = r >= MIN_LABEL_RADIUS_PX;
    const isHit = input.hit[path] === 1;
    if (!large && !isHovered && !isHit) continue;

    picked.push(path);
    screenRadius.push(r);
  }

  // Сортируем индексы в parallel-массивах, а не сами пути: поиск радиуса по
  // пути через indexOf() на каждое сравнение был бы квадратичным.
  const order = picked.map((_, i) => i);
  const priorityOf = (path: number): number => (path === hovered ? 0 : input.hit[path] === 1 ? 1 : 2);
  order.sort((ai, bi) => {
    const a = picked[ai]!;
    const b = picked[bi]!;
    const diff = priorityOf(a) - priorityOf(b);
    if (diff !== 0) return diff;
    // Внутри одной группы приоритета — по убыванию экранного радиуса.
    return screenRadius[bi]! - screenRadius[ai]!;
  });

  return order.slice(0, limit).map((i) => picked[i]!);
}
