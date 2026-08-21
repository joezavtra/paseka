# Фильтрация и видимость поддеревьев — план реализации


**Goal:** Фильтр по автору, пути и расширению гасит непопавшее, не разрушая дерево; любую папку можно скрыть или свернуть в один узел.

**Architecture:** Две ортогональные операции с разными правилами. Фильтр только меняет яркость и не трогает ни топологию, ни симуляцию. Видимость, наоборот, убирает узлы из симуляции и схлопывает поддерево в представителя — через него же адресуются лучи авторов. Обе выводятся чистыми функциями из спецификации и живого множества.

**Tech Stack:** TypeScript (strict, ESM), Node 20+, Vite, vitest, happy-dom, Playwright.

**Spec:** [docs/design.md](../design.md) — §9 и §10, первая половина среза 5.

**Scope:** инспектор узла, поиск, подписи и наведение — второй план среза 5. Экспорт и перф-бюджеты — срез 6.

## Global Constraints

- Node `>=20`. ESM, `"type": "module"`. **Все относительные импорты — с расширением `.js`.**
- TypeScript `strict: true`, `noUncheckedIndexedAccess` **выключен**.
- В `src/` — только `node:`-модули. Код в `web/` не зависит от `node:`. `Math.random()` запрещён.
- Тексты для пользователя и комментарии — на русском; идентификаторы, имена файлов, сообщения коммитов — английские.
- Vitest без `globals`; среда с DOM включается пофайлово докблоком `// @vitest-environment happy-dom`.
- Массивы по узлам индексируются идентификатором пути; идентификатор родителя всегда меньше идентификатора потомка.
- Любое значение, приходящее снаружи, может оказаться негодным. Проверяй до использования.
- Каждая задача заканчивается коммитом.

## Ключевое различие, которое нельзя перепутать

**Фильтр гасит.** Не попавшее под фильтр остаётся на месте, меняется только яркость: пользователь должен видеть, где в дереве живёт найденное. Топология, симуляция и раскладка не трогаются вовсе.

**Видимость убирает.** Скрытая папка уходит из симуляции целиком, и граф занимает освободившееся место. Свёрнутая — схлопывается в один узел-представитель, и в него же бьют лучи авторов, работавших внутри.

## File Structure

| Файл | Ответственность |
|---|---|
| `web/state/visibility.ts` | Спецификация видимости → представители, рисуемая маска, размеры с учётом схлопывания |
| `web/state/filter.ts` | Спецификация фильтра → целевые альфы по путям |
| `web/state/glob.ts` | Сопоставление пути с образцом |
| `web/render/scene.ts` | Дополняется гашением по альфе |
| `web/render/activity.ts` | Луч бьёт в представителя |
| `web/layout/node-store.ts` | Структурная гарантия: у каждого активного узла есть узел |
| `web/ui/sidebar.ts` | Левая панель: фильтры и навигатор дерева |
| `web/main.ts` | Сборка: рисуемая маска в воркер, переход альфы, сохранение выбора |

---

### Task 1: Сопоставление пути с образцом

**Files:**
- Create: `web/state/glob.ts`
- Test: `tests/web/glob.test.ts`

**Interfaces:**
- Produces: `matchesGlob(path: string, pattern: string): boolean`

- [ ] **Step 1: Написать падающий тест**

`tests/web/glob.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { matchesGlob } from '../../web/state/glob.js';

describe('matchesGlob', () => {
  it('пустой образец подходит всему', () => {
    expect(matchesGlob('src/a.ts', '')).toBe(true);
    expect(matchesGlob('', '   ')).toBe(true);
  });

  it('без подстановок ищет подстроку без учёта регистра', () => {
    expect(matchesGlob('src/Utils.ts', 'utils')).toBe(true);
    expect(matchesGlob('src/utils.ts', 'SRC/')).toBe(true);
    expect(matchesGlob('src/utils.ts', 'docs')).toBe(false);
  });

  it('звёздочка заменяет любую последовательность, включая слэши', () => {
    expect(matchesGlob('src/deep/a.ts', 'src/*.ts')).toBe(true);
    expect(matchesGlob('src/deep/a.ts', '*.md')).toBe(false);
  });

  it('вопрос заменяет ровно один символ', () => {
    expect(matchesGlob('a.ts', '?.ts')).toBe(true);
    expect(matchesGlob('ab.ts', '?.ts')).toBe(false);
  });

  it('образец с подстановкой якорится целиком', () => {
    expect(matchesGlob('src/a.ts', 'src/*')).toBe(true);
    expect(matchesGlob('lib/src/a.ts', 'src/*')).toBe(false);
  });

  it('не путается в служебных символах регулярных выражений', () => {
    expect(matchesGlob('a+b(c).ts', 'a+b(c).ts')).toBe(true);
    expect(matchesGlob('axb.ts', 'a.b.ts')).toBe(false);
  });

  it('переживает мусорный образец', () => {
    expect(matchesGlob('a.ts', '[')).toBe(false);
    expect(matchesGlob('[', '[')).toBe(true);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run tests/web/glob.test.ts`
Expected: FAIL — не найден модуль `web/state/glob.js`.

- [ ] **Step 3: Реализовать**

`web/state/glob.ts`:

```ts
/** Символы, которые в регулярном выражении значат не то, что в образце пути. */
const SPECIAL = /[.*+?^${}()|[\]\\]/g;

const cache = new Map<string, RegExp>();

function toRegExp(pattern: string): RegExp {
  const known = cache.get(pattern);
  if (known) return known;
  // Экранируем всё, затем возвращаем смысл только подстановкам.
  const source = pattern
    .replace(SPECIAL, '\\$&')
    .replace(/\\\*/g, '.*')
    .replace(/\\\?/g, '.');
  const compiled = new RegExp(`^${source}$`, 'iu');
  cache.set(pattern, compiled);
  return compiled;
}

/**
 * Образец без подстановок — это поиск подстроки: пользователь чаще всего хочет
 * «покажи всё про utils», а не пишет якоря. Как только появляется `*` или `?`,
 * образец начинает значить путь целиком, иначе `src/*` совпало бы с `lib/src/a`.
 */
export function matchesGlob(path: string, pattern: string): boolean {
  const trimmed = pattern.trim();
  if (trimmed.length === 0) return true;
  if (!trimmed.includes('*') && !trimmed.includes('?')) {
    return path.toLowerCase().includes(trimmed.toLowerCase());
  }
  return toRegExp(trimmed).test(path);
}
```

- [ ] **Step 4: Запустить тесты**

Run: `npx vitest run tests/web/glob.test.ts && npm run typecheck`
Expected: PASS, 7 тестов.

- [ ] **Step 5: Коммит**

```bash
git add -A
git commit -m "feat(state): glob matching for path filter"
```

---

### Task 2: Видимость поддеревьев

**Files:**
- Create: `web/state/visibility.ts`
- Test: `tests/web/visibility.test.ts`

**Interfaces:**
- Consumes: `Pack`
- Produces: `VisibilitySpec { hidden: ReadonlySet<number>; collapsed: ReadonlySet<number> }`; `VisibilityResult { representative: Int32Array; drawn: Uint8Array; sizes: Int32Array }`; `HIDDEN = -1`; `resolveVisibility(pack: Pack, alive: Uint8Array, sizes: Int32Array, spec: VisibilitySpec): VisibilityResult`

- [ ] **Step 1: Написать падающий тест**

`tests/web/visibility.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { HIDDEN, resolveVisibility } from '../../web/state/visibility.js';
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
    expect(result.sizes[id('src')]).toBe(30);
    expect(result.sizes[id('docs/c.md')]).toBe(5);
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
    expect(result.sizes[id('src')]).toBe(20);
  });

  it('мёртвые пути не рисуются и не попадают в размер представителя', () => {
    const partly = new Uint8Array(alive);
    partly[id('src/b.ts')] = 0;
    const result = resolveVisibility(pack, partly, sizesOf(), {
      hidden: new Set(),
      collapsed: new Set([id('src')]),
    });
    expect(result.drawn[id('src/b.ts')]).toBe(0);
    expect(result.sizes[id('src')]).toBe(10);
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
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run tests/web/visibility.test.ts`
Expected: FAIL — не найден модуль `web/state/visibility.js`.

- [ ] **Step 3: Реализовать**

`web/state/visibility.ts`:

```ts
import type { Pack } from '../../src/model/types.js';

/** Путь не показывается вовсе: он сам или его предок скрыт. */
export const HIDDEN = -1;

export interface VisibilitySpec {
  /** Папки, убранные со сцены вместе с поддеревом. */
  hidden: ReadonlySet<number>;
  /** Папки, схлопнутые в один узел. */
  collapsed: ReadonlySet<number>;
}

export interface VisibilityResult {
  /** Кто представляет путь на экране: он сам, свёрнутый предок, либо HIDDEN. */
  representative: Int32Array;
  /** Рисуемые узлы: путь жив и представляет сам себя. */
  drawn: Uint8Array;
  /** Размер узла в строках; у свёрнутой папки — сумма живых потомков. */
  sizes: Int32Array;
}

/**
 * Скрытие и сворачивание — разные операции. Скрытая папка исчезает вместе с
 * поддеревом, и граф занимает освободившееся место. Свёрнутая остаётся на
 * экране и становится представителем всего, что внутри: в неё же бьют лучи
 * авторов, работавших внутри, иначе луч уходил бы в невидимый узел.
 *
 * Один проход по возрастанию идентификатора: родитель всегда меньше потомка,
 * поэтому к моменту обработки пути его предок уже разрешён.
 */
export function resolveVisibility(
  pack: Pack,
  alive: Uint8Array,
  sizes: Int32Array,
  spec: VisibilitySpec,
): VisibilityResult {
  const { pathCount } = pack.meta;
  const representative = new Int32Array(pathCount);
  const drawn = new Uint8Array(pathCount);
  const result = new Int32Array(pathCount);

  if (pathCount > 0) {
    representative[0] = spec.hidden.has(0) ? HIDDEN : 0;
  }
  for (let path = 1; path < pathCount; path++) {
    const parent = pack.pathParent[path];
    const parentRep = representative[parent];
    if (parentRep === HIDDEN) {
      representative[path] = HIDDEN;
    } else if (parentRep !== parent) {
      // Родитель сам представлен свёрнутым предком — потомок наследует его.
      representative[path] = parentRep;
    } else if (spec.collapsed.has(parent)) {
      representative[path] = parent;
    } else {
      representative[path] = spec.hidden.has(path) ? HIDDEN : path;
    }
  }

  for (let path = 0; path < pathCount; path++) {
    if (alive[path] === 1 && representative[path] === path) drawn[path] = 1;
  }

  // Размер свёрнутой папки — сумма живых потомков: узел должен выглядеть на
  // столько, сколько кода в нём спрятано.
  for (let path = 0; path < pathCount; path++) {
    if (alive[path] !== 1) continue;
    const rep = representative[path];
    if (rep === HIDDEN) continue;
    result[rep] += sizes[path];
  }

  return { representative, drawn, sizes: result };
}
```

- [ ] **Step 4: Запустить тесты**

Run: `npx vitest run tests/web/visibility.test.ts && npm run typecheck`
Expected: PASS, 9 тестов.

- [ ] **Step 5: Коммит**

```bash
git add -A
git commit -m "feat(state): subtree visibility with representatives"
```

---

### Task 3: Целевые альфы фильтра

**Files:**
- Create: `web/state/filter.ts`
- Test: `tests/web/filter.test.ts`

**Interfaces:**
- Consumes: `Pack`, `matchesGlob`
- Produces: `FilterSpec { authors: ReadonlySet<number> | null; pathQuery: string; extensions: ReadonlySet<string> | null }`; `DIM_ALPHA = 0.12`; `EMPTY_FILTER: FilterSpec`; `isEmptyFilter(spec: FilterSpec): boolean`; `extensionOf(path: string): string`; `computeAlpha(pack: Pack, spec: FilterSpec): Float32Array`

- [ ] **Step 1: Написать падающий тест**

`tests/web/filter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeAlpha, DIM_ALPHA, extensionOf, isEmptyFilter } from '../../web/state/filter.js';
import { buildPack } from '../../src/model/build.js';
import type { RawCommit } from '../../src/git/types.js';

const change = (path: string) => ({
  path,
  kind: 'add' as const,
  added: 1,
  deleted: 0,
  binary: false,
});

const pack = buildPack(
  [
    {
      hash: 'c0',
      authorName: 'Аня',
      authorEmail: 'anya@e.com',
      timestamp: 1,
      subject: 'c0',
      changes: [change('src/a.ts'), change('docs/b.md')],
    },
    {
      hash: 'c1',
      authorName: 'Бо',
      authorEmail: 'bo@e.com',
      timestamp: 2,
      subject: 'c1',
      changes: [change('src/deep/c.ts')],
    },
  ],
  { repoName: 'demo', head: 'c1' },
);

const id = (path: string) => pack.paths.indexOf(path);
const EMPTY = { authors: null, pathQuery: '', extensions: null };

describe('extensionOf', () => {
  it('берёт расширение в нижнем регистре', () => {
    expect(extensionOf('src/A.TS')).toBe('ts');
  });

  it('файл без расширения и точечный файл дают пустую строку', () => {
    expect(extensionOf('Makefile')).toBe('');
    expect(extensionOf('.gitignore')).toBe('');
  });
});

describe('isEmptyFilter', () => {
  it('пустой фильтр распознаётся', () => {
    expect(isEmptyFilter(EMPTY)).toBe(true);
    expect(isEmptyFilter({ ...EMPTY, pathQuery: '  ' })).toBe(true);
  });

  it('любое ограничение делает фильтр непустым', () => {
    expect(isEmptyFilter({ ...EMPTY, authors: new Set([0]) })).toBe(false);
    expect(isEmptyFilter({ ...EMPTY, extensions: new Set(['ts']) })).toBe(false);
    expect(isEmptyFilter({ ...EMPTY, pathQuery: 'src' })).toBe(false);
  });
});

describe('computeAlpha', () => {
  it('без фильтра всё в полную яркость', () => {
    const alpha = computeAlpha(pack, EMPTY);
    expect([...alpha].every((value) => value === 1)).toBe(true);
  });

  it('фильтр по расширению гасит непопавшее, но не убирает', () => {
    const alpha = computeAlpha(pack, { ...EMPTY, extensions: new Set(['ts']) });
    expect(alpha[id('src/a.ts')]).toBe(1);
    expect(alpha[id('docs/b.md')]).toBeCloseTo(DIM_ALPHA, 5);
    expect(alpha[id('docs/b.md')]).toBeGreaterThan(0);
  });

  it('каталог берёт максимум по потомкам, чтобы путь к находке был виден', () => {
    const alpha = computeAlpha(pack, { ...EMPTY, pathQuery: 'deep/c' });
    expect(alpha[id('src/deep/c.ts')]).toBe(1);
    expect(alpha[id('src/deep')]).toBe(1);
    expect(alpha[id('src')]).toBe(1);
    expect(alpha[0]).toBe(1);
    expect(alpha[id('docs')]).toBeCloseTo(DIM_ALPHA, 5);
  });

  it('фильтр по автору оставляет только его файлы', () => {
    const anya = pack.authors.findIndex((author) => author.email === 'anya@e.com');
    const alpha = computeAlpha(pack, { ...EMPTY, authors: new Set([anya]) });
    expect(alpha[id('src/a.ts')]).toBe(1);
    expect(alpha[id('docs/b.md')]).toBe(1);
    expect(alpha[id('src/deep/c.ts')]).toBeCloseTo(DIM_ALPHA, 5);
  });

  it('ограничения складываются по «и»', () => {
    const anya = pack.authors.findIndex((author) => author.email === 'anya@e.com');
    const alpha = computeAlpha(pack, {
      authors: new Set([anya]),
      pathQuery: '',
      extensions: new Set(['ts']),
    });
    expect(alpha[id('src/a.ts')]).toBe(1);
    expect(alpha[id('docs/b.md')]).toBeCloseTo(DIM_ALPHA, 5);
  });

  it('фильтр, под который ничего не попало, гасит всё, но ничего не прячет', () => {
    const alpha = computeAlpha(pack, { ...EMPTY, pathQuery: 'ничего-такого-нет' });
    expect([...alpha].every((value) => value > 0)).toBe(true);
    expect(alpha[id('src/a.ts')]).toBeCloseTo(DIM_ALPHA, 5);
  });

  it('пустой набор авторов гасит всё: это не то же самое, что отсутствие фильтра', () => {
    const alpha = computeAlpha(pack, { ...EMPTY, authors: new Set<number>() });
    expect(alpha[id('src/a.ts')]).toBeCloseTo(DIM_ALPHA, 5);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run tests/web/filter.test.ts`
Expected: FAIL — не найден модуль `web/state/filter.js`.

- [ ] **Step 3: Реализовать**

`web/state/filter.ts`:

```ts
import type { Pack } from '../../src/model/types.js';
import { matchesGlob } from './glob.js';

/** Яркость того, что не попало под фильтр. Не ноль: дерево должно остаться целым. */
export const DIM_ALPHA = 0.12;

export interface FilterSpec {
  /** null — фильтра по авторам нет. Пустое множество — не подходит никто. */
  authors: ReadonlySet<number> | null;
  pathQuery: string;
  extensions: ReadonlySet<string> | null;
}

export const EMPTY_FILTER: FilterSpec = { authors: null, pathQuery: '', extensions: null };

export function isEmptyFilter(spec: FilterSpec): boolean {
  return spec.authors === null && spec.extensions === null && spec.pathQuery.trim().length === 0;
}

/** Расширение файла в нижнем регистре; у файла без расширения — пустая строка. */
export function extensionOf(path: string): string {
  const slash = path.lastIndexOf('/');
  const name = slash === -1 ? path : path.slice(slash + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/**
 * Целевая яркость каждого пути. Фильтр именно гасит, а не скрывает: увидев,
 * что нашлось, пользователь должен понимать, где это лежит в дереве. Поэтому
 * каталог берёт максимум по потомкам — иначе найденный файл висел бы на
 * погасшей ветке и выглядел бы оторванным от дерева.
 */
export function computeAlpha(pack: Pack, spec: FilterSpec): Float32Array {
  const { pathCount } = pack.meta;
  const alpha = new Float32Array(pathCount).fill(DIM_ALPHA);
  if (isEmptyFilter(spec)) return alpha.fill(1);

  const query = spec.pathQuery.trim();

  for (let path = 0; path < pathCount; path++) {
    if (pack.pathIsDir[path] === 1) continue; // каталоги получают яркость от потомков
    if (query.length > 0 && !matchesGlob(pack.paths[path]!, query)) continue;
    if (spec.extensions !== null && !spec.extensions.has(extensionOf(pack.paths[path]!))) continue;
    if (spec.authors !== null && !touchedByAny(pack, path, spec.authors)) continue;
    alpha[path] = 1;
  }

  // Идентификатор родителя всегда меньше идентификатора потомка, поэтому обход
  // по убыванию поднимает максимум от листьев к корню за один проход.
  for (let path = pathCount - 1; path >= 1; path--) {
    const parent = pack.pathParent[path];
    if (alpha[path] > alpha[parent]) alpha[parent] = alpha[path];
  }
  return alpha;
}

function touchedByAny(pack: Pack, path: number, authors: ReadonlySet<number>): boolean {
  for (let k = pack.pathEventStart[path]; k < pack.pathEventStart[path + 1]; k++) {
    const event = pack.pathEventIdx[k];
    if (authors.has(pack.commitAuthor[pack.eventCommit[event]])) return true;
  }
  return false;
}
```

- [ ] **Step 4: Запустить тесты**

Run: `npx vitest run tests/web/filter.test.ts && npm run typecheck`
Expected: PASS, 12 тестов.

- [ ] **Step 5: Коммит**

```bash
git add -A
git commit -m "feat(state): filter alphas that dim instead of hiding"
```

---

### Task 4: Гашение и представители в конвейере отрисовки

Задача неделима: рисуемая маска, альфы, представитель для лучей и список
рождающихся узлов связаны одной величиной, и по отдельности проект не собрался бы.

**Files:**
- Modify: `web/render/scene.ts`, `web/render/activity.ts`, `web/layout/node-store.ts`, `web/main.ts`
- Test: `tests/web/scene.test.ts` (дополняется), `tests/web/activity.test.ts` (дополняется), `tests/web/node-store.test.ts` (дополняется)

**Interfaces:**
- Consumes: `resolveVisibility`, `computeAlpha`, `HIDDEN`
- Produces: `SceneInput` дополняется полем `alpha: Float32Array`; `ActivityScene` дополняется полем `representative: Int32Array`; `NodeStore.applyUpdate` гарантирует узел каждому активному пути

- [ ] **Step 1: Написать падающий тест гашения**

Дописать в `tests/web/scene.test.ts` внутри существующего describe отрисовки:

```ts
  it('гасит узел по альфе, не убирая его со сцены', () => {
    const scene = makeScene(2);
    scene.active[0] = 1;
    scene.active[1] = 1;
    scene.alpha[0] = 1;
    scene.alpha[1] = 0.12;
    const ctx = makeCtx();
    drawScene(ctx as unknown as CanvasRenderingContext2D, new Camera(), scene, 100, 100);

    const alphas = ctx.calls
      .filter((call) => call.startsWith('globalAlpha='))
      .map((call) => Number(call.slice('globalAlpha='.length)));
    expect(alphas).toContain(0.12);
    expect(ctx.calls.filter((call) => call === 'fill()').length).toBe(2);
  });
```

Здесь `makeScene(n)` и `makeCtx()` — уже существующие в файле помощники; добавь
в `makeScene` поле `alpha: new Float32Array(n).fill(1)`, а в перечень
записываемых свойств заглушки контекста — `globalAlpha`, если его там нет.

- [ ] **Step 2: Написать падающий тест луча через представителя**

Дописать в `tests/web/activity.test.ts`:

```ts
  it('луч свёрнутой папки бьёт в неё, а не в спрятанный внутри файл', () => {
    const recent = new RecentEvents(8, 1000, 2);
    recent.push(3, 0, 0); // файл внутри свёрнутой папки
    const scene = {
      active: Uint8Array.from([1, 1, 0, 0]),
      positions: Float32Array.from([0, 0, 10, 10, 20, 20, 30, 30]),
      // Путь 3 представлен путём 1: папка свёрнута.
      representative: Int32Array.from([0, 1, 1, 1]),
    };

    const frame = deriveActivity(recent, scene, 0, 8);
    expect(frame.beams).toHaveLength(1);
    expect(frame.beams[0]!.toX).toBe(10);
    expect(frame.beams[0]!.toY).toBe(10);
    expect(frame.flashes[0]!.path).toBe(1);
    expect(frame.targets[0]!.x).toBe(10);
  });

  it('событие скрытого пути не даёт ни луча, ни вспышки', () => {
    const recent = new RecentEvents(8, 1000, 2);
    recent.push(2, 0, 0);
    const frame = deriveActivity(
      recent,
      {
        active: Uint8Array.from([1, 1, 0]),
        positions: Float32Array.from([0, 0, 10, 10, 20, 20]),
        representative: Int32Array.from([0, 1, -1]),
      },
      0,
      8,
    );
    expect(frame.beams).toHaveLength(0);
    expect(frame.flashes).toHaveLength(0);
    expect(frame.targets).toHaveLength(0);
  });
```

Существующие случаи в этом файле дополни полем `representative`, где каждый путь
представляет сам себя.

- [ ] **Step 3: Запустить тесты и убедиться, что они падают**

Run: `npx vitest run tests/web/scene.test.ts tests/web/activity.test.ts`
Expected: FAIL — у сцены нет поля `alpha`, у состояния сцены нет `representative`.

- [ ] **Step 4: Провести альфу через отрисовку**

`web/render/scene.ts` — в `SceneInput` после `color` добавить:

```ts
  /**
   * Яркость узла от фильтра: 1 — попал, около нуля — нет. Фильтр именно гасит,
   * поэтому альфа множится на кисть, а узел остаётся на своём месте в дереве.
   */
  alpha: Float32Array;
```

В цикле узлов заменить установку кисти и заливку на:

```ts
    ctx.globalAlpha = input.alpha[path]!;
    ctx.fillStyle = PALETTE[input.color[path]!]!;
    ctx.beginPath();
    ctx.arc(sx, sy, Math.max(0.5, r), 0, Math.PI * 2);
    ctx.fill();
    if (flash > 0) {
      ctx.globalAlpha = Math.min(1, flash) * 0.55 * input.alpha[path]!;
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    }
    ctx.globalAlpha = 1;
```

Цикл рёбер заменить целиком: ребро обязано гаснуть вместе со своими концами,
иначе погашенное поддерево останется висеть на ярких линиях.

```ts
  ctx.strokeStyle = '#2a3140';
  ctx.lineWidth = Math.max(0.4, camera.scale * 0.35);
  for (let i = 0; i < input.linkSource.length; i++) {
    const source = input.linkSource[i]!;
    const target = input.linkTarget[i]!;
    // Ребро не может быть ярче своих концов: иначе погашенная ветка осталась бы
    // соединена яркими линиями и читалась бы как активная.
    const edgeAlpha = Math.min(input.alpha[source]!, input.alpha[target]!);
    if (edgeAlpha <= 0) continue;
    const [ax, ay] = camera.toScreen(input.positions[source * 2]!, input.positions[source * 2 + 1]!);
    const [bx, by] = camera.toScreen(input.positions[target * 2]!, input.positions[target * 2 + 1]!);
    ctx.globalAlpha = edgeAlpha;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
```

Прежний единый `beginPath` на все рёбра был дешевле, но одной прозрачности на
весь слой теперь недостаточно.

- [ ] **Step 5: Провести представителя через вывод кадра**

`web/render/activity.ts` — в `ActivityScene` добавить поле:

```ts
  /** Кто представляет путь на экране; HIDDEN, если путь не показывается. */
  representative: Int32Array;
```

и в начале колбэка `recent.forEach` заменить проверку живости на разрешение
через представителя:

```ts
    // Единственное место, где решается, в какой узел бьёт луч. Свёрнутая папка
    // жива и рисуется, а её содержимое — нет: событие внутри неё должно
    // попадать в саму папку, иначе луч уходил бы в невидимый узел.
    const target = scene.representative[path];
    if (target < 0 || scene.active[target] !== 1) return;
    const x = scene.positions[target * 2]!;
    const y = scene.positions[target * 2 + 1]!;
```

и дальше по функции использовать `target` вместо `path` во вспышках и в ключе
слияния вспышек.

- [ ] **Step 6: Добавить структурную гарантию в хранилище узлов**

`web/layout/node-store.ts` — в месте, где собирается список активных узлов,
дополнить его созданием недостающего узла:

```ts
      // Раньше узлы рождались только из присланного списка добавленных. С
      // маской видимости путь может войти в маску, не появившись в этом списке
      // (например, схлопнутая папка стала видимой), и тогда у него не было бы
      // узла вовсе. Дешёвая структурная гарантия вместо доверия вызывающему.
```

и вместо пропуска пути без узла — создавать его тем же ленивым способом, что и
для добавленных.

- [ ] **Step 7: Написать падающий тест гарантии**

Дописать в `tests/web/node-store.test.ts`:

```ts
  it('заводит узел активному пути, которого не было в списке добавленных', () => {
    const store = new NodeStore(3, Uint32Array.from([0, 0, 1]), 1);
    store.applyUpdate({
      type: 'update',
      active: Uint8Array.from([1, 1, 1]),
      added: Uint32Array.from([]),
      radiusIds: Uint32Array.from([]),
      radiusValues: Float32Array.from([]),
      linkSource: Uint32Array.from([]),
      linkTarget: Uint32Array.from([]),
    });
    const positions = store.positions();
    expect(Number.isFinite(positions[4])).toBe(true);
    expect(Number.isFinite(positions[5])).toBe(true);
  });
```

Подставь в вызов ту форму сообщения обновления, которая принята в текущем коде;
если у хранилища иной способ отдать позиции — используй его.

- [ ] **Step 8: Собрать всё в точке входа**

`web/main.ts`:

- Заведи рядом с остальным состоянием спецификации и производные:

```ts
  let visibilitySpec: VisibilitySpec = { hidden: new Set(), collapsed: new Set() };
  let filterSpec: FilterSpec = EMPTY_FILTER;
  /** Куда едет яркость и откуда: переход длится MS, чтобы фильтр не мигал. */
  const ALPHA_TRANSITION_MS = 200;
  let alphaFrom = new Float32Array(pathCount).fill(1);
  let alphaTo = new Float32Array(pathCount).fill(1);
  let alphaStartedAt = -Infinity;
  /** Рисуемая маска прошлого применения: из её разницы берётся список рождающихся. */
  const prevDrawn = new Uint8Array(pathCount);
```

- В `applyDelta` после `scene.active.set(engine.alive)` вставь разрешение
  видимости и замени всё дальнейшее использование живой маски на рисуемую:

```ts
    const visibility = resolveVisibility(pack, engine.alive, engine.sizes, visibilitySpec);
    scene.active.set(visibility.drawn);
    scene.representative = visibility.representative;
```

  Радиус считай из `visibility.sizes`, а не из `engine.sizes`: у свёрнутой папки
  он должен отражать спрятанный внутри объём.

- Список рождающихся узлов бери из разницы рисуемых масок, а не из разницы
  движка: путь может войти в кадр, не родившись в истории, — например, когда
  пользователь развернул папку.

```ts
    // Разница движка отвечает на вопрос «что родилось в истории», а воркеру
    // нужен ответ на другой: «что появилось на сцене». С видимостью это уже не
    // одно и то же — развёрнутая папка выпускает наружу узлы, которые в истории
    // не менялись.
    const born: number[] = [];
    for (let path = 0; path < pathCount; path++) {
      if (scene.active[path] === 1 && prevDrawn[path] === 0) born.push(path);
    }
    prevDrawn.set(scene.active);
```

  и отправь `Uint32Array.from(born)` воркеру вместо `delta.added`.

- Заведи функцию применения новой спецификации, которую позовёт панель:

```ts
  function applyVisibility(next: VisibilitySpec): void {
    visibilitySpec = next;
    applyDelta(engine.seek(engine.cursor), true);
  }

  function applyFilter(next: FilterSpec, nowMs: number): void {
    filterSpec = next;
    alphaFrom = scene.alpha.slice();
    alphaTo = computeAlpha(pack, filterSpec);
    alphaStartedAt = nowMs;
  }
```

- В кадре, до отрисовки, продвинь переход яркости:

```ts
      const t = Math.min(1, (nowMs - alphaStartedAt) / ALPHA_TRANSITION_MS);
      if (t < 1) {
        for (let path = 0; path < pathCount; path++) {
          scene.alpha[path] = alphaFrom[path]! + (alphaTo[path]! - alphaFrom[path]!) * t;
        }
      } else if (scene.alpha !== alphaTo) {
        scene.alpha.set(alphaTo);
      }
```

- [ ] **Step 9: Прогнать всё**

Run: `npx vitest run && npm run typecheck && npm run build && npx playwright test`
Expected: PASS во всех четырёх; прежние сквозные тесты зелёные — без фильтра и
скрытий картинка та же.

- [ ] **Step 10: Коммит**

```bash
git add -A
git commit -m "feat(web): dim by filter alpha and resolve beams through representatives"
```

---

### Task 5: Левая панель — фильтры и навигатор дерева

**Files:**
- Create: `web/ui/sidebar.ts`
- Modify: `web/index.html`, `web/main.ts`
- Test: `tests/web/sidebar.test.ts`

**Interfaces:**
- Consumes: `Pack`, `FilterSpec`, `VisibilitySpec`, `extensionOf`
- Produces: `SidebarOptions { pack: Pack; onFilter(spec: FilterSpec): void; onVisibility(spec: VisibilitySpec): void }`; `SidebarHandles { unmount(): void }`; `mountSidebar(root: HTMLElement, options: SidebarOptions): SidebarHandles`; `topExtensions(pack: Pack, limit: number): string[]`; `directChildren(pack: Pack, parent: number): number[]`

- [ ] **Step 1: Написать падающий тест чистых помощников**

`tests/web/sidebar.test.ts`:

```ts
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { directChildren, mountSidebar, topExtensions } from '../../web/ui/sidebar.js';
import { buildPack } from '../../src/model/build.js';
import type { RawCommit } from '../../src/git/types.js';

const change = (path: string) => ({
  path,
  kind: 'add' as const,
  added: 1,
  deleted: 0,
  binary: false,
});

const pack = buildPack(
  [
    {
      hash: 'c0',
      authorName: 'Аня',
      authorEmail: 'anya@e.com',
      timestamp: 1,
      subject: 'c0',
      changes: [change('src/a.ts'), change('src/b.ts'), change('docs/c.md')],
    },
  ],
  { repoName: 'demo', head: 'c0' },
);

const id = (path: string) => pack.paths.indexOf(path);

describe('topExtensions', () => {
  it('возвращает самые частые расширения по убыванию', () => {
    expect(topExtensions(pack, 5)).toEqual(['ts', 'md']);
  });

  it('уважает предел', () => {
    expect(topExtensions(pack, 1)).toEqual(['ts']);
  });
});

describe('directChildren', () => {
  it('отдаёт только прямых потомков', () => {
    expect(directChildren(pack, id('src')).map((child) => pack.paths[child])).toEqual([
      'src/a.ts',
      'src/b.ts',
    ]);
  });

  it('у листа потомков нет', () => {
    expect(directChildren(pack, id('src/a.ts'))).toEqual([]);
  });
});

describe('mountSidebar', () => {
  it('сообщает выбранных авторов', () => {
    const root = document.createElement('div');
    document.body.append(root);
    let last: unknown = null;
    mountSidebar(root, { pack, onFilter: (spec) => (last = spec), onVisibility: () => {} });

    const box = root.querySelector<HTMLInputElement>('input[data-author="0"]')!;
    box.checked = false;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    expect((last as { authors: Set<number> }).authors.has(0)).toBe(false);
  });

  it('сообщает образец пути', () => {
    const root = document.createElement('div');
    document.body.append(root);
    let last: unknown = null;
    mountSidebar(root, { pack, onFilter: (spec) => (last = spec), onVisibility: () => {} });

    const field = root.querySelector<HTMLInputElement>('input[data-role="path"]')!;
    field.value = 'src/*';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    expect((last as { pathQuery: string }).pathQuery).toBe('src/*');
  });

  it('сообщает скрытие папки', () => {
    const root = document.createElement('div');
    document.body.append(root);
    let last: unknown = null;
    mountSidebar(root, { pack, onFilter: () => {}, onVisibility: (spec) => (last = spec) });

    const box = root.querySelector<HTMLInputElement>(`input[data-hide="${id('src')}"]`)!;
    box.checked = false;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    expect((last as { hidden: Set<number> }).hidden.has(id('src'))).toBe(true);
  });

  it('снимает обработчики при размонтировании', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const handles = mountSidebar(root, { pack, onFilter: () => {}, onVisibility: () => {} });
    handles.unmount();
    expect(root.children.length).toBe(0);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run tests/web/sidebar.test.ts`
Expected: FAIL — не найден модуль `web/ui/sidebar.js`.

- [ ] **Step 3: Добавить разметку и стили**

`web/index.html` — внутри `<style>` добавить:

```css
      #sidebar { position: fixed; left: 12px; top: 12px; width: 260px; max-height: 70vh;
        overflow: auto; padding: 10px 12px; background: #161b22e6;
        border: 1px solid #30363d; border-radius: 8px; }
      #sidebar[hidden] { display: none; }
      #sidebar h2 { margin: 0 0 6px; font-size: 12px; color: #8b949e; font-weight: 600; }
      #sidebar section + section { margin-top: 12px; }
      #sidebar label { display: flex; align-items: center; gap: 6px; padding: 1px 0; }
      #sidebar input[type="text"] { width: 100%; box-sizing: border-box; padding: 4px 6px;
        background: #0d1117; color: #c9d1d9; border: 1px solid #30363d; border-radius: 5px;
        font: inherit; }
      .tree-row { display: flex; align-items: center; gap: 4px; }
      .tree-row button { width: 18px; padding: 0; background: none; border: none;
        color: #8b949e; cursor: pointer; font: inherit; }
      .tree-children { margin-left: 14px; }
```

и рядом с `<canvas id="scene">` добавить `<aside id="sidebar" hidden></aside>`.

- [ ] **Step 4: Реализовать панель**

`web/ui/sidebar.ts`:

```ts
import type { Pack } from '../../src/model/types.js';
import { extensionOf, type FilterSpec } from '../state/filter.js';
import type { VisibilitySpec } from '../state/visibility.js';

export interface SidebarOptions {
  pack: Pack;
  /** Видимость, восстановленная из хранилища; по умолчанию не скрыто ничего. */
  initialVisibility?: VisibilitySpec;
  onFilter(spec: FilterSpec): void;
  onVisibility(spec: VisibilitySpec): void;
}

export interface SidebarHandles {
  unmount(): void;
}

/**
 * Каталоги, которые почти никогда не нужны на сцене. Ничего из этого по
 * умолчанию не скрыто: инструмент не должен молча прятать данные. Кнопка
 * рядом применяет весь набор одним нажатием — на типичном JS-репозитории без
 * неё первая картинка это ком зависимостей, в котором не видно своего кода.
 */
const NOISE = ['node_modules', 'vendor', 'dist', 'build', 'target', '.git'];

/** Самые частые расширения файлов, по убыванию. */
export function topExtensions(pack: Pack, limit: number): string[] {
  const counts = new Map<string, number>();
  for (let path = 0; path < pack.meta.pathCount; path++) {
    if (pack.pathIsDir[path] === 1) continue;
    const ext = extensionOf(pack.paths[path]!);
    if (ext === '') continue;
    counts.set(ext, (counts.get(ext) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, Math.max(0, limit))
    .map(([ext]) => ext);
}

/**
 * Прямые потомки пути. Полный обход допустим: навигатор строится лениво, при
 * раскрытии узла, а не каждый кадр.
 */
export function directChildren(pack: Pack, parent: number): number[] {
  const children: number[] = [];
  for (let path = 1; path < pack.meta.pathCount; path++) {
    if (pack.pathParent[path] === parent) children.push(path);
  }
  return children;
}

export function mountSidebar(root: HTMLElement, options: SidebarOptions): SidebarHandles {
  const { pack } = options;
  root.hidden = false;
  root.replaceChildren();

  const checkedAuthors = new Set<number>(pack.authors.map((_, index) => index));
  const chosenExtensions = new Set<string>();
  const hidden = new Set<number>(options.initialVisibility?.hidden ?? []);
  const collapsed = new Set<number>(options.initialVisibility?.collapsed ?? []);
  let pathQuery = '';

  function emitFilter(): void {
    options.onFilter({
      // Все галочки на месте — это отсутствие фильтра, а не совпадение со
      // всеми: иначе автор без единого файла гасил бы всё дерево.
      authors: checkedAuthors.size === pack.authors.length ? null : new Set(checkedAuthors),
      pathQuery,
      extensions: chosenExtensions.size === 0 ? null : new Set(chosenExtensions),
    });
  }

  function emitVisibility(): void {
    options.onVisibility({ hidden: new Set(hidden), collapsed: new Set(collapsed) });
  }

  function section(title: string): HTMLElement {
    const box = document.createElement('section');
    const heading = document.createElement('h2');
    heading.textContent = title;
    box.append(heading);
    return box;
  }

  const authorsBox = section('Авторы');
  pack.authors.forEach((author, index) => {
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = true;
    box.dataset.author = String(index);
    box.addEventListener('change', () => {
      if (box.checked) checkedAuthors.add(index);
      else checkedAuthors.delete(index);
      emitFilter();
    });
    const name = document.createElement('span');
    name.textContent = author.name || author.email;
    label.append(box, name);
    authorsBox.append(label);
  });

  const pathBox = section('Путь');
  const pathField = document.createElement('input');
  pathField.type = 'text';
  pathField.dataset.role = 'path';
  pathField.placeholder = 'например, src/* или utils';
  pathField.addEventListener('input', () => {
    pathQuery = pathField.value;
    emitFilter();
  });
  pathBox.append(pathField);

  const extBox = section('Расширения');
  for (const ext of topExtensions(pack, 12)) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.dataset.ext = ext;
    chip.textContent = ext;
    chip.setAttribute('aria-pressed', 'false');
    chip.addEventListener('click', () => {
      if (chosenExtensions.has(ext)) chosenExtensions.delete(ext);
      else chosenExtensions.add(ext);
      chip.setAttribute('aria-pressed', chosenExtensions.has(ext) ? 'true' : 'false');
      emitFilter();
    });
    extBox.append(chip);
  }

  const treeBox = section('Дерево');
  const noiseButton = document.createElement('button');
  noiseButton.type = 'button';
  noiseButton.dataset.role = 'noise';
  noiseButton.textContent = 'Скрыть типовой шум';
  noiseButton.addEventListener('click', () => {
    for (let path = 1; path < pack.meta.pathCount; path++) {
      if (pack.pathIsDir[path] !== 1) continue;
      const name = pack.paths[path]!.slice(pack.paths[path]!.lastIndexOf('/') + 1);
      if (NOISE.includes(name)) hidden.add(path);
    }
    refreshTree();
    emitVisibility();
  });
  treeBox.append(noiseButton);

  const treeRoot = document.createElement('div');
  treeBox.append(treeRoot);

  /** Раскрытые узлы: дети строятся лениво и только для них. */
  const expanded = new Set<number>([0]);

  function renderTree(parent: number, container: HTMLElement): void {
    for (const child of directChildren(pack, parent)) {
      if (pack.pathIsDir[child] !== 1) continue; // скрывать можно только папки

      const row = document.createElement('div');
      row.className = 'tree-row';

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.textContent = expanded.has(child) ? '▾' : '▸';
      toggle.setAttribute('aria-label', expanded.has(child) ? 'Свернуть список' : 'Развернуть список');
      toggle.addEventListener('click', () => {
        if (expanded.has(child)) expanded.delete(child);
        else expanded.add(child);
        refreshTree();
      });

      const show = document.createElement('input');
      show.type = 'checkbox';
      show.checked = !hidden.has(child);
      show.dataset.hide = String(child);
      show.setAttribute('aria-label', 'Показывать папку');
      show.addEventListener('change', () => {
        if (show.checked) hidden.delete(child);
        else hidden.add(child);
        emitVisibility();
      });

      const fold = document.createElement('button');
      fold.type = 'button';
      fold.dataset.collapse = String(child);
      fold.textContent = collapsed.has(child) ? '◼' : '◻';
      fold.setAttribute('aria-label', collapsed.has(child) ? 'Развернуть папку на сцене' : 'Свернуть папку в один узел');
      fold.addEventListener('click', () => {
        if (collapsed.has(child)) collapsed.delete(child);
        else collapsed.add(child);
        fold.textContent = collapsed.has(child) ? '◼' : '◻';
        emitVisibility();
      });

      const name = document.createElement('span');
      name.textContent = pack.paths[child]!.slice(pack.paths[child]!.lastIndexOf('/') + 1);

      row.append(toggle, show, fold, name);
      container.append(row);

      if (expanded.has(child)) {
        const children = document.createElement('div');
        children.className = 'tree-children';
        container.append(children);
        renderTree(child, children);
      }
    }
  }

  function refreshTree(): void {
    treeRoot.replaceChildren();
    renderTree(0, treeRoot);
  }

  refreshTree();
  root.append(authorsBox, pathBox, extBox, treeBox);

  return {
    unmount(): void {
      // Все обработчики висят на элементах внутри корня, поэтому очистка
      // содержимого снимает их вместе с узлами; отдельных слушателей на окне
      // или документе панель не заводит.
      root.replaceChildren();
      root.hidden = true;
    },
  };
}
```

- [ ] **Step 5: Подключить панель и сохранение выбора**

`web/main.ts` — рядом с монтированием транспорта:

```ts
  /** Ключ хранилища привязан к репозиторию: у разных проектов свой набор. */
  const VISIBILITY_KEY = `gource-reborn:visibility:${pack.meta.repoName}`;

  function loadVisibility(): VisibilitySpec {
    // В приватном режиме обращение к хранилищу бросает — молча работаем без него.
    try {
      const raw = localStorage.getItem(VISIBILITY_KEY);
      if (!raw) return { hidden: new Set(), collapsed: new Set() };
      const parsed = JSON.parse(raw) as { hidden?: number[]; collapsed?: number[] };
      return {
        hidden: new Set(Array.isArray(parsed.hidden) ? parsed.hidden : []),
        collapsed: new Set(Array.isArray(parsed.collapsed) ? parsed.collapsed : []),
      };
    } catch {
      return { hidden: new Set(), collapsed: new Set() };
    }
  }

  function saveVisibility(spec: VisibilitySpec): void {
    try {
      localStorage.setItem(
        VISIBILITY_KEY,
        JSON.stringify({ hidden: [...spec.hidden], collapsed: [...spec.collapsed] }),
      );
    } catch {
      // Не беда: выбор просто не переживёт перезагрузку.
    }
  }

  const sidebarRoot = document.getElementById('sidebar');
  if (sidebarRoot) {
    visibilitySpec = loadVisibility();
    mountSidebar(sidebarRoot, {
      pack,
      initialVisibility: visibilitySpec,
      onFilter: (spec) => applyFilter(spec, performance.now()),
      onVisibility: (spec) => {
        saveVisibility(spec);
        applyVisibility(spec);
      },
    });
  }
```

Восстановленную видимость применяй до первого показа: вызов
`applyDelta(engine.seek(...), true)` должен идти после чтения хранилища, иначе
первый кадр покажет то, что пользователь в прошлый раз убрал.

Фильтр не сохраняй: он относится к текущему разбирательству, а не к
репозиторию, и восстановленный при следующем запуске выглядел бы как поломка.

Учти, что `applyVisibility` делает полное применение, а оно, как и перемотка,
очищает буфер недавних событий. Это правильно: луч, нацеленный в узел, который
пользователь только что скрыл, должен исчезнуть вместе с ним.

- [ ] **Step 6: Прогнать всё**

Run: `npx vitest run && npm run typecheck && npm run build && npx playwright test`
Expected: PASS во всех четырёх.

- [ ] **Step 7: Коммит**

```bash
git add -A
git commit -m "feat(ui): sidebar with filters and tree navigator"
```

---

### Task 6: Сквозной тест и живая проверка

**Files:**
- Test: `tests/e2e/filtering.spec.ts`
- Modify: `tests/helpers/cli.ts` (создать), прочие сквозные тесты (использовать помощник)

**Interfaces:**
- Produces: `startCli(repo: string): Promise<{ url: string; stop(): void }>` в `tests/helpers/cli.ts`

- [ ] **Step 1: Вынести запуск CLI в помощник**

Блок запуска процесса и ожидания адреса повторён дословно в четырёх сквозных
тестах — это отмечалось ревью дважды.

`tests/helpers/cli.ts`:

```ts
import { spawn } from 'node:child_process';

export interface RunningCli {
  url: string;
  stop(): void;
}

/** Поднимает собранный CLI на репозитории и ждёт напечатанный им адрес. */
export async function startCli(repo: string, extraArgs: string[] = []): Promise<RunningCli> {
  const child = spawn(
    'node',
    ['dist/node/cli/main.js', repo, '--port', '0', '--no-open', ...extraArgs],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );

  const url = await new Promise<string>((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`CLI не напечатал URL за 30 с:\n${out}`));
    }, 30_000);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.stdout!.on('data', (chunk: Buffer) => {
      out += chunk.toString();
      const match = out.match(/http:\/\/localhost:\d+/);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    });
  });

  return { url, stop: () => void child.kill('SIGTERM') };
}
```

Затем переведи на него `tests/e2e/first-frame.spec.ts`, `playback.spec.ts`,
`authors.spec.ts` и `hud-layout.spec.ts`, убрав из них скопированный блок.
Поведение не меняется, все сквозные тесты обязаны остаться зелёными.

- [ ] **Step 2: Написать падающий сквозной тест**

`tests/e2e/filtering.spec.ts`:

```ts
import { test, expect, type Page } from '@playwright/test';
import { startCli, type RunningCli } from '../helpers/cli.js';
import { makeRepo, cleanupRepos } from '../helpers/tmp-repo.js';

let cli: RunningCli | null = null;

test.afterAll(async () => {
  cli?.stop();
  await cleanupRepos();
});

/**
 * Сумма непрозрачности холста. Гашение фильтром уменьшает её, но не обнуляет:
 * именно этим «гасит» отличается от «скрывает».
 */
async function brightness(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.getElementById('scene') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let sum = 0;
    for (let i = 3; i < data.length; i += 4) sum += data[i]!;
    return sum;
  });
}

async function liveNodes(page: Page): Promise<number> {
  const text = await page.locator('#status').textContent();
  const match = (text ?? '').match(/узлов: (\d+)/);
  return match ? Number(match[1]) : -1;
}

test('фильтр гасит, а видимость убирает', async ({ page }) => {
  const repo = await makeRepo([
    {
      message: 'первый',
      author: { name: 'Аня Петрова', email: 'anya@e.com' },
      write: { 'src/a.ts': 'a\n', 'src/deep/b.ts': 'b\n' },
    },
    {
      message: 'второй',
      author: { name: 'Бо Ли', email: 'bo@e.com' },
      write: { 'docs/c.md': 'c\n', 'docs/d.md': 'd\n' },
    },
    {
      message: 'третий',
      author: { name: 'Аня Петрова', email: 'anya@e.com' },
      write: { 'src/e.ts': 'e\n' },
    },
  ]);

  cli = await startCli(repo);
  await page.goto(cli.url);
  await page.waitForSelector('canvas[data-ready="true"]');
  await expect(page.locator('#sidebar')).toBeVisible();

  const nodesAtStart = await liveNodes(page);
  const full = await brightness(page);
  expect(full).toBeGreaterThan(0);

  // Снимаем одного автора: его файлы обязаны погаснуть, но остаться на сцене.
  await page.locator('#sidebar input[data-author="1"]').uncheck();
  await expect.poll(async () => brightness(page), { timeout: 5_000 }).toBeLessThan(full * 0.9);
  expect(await brightness(page)).toBeGreaterThan(0);
  expect(await liveNodes(page)).toBe(nodesAtStart);

  // Возвращаем — яркость должна восстановиться.
  await page.locator('#sidebar input[data-author="1"]').check();
  await expect.poll(async () => brightness(page), { timeout: 5_000 }).toBeGreaterThan(full * 0.95);

  // Скрываем папку: здесь узлы действительно уходят.
  await page.locator('#sidebar input[data-hide]').first().uncheck();
  await expect.poll(async () => liveNodes(page), { timeout: 5_000 }).toBeLessThan(nodesAtStart);
  const afterHide = await liveNodes(page);

  // Возвращаем и сворачиваем ту же папку: узлов меньше, но сама папка на месте.
  await page.locator('#sidebar input[data-hide]').first().check();
  await expect.poll(async () => liveNodes(page), { timeout: 5_000 }).toBe(nodesAtStart);
  await page.locator('#sidebar button[data-collapse]').first().click();
  await expect.poll(async () => liveNodes(page), { timeout: 5_000 }).toBeLessThan(nodesAtStart);
  expect(await liveNodes(page)).toBeGreaterThan(afterHide);
});
```

- [ ] **Step 3: Собрать и убедиться, что тест падает**

Run: `npm run build && npx playwright test tests/e2e/filtering.spec.ts`
Expected: FAIL — панели нет либо фильтр не влияет.

- [ ] **Step 4: Довести до зелёного**

Правь только то, что действительно сломано. Если тест обнаружит расхождение с
задуманным поведением, опиши его в отчёте, а не подгоняй ожидания.

- [ ] **Step 5: Прогнать всё и проверить вживую**

Run: `npx vitest run && npm run typecheck && npm run build && npx playwright test`
Затем: `node dist/node/cli/main.js .`

Expected: слева панель. Снятие автора гасит его файлы, дерево остаётся целым и
путь к оставшемуся видно. Образец пути и чипы расширений работают так же.
Скрытие папки убирает её из симуляции, и граф занимает освободившееся место.
Сворачивание оставляет один узел, размер которого отражает спрятанный объём, и
лучи авторов, работающих внутри, бьют в этот узел. Выбор видимости переживает
перезагрузку страницы. Опиши в отчёте честно, включая неидеальное.

- [ ] **Step 6: Коммит**

```bash
git add -A
git commit -m "test(e2e): filtering and visibility end to end"
```

---

## Что остаётся следующим планам

- Вторая половина среза 5: инспектор узла по клику, поиск с подсветкой и фокусом
  камеры, подписи узлов, наведение. Там же — подпись свёрнутой папки «имя · N файлов»
  из §9 и вторая ось цвета значков авторов.
- Срез 6: `--export`, предупреждение о слишком большом репозитории, перф-бюджеты,
  стоимость переноса разницы в сцену и сборки слоёв активности.

## Как построено (по итогам исполнения)

- **Сопоставление с образцом — два указателя, не регулярное выражение.** Первая
  версия строила `RegExp` из образца, и десять звёзд считались 15 секунд, а
  двенадцать не досчитывались никогда — при том что поле фильтра срабатывает на
  каждое нажатие клавиши. Замена на проход двумя указателями с откатом дала
  0.0 мс на том же входе. Порядок ветвей внутри важен: звезда проверяется до
  сравнения литералов, иначе литеральная `*` в пути съедает звезду образца. Это
  нашлось только сличением с перебором на алфавите, куда входят сами `*` и `?`.
- **Скрытие проверяется раньше сворачивания.** `resolveVisibility` идёт одним
  восходящим проходом, и скрытая папка внутри свёрнутой обязана дать `HIDDEN`, а
  не унаследовать представителя предка.
- **Радиус представителя считается по агрегату, а не по собственному размеру.**
  Свёрнутая папка с 530 строками внутри рисовалась точкой в 3 пиксела: источник
  размера поменяли, а формулу для каталогов — нет.
- **«Пересчитать радиусы» и «курсор сдвинулся» — разные вещи.** Один общий флаг
  на оба смысла приводил к тому, что переключение видимости стирало лучи и
  сбрасывало поле авторов.
- **Яркость луча берётся там же, где разрешается его конец** — по тому же
  представителю. Иначе фильтр гасил заливку и вспышку, а самый заметный слой
  продолжал бить в полную силу по едва видимым узлам.
- **Вписывание камеры отступает на фактическую ширину панели** (`getBoundingClientRect`,
  не константа): без этого на каждом старте примерно 200 пикселей дерева
  оказывались под панелью, а достать их можно было только ручным
  панорамированием, которое навсегда выключает автовписывание.
- **Видимость сохраняется строками путей, а не номерами.** Номера сдвигаются при
  вливании давно живущей ветки, и сохранённый вчера номер назавтра означает
  другую папку, которая молча исчезает. Неизвестные при загрузке пути
  отбрасываются; старый числовой формат читается как «ничего не скрыто».
- **Держатель состояния видимости один.** Панель принимает его извне через
  `setVisibility`, не вызывая при этом обратный колбэк, — иначе получилась бы
  петля.
- **Сквозной тест ждёт стабилизации, а не спит фиксированную паузу.** Готовность
  холста не означает, что картинка устоялась: во время раскладки и отъезда
  камеры яркость меняется в 15–20 раз по причинам, к фильтру отношения не
  имеющим. Опрос до совпадения последовательных замеров, с ограничением сверху.

### Сознательное отступление

Образцы файлов (`.min.*`, lock-файлы) в список типового шума **не добавлены**.
Навигатор показывает только каталоги, кнопки «показать всё» нет, а скрытие
убирает узел из симуляции — фильтром его назад не вернуть. Одно нажатие спрятало
бы файлы без пути назад. Вдобавок список сравнивает имена папок точным
совпадением, так что образцы потребовали бы не строки в списке, а механизма
глобов. Вернуться к этому — когда файлы появятся в навигаторе или инспекторе.

### Хвосты для следующего плана

- `tests/e2e/sidebar-fit.spec.ts` не ставит собственный таймаут, хотя худший
  случай подходит к общему пределу в 60 секунд, — сделать первым.
- Комментарий в `web/state/visibility.ts` обещает построение индекса путей один
  раз на разбор, а строится он дважды (скрытые и свёрнутые).
