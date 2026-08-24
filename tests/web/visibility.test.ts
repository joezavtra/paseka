import { describe, it, expect } from 'vitest';
import {
  decodeVisibility,
  defaultVisibility,
  encodeVisibility,
  HIDDEN,
  resolveVisibility,
} from '../../web/state/visibility.js';
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

const add = (path: string, added: number) => ({
  path,
  kind: 'add' as const,
  added,
  deleted: 0,
  binary: false,
});

const pack = buildPack(
  [commit('c0', [add('src/deep/a.ts', 10), add('src/b.ts', 20), add('docs/c.md', 5)])],
  { repoName: 'demo', head: 'c0' },
);

const id = (path: string) => pack.paths.indexOf(path);
const alive = new Uint8Array(pack.meta.pathCount).fill(1);

function sizesOf(): Int32Array {
  const sizes = new Int32Array(pack.meta.pathCount);
  sizes[id('src/deep/a.ts')] = 10;
  sizes[id('src/b.ts')] = 20;
  sizes[id('docs/c.md')] = 5;
  return sizes;
}

const NOTHING = { hidden: new Set<number>(), collapsed: new Set<number>() };

describe('resolveVisibility', () => {
  it('без спецификации каждый путь представляет сам себя', () => {
    const result = resolveVisibility(pack, alive, sizesOf(), NOTHING);
    for (let path = 0; path < pack.meta.pathCount; path++) {
      expect(result.representative[path], pack.paths[path]).toBe(path);
      expect(result.drawn[path], pack.paths[path]).toBe(1);
    }
  });

  it('скрытая папка уносит с собой всё поддерево', () => {
    const result = resolveVisibility(pack, alive, sizesOf(), {
      hidden: new Set([id('src')]),
      collapsed: new Set(),
    });
    for (const path of ['src', 'src/deep', 'src/deep/a.ts', 'src/b.ts']) {
      expect(result.representative[id(path)], path).toBe(HIDDEN);
      expect(result.drawn[id(path)], path).toBe(0);
    }
    expect(result.drawn[id('docs/c.md')]).toBe(1);
  });

  it('свёрнутая папка остаётся на экране и представляет потомков', () => {
    const result = resolveVisibility(pack, alive, sizesOf(), {
      hidden: new Set(),
      collapsed: new Set([id('src')]),
    });
    expect(result.drawn[id('src')]).toBe(1);
    expect(result.representative[id('src')]).toBe(id('src'));
    for (const path of ['src/deep', 'src/deep/a.ts', 'src/b.ts']) {
      expect(result.representative[id(path)], path).toBe(id('src'));
      expect(result.drawn[id(path)], path).toBe(0);
    }
  });

  it('свёрнутая папка вбирает размеры живых потомков', () => {
    const result = resolveVisibility(pack, alive, sizesOf(), {
      hidden: new Set(),
      collapsed: new Set([id('src')]),
    });
    expect(result.weight[id('src')]).toBe(30);
    expect(result.weight[id('docs/c.md')]).toBe(5);
  });

  it('свёрнутая папка получает число живых файлов поддерева, без подпапок', () => {
    const result = resolveVisibility(pack, alive, sizesOf(), {
      hidden: new Set(),
      collapsed: new Set([id('src')]),
    });
    // src/deep/a.ts и src/b.ts — два файла; src/deep — подпапка и в счёт не идёт.
    expect(result.files[id('src')]).toBe(2);
    expect(result.files[id('docs/c.md')]).toBe(1);
  });

  it('у обычного файла своё число файлов равно единице', () => {
    const result = resolveVisibility(pack, alive, sizesOf(), NOTHING);
    expect(result.files[id('src/deep/a.ts')]).toBe(1);
    expect(result.files[id('src/b.ts')]).toBe(1);
    expect(result.files[id('docs/c.md')]).toBe(1);
  });

  it('мёртвые файлы не входят в счётчик представителя', () => {
    const partly = new Uint8Array(alive);
    partly[id('src/b.ts')] = 0;
    const result = resolveVisibility(pack, partly, sizesOf(), {
      hidden: new Set(),
      collapsed: new Set([id('src')]),
    });
    expect(result.files[id('src')]).toBe(1);
  });

  it('скрытое поддерево не даёт файлов никому', () => {
    const result = resolveVisibility(pack, alive, sizesOf(), {
      hidden: new Set([id('src')]),
      collapsed: new Set(),
    });
    expect(result.files[id('src')]).toBe(0);
    expect(result.files[id('docs/c.md')]).toBe(1);
  });

  it('вложенное сворачивание представляет верхним свёрнутым', () => {
    const result = resolveVisibility(pack, alive, sizesOf(), {
      hidden: new Set(),
      collapsed: new Set([id('src'), id('src/deep')]),
    });
    expect(result.representative[id('src/deep/a.ts')]).toBe(id('src'));
    expect(result.representative[id('src/deep')]).toBe(id('src'));
    expect(result.drawn[id('src/deep')]).toBe(0);
  });

  it('скрытие сильнее сворачивания', () => {
    const result = resolveVisibility(pack, alive, sizesOf(), {
      hidden: new Set([id('src/deep')]),
      collapsed: new Set([id('src')]),
    });
    expect(result.representative[id('src/deep/a.ts')]).toBe(HIDDEN);
    expect(result.weight[id('src')]).toBe(20);
  });

  it('мёртвые пути не рисуются и не попадают в размер представителя', () => {
    const partly = new Uint8Array(alive);
    partly[id('src/b.ts')] = 0;
    const result = resolveVisibility(pack, partly, sizesOf(), {
      hidden: new Set(),
      collapsed: new Set([id('src')]),
    });
    expect(result.drawn[id('src/b.ts')]).toBe(0);
    expect(result.weight[id('src')]).toBe(10);
  });

  it('скрытый корень убирает всё', () => {
    const result = resolveVisibility(pack, alive, sizesOf(), {
      hidden: new Set([0]),
      collapsed: new Set(),
    });
    expect([...result.drawn].every((value) => value === 0)).toBe(true);
  });

  it('не падает на пустом пакете', () => {
    const empty = buildPack([], { repoName: 'x', head: '0' });
    const result = resolveVisibility(empty, new Uint8Array(1), new Int32Array(1), NOTHING);
    expect(result.representative).toHaveLength(1);
  });
});

/**
 * Идентификаторы путей раздаются в порядке первого появления при обходе
 * истории, а порядок задаёт чтение журнала по дате коммита. Влившаяся ветка
 * встаёт в середину истории и сдвигает все последующие идентификаторы — тот же
 * сохранённый номер назавтра означает уже другую папку. Поэтому хранятся
 * строки путей, а разрешаются они в идентификаторы при загрузке.
 */
describe('кодек хранилища видимости', () => {
  /** Тот же репозиторий, но с влившейся веткой впереди: идентификаторы съехали. */
  const shifted = buildPack(
    [
      commit('branch', [add('lib/x.ts', 1), add('lib/deep/y.ts', 1)]),
      commit('c0', [add('src/deep/a.ts', 10), add('src/b.ts', 20), add('docs/c.md', 5)]),
    ],
    { repoName: 'demo', head: 'c0' },
  );
  const shiftedId = (path: string) => shifted.paths.indexOf(path);

  it('переживает пересчёт идентификаторов: разрешает по строкам путей', () => {
    const raw = encodeVisibility(pack, {
      hidden: new Set([id('src')]),
      collapsed: new Set([id('docs')]),
    });

    // Проверка предпосылки: в новом пакете у тех же папок другие номера,
    // иначе тест ничего бы не доказывал.
    expect(shiftedId('src')).not.toBe(id('src'));

    const restored = decodeVisibility(shifted, raw);
    expect([...restored.hidden]).toEqual([shiftedId('src')]);
    expect([...restored.collapsed]).toEqual([shiftedId('docs')]);
  });

  it('отбрасывает пути, которых в пакете нет', () => {
    const raw = JSON.stringify({ hidden: ['src', 'ушедшая/папка'], collapsed: ['нет/такой'] });
    const restored = decodeVisibility(pack, raw);
    expect([...restored.hidden]).toEqual([id('src')]);
    expect([...restored.collapsed]).toEqual([]);
  });

  it('на пустом хранилище даёт умолчание, а не пустоту', () => {
    // В этом пакете папки vendor нет, поэтому умолчание пустое — но приходит
    // оно именно из defaultVisibility, что проверяется на пакете с vendor ниже.
    expect(decodeVisibility(pack, null)).toEqual(defaultVisibility(pack));
    expect(decodeVisibility(pack, '')).toEqual(defaultVisibility(pack));
  });

  it('переживает испорченное содержимое, не роняя страницу', () => {
    for (const raw of ['{', 'не json вовсе', 'null', '42', '"строка"', '[1,2,3]']) {
      const restored = decodeVisibility(pack, raw);
      expect(restored, raw).toEqual(defaultVisibility(pack));
    }
  });

  it('переживает поля не того типа', () => {
    const restored = decodeVisibility(
      pack,
      JSON.stringify({ hidden: 'src', collapsed: [1, null, { path: 'docs' }, 'docs'] }),
    );
    expect([...restored.hidden]).toEqual([]);
    // Из мусорного массива уцелела единственная годная строка.
    expect([...restored.collapsed]).toEqual([id('docs')]);
  });

  it('записывает строки путей, а не идентификаторы', () => {
    const raw = encodeVisibility(pack, {
      hidden: new Set([id('src')]),
      collapsed: new Set([id('docs')]),
    });
    expect(JSON.parse(raw)).toEqual({ hidden: ['src'], collapsed: ['docs'] });
  });

  it('не записывает идентификаторы, которых в пакете нет', () => {
    const raw = encodeVisibility(pack, {
      hidden: new Set([id('src'), 99999, -1]),
      collapsed: new Set(),
    });
    expect(JSON.parse(raw)).toEqual({ hidden: ['src'], collapsed: [] });
  });

  it('пережимает круг: записанное читается обратно тем же', () => {
    const spec = { hidden: new Set([id('src'), id('docs')]), collapsed: new Set([id('src/deep')]) };
    const restored = decodeVisibility(pack, encodeVisibility(pack, spec));
    expect([...restored.hidden].sort()).toEqual([...spec.hidden].sort());
    expect([...restored.collapsed]).toEqual([...spec.collapsed]);
  });
});

describe('видимость при первом открытии', () => {
  const vendored = buildPack(
    [
      commit('c0', [
        add('src/a.ts', 10),
        add('vendor/lib/x.go', 100),
        add('internal/vendor/y.go', 50),
        add('docs/vendor', 3),
      ]),
    ],
    { repoName: 'demo', head: 'c0' },
  );
  const at = (path: string) => vendored.paths.indexOf(path);

  it('скрывает папку vendor на любой глубине', () => {
    const spec = defaultVisibility(vendored);
    expect(spec.hidden.has(at('vendor'))).toBe(true);
    expect(spec.hidden.has(at('internal/vendor'))).toBe(true);
  });

  it('файл с таким именем не прячется: скрывать надо каталог, а не совпадение строк', () => {
    expect(vendored.pathIsDir[at('docs/vendor')]).toBe(0);
    expect(defaultVisibility(vendored).hidden.has(at('docs/vendor'))).toBe(false);
  });

  it('остальное остаётся видимым, включая прочий типовой шум', () => {
    // node_modules, dist и прочее по-прежнему скрываются только по кнопке:
    // инструмент не должен молча прятать данные.
    const spec = defaultVisibility(vendored);
    expect(spec.hidden.has(at('src'))).toBe(false);
    expect(spec.hidden.has(at('internal'))).toBe(false);
    expect(spec.collapsed.size).toBe(0);
  });

  it('корень не прячется никогда', () => {
    expect(defaultVisibility(vendored).hidden.has(0)).toBe(false);
  });

  it('на первом открытии vendor скрыт', () => {
    expect(decodeVisibility(vendored, null).hidden.has(at('vendor'))).toBe(true);
  });

  it('снятое пользователем скрытие сильнее умолчания', () => {
    // Пустые списки в хранилище — это не «выбора нет», а «выбрано ничего не
    // скрывать». Иначе vendor воскресал бы после каждой перезагрузки.
    const restored = decodeVisibility(vendored, '{"hidden":[],"collapsed":[]}');
    expect(restored.hidden.size).toBe(0);
  });

  it('сохранённый выбор со своими папками не подмешивает умолчание', () => {
    const restored = decodeVisibility(vendored, '{"hidden":["src"],"collapsed":[]}');
    expect([...restored.hidden]).toEqual([at('src')]);
  });
});
