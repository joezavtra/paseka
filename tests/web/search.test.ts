import { describe, it, expect } from 'vitest';
import { computeHits, projectHits } from '../../web/state/search.js';
import { HIDDEN } from '../../web/state/visibility.js';
import { buildPack } from '../../src/model/build.js';
import type { RawCommit } from '../../src/git/types.js';

const commit = (hash: string, changes: RawCommit['changes']): RawCommit => ({
  hash,
  authorName: 'A',
  authorEmail: 'a@e.com',
  timestamp: 1,
  subject: hash,
  changes,
});

const add = (path: string, added = 1) => ({
  path,
  kind: 'add' as const,
  added,
  deleted: 0,
  binary: false,
});

const pack = buildPack(
  [commit('c0', [add('src/deep/Utils.ts'), add('src/deep/other.ts'), add('docs/readme.md')])],
  { repoName: 'demo', head: 'c0' },
);

const id = (path: string) => pack.paths.indexOf(path);

describe('computeHits', () => {
  it('пустой образец не даёт ни одного попадания', () => {
    const hits = computeHits(pack, '');
    expect([...hits].every((value) => value === 0)).toBe(true);
  });

  it('образец из одних пробелов тоже не даёт попаданий', () => {
    const hits = computeHits(pack, '   ');
    expect([...hits].every((value) => value === 0)).toBe(true);
  });

  it('без подстановок ищет подстроку без учёта регистра', () => {
    const hits = computeHits(pack, 'utils');
    expect(hits[id('src/deep/Utils.ts')]).toBe(1);
    expect(hits[id('src/deep/other.ts')]).toBe(0);
  });

  it('со звёздочкой ищет по образцу, как фильтр пути', () => {
    const hits = computeHits(pack, 'src/deep/*.ts');
    expect(hits[id('src/deep/Utils.ts')]).toBe(1);
    expect(hits[id('src/deep/other.ts')]).toBe(1);
    expect(hits[id('docs/readme.md')]).toBe(0);
  });

  it('попадание не поднимается к родителям', () => {
    const hits = computeHits(pack, 'Utils');
    expect(hits[id('src/deep/Utils.ts')]).toBe(1);
    expect(hits[id('src/deep')]).toBe(0);
    expect(hits[id('src')]).toBe(0);
    expect(hits[0]).toBe(0);
  });
});

describe('projectHits', () => {
  it('переносит попадание на представителя: файл внутри свёрнутой папки обводит папку', () => {
    // Путь 0 — папка, путь 1 — файл внутри неё, свёрнутой в саму папку.
    const hits = Uint8Array.from([0, 1]);
    const representative = Int32Array.from([0, 0]);
    const drawn = Uint8Array.from([1, 0]);

    const { drawnHits, first, count } = projectHits(hits, representative, drawn);

    expect(drawnHits[0]).toBe(1);
    expect(drawnHits[1]).toBe(0);
    expect(first).toBe(0);
    expect(count).toBe(1);
  });

  it('попадание в скрытом поддереве исчезает и не считается', () => {
    const hits = Uint8Array.from([1]);
    const representative = Int32Array.from([HIDDEN]);
    const drawn = Uint8Array.from([0]);

    const { drawnHits, first, count } = projectHits(hits, representative, drawn);

    expect([...drawnHits].every((value) => value === 0)).toBe(true);
    expect(first).toBe(-1);
    expect(count).toBe(0);
  });

  it('first — наименьший идентификатор среди обведённых, -1 при отсутствии попаданий', () => {
    const hits = Uint8Array.from([0, 1, 0, 1]);
    const representative = Int32Array.from([0, 3, 2, 3]);
    const drawn = Uint8Array.from([1, 0, 1, 1]);

    const { first } = projectHits(hits, representative, drawn);
    expect(first).toBe(3);

    const none = projectHits(new Uint8Array(4), representative, drawn);
    expect(none.first).toBe(-1);
  });

  it('count считает обведённые узлы, а не исходные совпадения', () => {
    // Два файла внутри одной свёрнутой папки: оба бьют в одного представителя.
    // Все три массива живут в одном пространстве идентификаторов путей — путь
    // 2 сам является представителем (свёрнутой папкой), а пути 0 и 1 — файлы
    // внутри неё.
    const hits = Uint8Array.from([1, 1, 0]);
    const representative = Int32Array.from([2, 2, 2]);
    const drawn = Uint8Array.from([0, 0, 1]);

    const { drawnHits, count, first } = projectHits(hits, representative, drawn);

    expect(count).toBe(1);
    expect(drawnHits[2]).toBe(1);
    expect(first).toBe(2);
  });

  it('попадание в неживой (не рисуемый) представитель не считается', () => {
    const hits = Uint8Array.from([1]);
    const representative = Int32Array.from([0]);
    const drawn = Uint8Array.from([0]);

    const { count, first } = projectHits(hits, representative, drawn);
    expect(count).toBe(0);
    expect(first).toBe(-1);
  });
});
