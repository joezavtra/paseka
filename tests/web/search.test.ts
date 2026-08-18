import { describe, it, expect } from 'vitest';
import { computeHits, projectHits } from '../../web/state/search.js';
import { HIDDEN, resolveVisibility } from '../../web/state/visibility.js';
import { TimeEngine } from '../../web/time/engine.js';
import { buildPack } from '../../src/model/build.js';
import type { RawCommit } from '../../src/git/types.js';

/** Все пути живы — большинство тестов projectHits живость не проверяют. */
const allAlive = (n: number): Uint8Array => new Uint8Array(n).fill(1);

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

    const { drawnHits, first, count } = projectHits(hits, representative, drawn, allAlive(2));

    expect(drawnHits[0]).toBe(1);
    expect(drawnHits[1]).toBe(0);
    expect(first).toBe(0);
    expect(count).toBe(1);
  });

  it('попадание в скрытом поддереве исчезает и не считается', () => {
    const hits = Uint8Array.from([1]);
    const representative = Int32Array.from([HIDDEN]);
    const drawn = Uint8Array.from([0]);

    const { drawnHits, first, count } = projectHits(hits, representative, drawn, allAlive(1));

    expect([...drawnHits].every((value) => value === 0)).toBe(true);
    expect(first).toBe(-1);
    expect(count).toBe(0);
  });

  it('first — наименьший идентификатор среди обведённых, -1 при отсутствии попаданий', () => {
    const hits = Uint8Array.from([0, 1, 0, 1]);
    const representative = Int32Array.from([0, 3, 2, 3]);
    const drawn = Uint8Array.from([1, 0, 1, 1]);

    const { first } = projectHits(hits, representative, drawn, allAlive(4));
    expect(first).toBe(3);

    const none = projectHits(new Uint8Array(4), representative, drawn, allAlive(4));
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

    const { drawnHits, count, first } = projectHits(hits, representative, drawn, allAlive(3));

    expect(count).toBe(1);
    expect(drawnHits[2]).toBe(1);
    expect(first).toBe(2);
  });

  it('попадание в неживой (не рисуемый) представитель не считается', () => {
    const hits = Uint8Array.from([1]);
    const representative = Int32Array.from([0]);
    const drawn = Uint8Array.from([0]);

    const { count, first } = projectHits(hits, representative, drawn, allAlive(1));
    expect(count).toBe(0);
    expect(first).toBe(-1);
  });

  it('first — наименьший идентификатор представителя, а не первый встреченный по ходу обхода', () => {
    // Различающий случай: representative[p] <= p всегда, но путь с бо́льшим
    // идентификатором может вести в представителя с меньшим — файл, впервые
    // появившийся в позднем коммите, внутри рано созданной свёрнутой папки.
    // Обход путей идёт по возрастанию id, поэтому «первый встреченный»
    // представитель здесь — 4 (первое попадание, path=4), а «наименьший
    // идентификатор» среди обведённых — 2 (наступает позже, при path=5).
    // Мутант `if (first === -1) first = target;` (без сравнения `target <
    // first`) вернул бы 4 и не заметил разницы.
    const hits = Uint8Array.from([0, 0, 0, 0, 1, 1]);
    const representative = Int32Array.from([0, 1, 2, 3, 4, 2]);
    const drawn = allAlive(6);

    const { first } = projectHits(hits, representative, drawn, allAlive(6));

    expect(first).toBe(2);
  });

  describe('живость исходного пути под свёрнутой папкой', () => {
    // Воспроизводит находку ревью: пакет из двух коммитов, курсор на первом
    // (src/b.ts ещё не родился), src свёрнута, образец 'b.ts'. Без проверки
    // живости исходного пути представитель ('src') жив сам по себе (в нём
    // жив a.ts), и попадание засчиталось бы — счётчик соврал бы про узел,
    // которого на сцене в этот момент истории нет.
    const add = (path: string) => ({
      path,
      kind: 'add' as const,
      added: 1,
      deleted: 0,
      binary: false,
    });
    const commit = (hash: string, changes: RawCommit['changes']): RawCommit => ({
      hash,
      authorName: 'A',
      authorEmail: 'a@e.com',
      timestamp: 1,
      subject: hash,
      changes,
    });

    const twoCommitPack = buildPack(
      [commit('c0', [add('src/a.ts')]), commit('c1', [add('src/b.ts')])],
      { repoName: 'demo2', head: 'c1' },
    );
    const twoId = (path: string) => twoCommitPack.paths.indexOf(path);

    function projectAt(cursor: number, collapseSrc: boolean) {
      const engine = new TimeEngine(twoCommitPack);
      engine.seek(cursor);
      const visibility = resolveVisibility(twoCommitPack, engine.alive, engine.sizes, {
        hidden: new Set(),
        collapsed: collapseSrc ? new Set([twoId('src')]) : new Set(),
      });
      const hits = computeHits(twoCommitPack, 'b.ts');
      return projectHits(hits, visibility.representative, visibility.drawn, engine.alive);
    }

    it('на первом коммите (b.ts ещё не родился) со свёрнутой src не даёт попаданий', () => {
      const { count, first } = projectAt(0, true);
      expect(count).toBe(0);
      expect(first).toBe(-1);
    });

    it('на первом коммите без сворачивания тоже не даёт попаданий', () => {
      const { count, first } = projectAt(0, false);
      expect(count).toBe(0);
      expect(first).toBe(-1);
    });

    it('на втором коммите (b.ts родился) со свёрнутой src находит папку-представителя', () => {
      const { count, first } = projectAt(1, true);
      expect(count).toBe(1);
      expect(first).toBe(twoId('src'));
    });

    it('на втором коммите без сворачивания находит сам файл', () => {
      const { count, first } = projectAt(1, false);
      expect(count).toBe(1);
      expect(first).toBe(twoId('src/b.ts'));
    });
  });
});
