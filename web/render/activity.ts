import type { ActorTarget } from './actors.js';
import type { RecentEvents } from '../time/recent.js';

/** Свечение узла: путь и сила, с которой он подсвечен в этом кадре. */
export interface ActivityFlash {
  path: number;
  strength: number;
}

/**
 * Луч в мировых координатах. Конец разрешён здесь же, где событие прошло
 * проверку на видимость: в срезе 5 у свёрнутой папки концом станет её
 * представитель, и подменить это придётся ровно в одном месте.
 * Начало ставит точка входа — после того как поле авторов сделало свой шаг.
 */
export interface ActivityBeam {
  author: number;
  toX: number;
  toY: number;
  strength: number;
}

export interface ActivityFrame {
  /** По одному элементу на путь: несколько событий одного пути сливаются в самое яркое. */
  flashes: ActivityFlash[];
  beams: ActivityBeam[];
  /** Цели значков — по автору на каждого, у кого в кадре есть хоть один видимый файл. */
  targets: ActorTarget[];
}

/** Состояние сцены, из которого выводится кадр: маска живых и позиции узлов. */
export interface ActivityScene {
  active: Uint8Array;
  positions: Float32Array;
}

interface Centroid {
  x: number;
  y: number;
  hits: number;
}

/**
 * Выводит из буфера событий всё, что рисуется поверх дерева: свечение узлов,
 * лучи и цели авторов.
 *
 * Единственное место, где решается, видно ли событие: путь обязан быть жив.
 * Мёртвый путь не даёт ни вспышки, ни луча, ни вклада в центроид — поэтому и
 * число авторов в строке состояния равно targets.length и не может разойтись
 * с картинкой. Отдельный подсчёт авторов по буферу был бы именно таким
 * расхождением: коммит, который только удаляет файлы, в буфере есть, а на
 * экране его нет.
 *
 * Функция чистая: буфер и сцену только читает, а результат каждый кадр
 * собирает заново. Объём этой сборки ограничен числом живых событий (потолок
 * буфера — сотни), а не размером репозитория; копилок на каждого автора пакета
 * здесь нет намеренно, иначе кадр платил бы за тысячи авторов, из которых
 * активны единицы.
 */
export function deriveActivity(
  recent: RecentEvents,
  scene: ActivityScene,
  nowMs: number,
  beamLimit: number,
): ActivityFrame {
  const flashes: ActivityFlash[] = [];
  /** Путь — его место в flashes: одно событие на путь, самое сильное. */
  const flashAt = new Map<number, number>();
  const beams: ActivityBeam[] = [];
  const centroids = new Map<number, Centroid>();

  recent.forEach(nowMs, (path, author, strength) => {
    if (scene.active[path] !== 1) return;
    const x = scene.positions[path * 2]!;
    const y = scene.positions[path * 2 + 1]!;

    const at = flashAt.get(path);
    if (at === undefined) {
      flashAt.set(path, flashes.length);
      flashes.push({ path, strength });
    } else if (flashes[at]!.strength < strength) {
      flashes[at]!.strength = strength;
    }

    const centroid = centroids.get(author);
    if (centroid === undefined) centroids.set(author, { x, y, hits: 1 });
    else {
      centroid.x += x;
      centroid.y += y;
      centroid.hits++;
    }

    if (beams.length < beamLimit) beams.push({ author, toX: x, toY: y, strength });
  });

  // Порядок целей — по возрастанию идентификатора автора, а не по порядку
  // событий в буфере: поле авторов не должно зависеть от того, чей коммит
  // лёг в кольцо раньше.
  const targets: ActorTarget[] = [];
  for (const author of [...centroids.keys()].sort((a, b) => a - b)) {
    const centroid = centroids.get(author)!;
    targets.push({ author, x: centroid.x / centroid.hits, y: centroid.y / centroid.hits });
  }

  return { flashes, beams, targets };
}
