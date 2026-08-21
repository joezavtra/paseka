# Инспектор, поиск и подписи — план реализации


**Goal:** По клику на узел открывается карточка с его историей; поиск по пути обводит найденное и уводит камеру к первому совпадению; крупные, найденные и наведённые узлы подписаны, а свёрнутая папка честно говорит, сколько файлов в ней спрятано.

**Architecture:** Всё новое выводится из пакета и текущего курсора чистыми функциями, а DOM и холст остаются потребителями. Появляется одно недостающее звено — обратное отображение «точка экрана → путь»; через него работают и клик, и наведение. Подсветка найденного — отдельная ось от яркости фильтра: фильтр гасит непопавшее, поиск обводит попавшее, и путать эти две оси нельзя.

**Tech Stack:** TypeScript (strict, ESM), Node 20+, Vite, vitest, happy-dom, Playwright.

**Spec:** [docs/design.md](../design.md) — §9 (подпись свёрнутой папки), §10 (поиск), §11 (подписи), §12 (инспектор). Вторая половина среза 5.

**Scope:** `--export`, предупреждение о большом репозитории и перф-бюджеты — срез 6. Легенда расширений и переключатель режимов «воспроизведение / исследование» из §12 в этот план не входят: панели уже открыты постоянно, а отдельный режим без экспорта проверить нечем.

## Global Constraints

- Node `>=20`. ESM, `"type": "module"`. **Все относительные импорты — с расширением `.js`.**
- TypeScript `strict: true`, `noUncheckedIndexedAccess` **выключен**.
- В `src/` — только `node:`-модули. Код в `web/` не зависит от `node:`. `Math.random()` запрещён.
- Тексты для пользователя и комментарии — на русском; идентификаторы, имена файлов, сообщения коммитов — английские.
- Vitest без `globals`; среда с DOM включается пофайлово докблоком `// @vitest-environment happy-dom`.
- Массивы по узлам индексируются идентификатором пути; идентификатор родителя всегда меньше идентификатора потомка.
- Любое значение, приходящее снаружи, может оказаться негодным. Проверяй до использования.
- Каждая задача заканчивается коммитом.

## Три оси, которые нельзя смешивать

К концу среза у узла три независимых признака, и каждый отвечает на свой вопрос:

- **`alpha` — яркость от фильтра.** «Попал ли узел под фильтр». Гасит, не убирает; у каталога — максимум по потомкам.
- **`hit` — попадание в поиск.** «Нашёл ли его пользователь прямо сейчас». Рисуется обводкой, **не** трогает `alpha`: найденный файл в погашенной фильтром ветке обязан остаться погашенным и при этом обведённым — иначе поиск молча отменял бы фильтр. Наверх по дереву не поднимается: обводка — точная метка, а не подсветка ветки.
- **`representative` — кто рисуется вместо узла.** Через него адресуются и лучи (срез 5a), и обводка поиска, и клик инспектора. Правило одно на всех: если у пути есть представитель, работаем с представителем.

## File Structure

- `web/render/pick.ts` — **создать.** Чистый подбор узла под точкой мира. Единственное место, где живёт правило «на что показывает курсор».
- `web/state/node-info.ts` — **создать.** Чистое описание узла на текущем курсоре: размер, рождение, контрибьюторы, последние коммиты, спарклайн.
- `web/ui/inspector.ts` — **создать.** Правая панель-карточка. Только DOM, никакой логики выборки.
- `web/state/search.ts` — **создать.** Маска попаданий по образцу и её проекция на представителей.
- `web/render/labels.ts` — **создать.** Отбор подписей и текст подписи, включая «имя папки · N файлов».
- `web/render/avatar.ts` — **изменить.** Вторая ось цвета значка (светлота) поверх оттенка.
- `web/state/visibility.ts` — **изменить.** Добавить счётчик файлов на представителя.
- `web/render/scene.ts` — **изменить.** Слой обводки найденного и слой подписей.
- `web/render/camera.ts` — **изменить.** Фокус на точке мира.
- `web/ui/sidebar.ts` — **изменить.** Секция поиска, счётчик совпадений, горячая клавиша `/`.
- `web/main.ts` — **изменить.** Клик и наведение, проводка инспектора и поиска, полоса справа во вписывании камеры.
- `web/index.html` — **изменить.** Корень инспектора и его стили.

---

### Task 1: Хвосты среза 5a и подбор узла под точкой

**Files:**
- Modify: `tests/e2e/sidebar-fit.spec.ts`
- Modify: `web/state/visibility.ts` (только комментарий)
- Create: `web/render/pick.ts`
- Test: `tests/web/pick.test.ts`

**Interfaces:**
- Consumes: ничего из этого плана.
- Produces: `pickNode(input: PickInput, worldX: number, worldY: number, slack: number): number`, константа `NOTHING = -1`, тип `PickInput { active: Uint8Array; positions: Float32Array; radius: Float32Array }`.

Два хвоста, оставленных предыдущим срезом, закрываются здесь же первым коммитом: причина ещё свежа, а тянуть их дальше — значит забыть.

**Правило подбора.** Кандидат — рисуемый узел (`active[path] === 1`). Сначала ищем **прямое накрытие**: расстояние от точки до центра не больше радиуса. Если накрывающих несколько (файл поверх своего каталога — обычное дело), выигрывает **наибольший идентификатор**: отрисовка идёт по возрастанию идентификатора, значит узел с большим номером нарисован позже и лежит сверху — пользователь целится именно в него. Если прямого накрытия нет, берём ближайший узел, у которого зазор `расстояние - радиус` не превышает `slack`; при равенстве зазоров — снова больший идентификатор. Если и таких нет — `NOTHING`.

Допуск нужен потому, что на отдалении радиус узла — доли пикселя, и попасть в него мышью невозможно. Вызывающий переводит допуск из экранных пикселей в мировые делением на масштаб камеры; сам `pickNode` о камере не знает.

- [ ] **Step 1: Хвост — собственный таймаут сквозному тесту**

В `tests/e2e/sidebar-fit.spec.ts`, первой строкой внутри `test(...)`:

```ts
  // Тот же случай, что и в filtering.spec.ts: до 30 с на запуск CLI плюс до
  // 20 с ожидания раскладки плюс сам цикл замеров подходят к общему пределу в
  // 60 с. На нагруженной машине тест упрётся в него раньше, чем в собственный
  // дедлайн, и вместо внятной причины выдаст сообщение о таймауте теста.
  test.setTimeout(120_000);
```

- [ ] **Step 2: Хвост — неточный комментарий в visibility.ts**

Найти в `web/state/visibility.ts` комментарий, обещающий, что индекс «путь → идентификатор» строится один раз на разбор, и привести его в соответствие с кодом: `idsOf` вызывается дважды (для скрытых и для свёрнутых), значит и индекс строится дважды. Это дёшево (пакет читается один раз при загрузке страницы), но комментарий не должен утверждать то, чего нет.

- [ ] **Step 3: Коммит хвостов**

```bash
git add -A
git commit -m "chore: carry over slice 5a tails"
```

- [ ] **Step 4: Написать падающий тест**

Создать `tests/web/pick.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { NOTHING, pickNode, type PickInput } from '../../web/render/pick.js';
import { makeRng } from '../../src/util/rng.js';

interface Node {
  x: number;
  y: number;
  r: number;
  drawn?: boolean;
}

function input(nodes: Node[]): PickInput {
  return {
    active: Uint8Array.from(nodes.map((n) => (n.drawn === false ? 0 : 1))),
    positions: Float32Array.from(nodes.flatMap((n) => [n.x, n.y])),
    radius: Float32Array.from(nodes.map((n) => n.r)),
  };
}

describe('pickNode', () => {
  it('выбирает узел, накрывающий точку', () => {
    const nodes = [{ x: 0, y: 0, r: 5 }];
    expect(pickNode(input(nodes), 3, 0, 0)).toBe(0);
    expect(pickNode(input(nodes), 6, 0, 0)).toBe(NOTHING);
  });

  it('из накрывающих выбирает нарисованный последним', () => {
    // Каталог (id 0) и лежащий на нём файл (id 1) в одной точке: отрисовка
    // идёт по возрастанию идентификатора, значит сверху файл — в него и целятся.
    const nodes = [
      { x: 0, y: 0, r: 30 },
      { x: 0, y: 0, r: 4 },
    ];
    expect(pickNode(input(nodes), 1, 0, 0)).toBe(1);
    // А за пределами файла остаётся каталог.
    expect(pickNode(input(nodes), 10, 0, 0)).toBe(0);
  });

  it('не выбирает нерисуемые узлы', () => {
    const nodes = [{ x: 0, y: 0, r: 5, drawn: false }];
    expect(pickNode(input(nodes), 0, 0, 10)).toBe(NOTHING);
  });

  it('допуск работает только при отсутствии прямого попадания', () => {
    const nodes = [
      { x: 0, y: 0, r: 20 }, // накрывает точку (5, 0)
      { x: 40, y: 0, r: 2 }, // рядом, но не накрывает
    ];
    // Прямое попадание сильнее близости: 1 ближе к допуску, но 0 накрывает.
    expect(pickNode(input(nodes), 5, 0, 100)).toBe(0);
  });

  it('в пределах допуска выбирает ближайший по зазору', () => {
    const nodes = [
      { x: 0, y: 0, r: 1 },
      { x: 10, y: 0, r: 1 },
    ];
    expect(pickNode(input(nodes), 8, 0, 5)).toBe(1);
    expect(pickNode(input(nodes), 3, 0, 5)).toBe(0);
    // За пределом допуска — ничего.
    expect(pickNode(input(nodes), 5, 0, 1)).toBe(NOTHING);
  });

  it('совпадает с перебором на случайных сценах', () => {
    const rng = makeRng(20260818);
    for (let round = 0; round < 2000; round++) {
      const count = 1 + Math.floor(rng() * 8);
      const nodes: Node[] = [];
      for (let i = 0; i < count; i++) {
        nodes.push({
          x: Math.round(rng() * 40) - 20,
          y: Math.round(rng() * 40) - 20,
          r: Math.round(rng() * 8),
          drawn: rng() > 0.2,
        });
      }
      const x = Math.round(rng() * 40) - 20;
      const y = Math.round(rng() * 40) - 20;
      const slack = Math.round(rng() * 6);
      expect(pickNode(input(nodes), x, y, slack)).toBe(oracle(nodes, x, y, slack));
    }
  });
});

/** Перебор по определению правила: медленно, зато очевидно. */
function oracle(nodes: Node[], x: number, y: number, slack: number): number {
  let covered = NOTHING;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    if (node.drawn === false) continue;
    if (Math.hypot(node.x - x, node.y - y) <= node.r) covered = i;
  }
  if (covered !== NOTHING) return covered;

  let best = NOTHING;
  let bestGap = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    if (node.drawn === false) continue;
    const gap = Math.hypot(node.x - x, node.y - y) - node.r;
    if (gap <= slack && gap <= bestGap) {
      best = i;
      bestGap = gap;
    }
  }
  return best;
}
```

- [ ] **Step 5: Убедиться, что тест падает**

Run: `npx vitest run tests/web/pick.test.ts`
Expected: FAIL, модуль `web/render/pick.ts` не найден.

- [ ] **Step 6: Реализовать**

Создать `web/render/pick.ts`:

```ts
/** Под точкой нет ни одного узла. */
export const NOTHING = -1;

/** Всё, что нужно знать о сцене, чтобы понять, куда показывает курсор. */
export interface PickInput {
  /** Рисуемая маска; индекс — идентификатор пути. */
  active: Uint8Array;
  /** Пары x, y в мировых координатах. */
  positions: Float32Array;
  radius: Float32Array;
}

/**
 * Узел под точкой мира или NOTHING.
 *
 * Прямое накрытие сильнее близости, а среди накрывающих выигрывает больший
 * идентификатор: отрисовка идёт по возрастанию идентификатора, поэтому узел с
 * большим номером лежит сверху, и целятся именно в него. Иначе клик по файлу
 * внутри крупного каталога открывал бы каталог — то есть попадал бы не туда,
 * куда смотрит пользователь.
 *
 * `slack` — допуск в мировых единицах: на отдалении радиус узла меньше
 * пикселя, и без допуска попасть в него мышью невозможно. Перевод из экранных
 * пикселей делает вызывающий (делением на масштаб камеры): о камере эта
 * функция не знает намеренно, иначе её нельзя было бы проверить без DOM.
 */
export function pickNode(input: PickInput, worldX: number, worldY: number, slack: number): number {
  let covered = NOTHING;
  let near = NOTHING;
  let nearGap = Infinity;

  for (let path = 0; path < input.active.length; path++) {
    if (input.active[path] !== 1) continue;
    const dx = input.positions[path * 2]! - worldX;
    const dy = input.positions[path * 2 + 1]! - worldY;
    const distance = Math.hypot(dx, dy);
    const radius = input.radius[path]!;
    if (distance <= radius) {
      // Просто перезаписываем: обход идёт по возрастанию, значит последний
      // накрывающий и есть верхний.
      covered = path;
      continue;
    }
    const gap = distance - radius;
    if (gap <= slack && gap <= nearGap) {
      near = path;
      nearGap = gap;
    }
  }

  return covered !== NOTHING ? covered : near;
}
```

- [ ] **Step 7: Убедиться, что тест проходит**

Run: `npx vitest run tests/web/pick.test.ts`
Expected: PASS.

- [ ] **Step 8: Коммит**

```bash
git add web/render/pick.ts tests/web/pick.test.ts
git commit -m "feat(render): pick the node under a world point"
```

---

### Task 2: Вторая ось цвета значков

**Files:**
- Modify: `web/render/avatar.ts`
- Test: `tests/web/avatar.test.ts`

**Interfaces:**
- Consumes: `computeSafeHues`, `SAFE_HUES` (уже есть в модуле).
- Produces: `avatarStyle(email, hues, lightness): { hue: number; lightness: number }`, `AVATAR_LIGHTNESS: readonly number[]`. `avatarColor(email): string` сохраняет сигнатуру.

Долг среза 4. Оттенков, безопасных относительно палитры узлов, всего 102, и при восьми авторах примерно в четверти случаев двое получают один цвет. Панель фильтров теперь показывает авторов списком, а инспектор (задача 4) поставит их цветные точки рядом друг с другом — совпадение станет заметно и начнёт мешать. Расширять полосу оттенков обратно нельзя: она сужена ровно затем, чтобы значок не сливался с узлами. Значит нужна вторая ось — светлота.

- [ ] **Step 1: Написать падающий тест**

Дописать в `tests/web/avatar.test.ts`:

```ts
import { AVATAR_LIGHTNESS, avatarStyle, computeSafeHues, HUE_MARGIN, avatarColor } from '../../web/render/avatar.js';
import { PALETTE } from '../../web/render/palette.js';

describe('вторая ось цвета значка', () => {
  const hues = computeSafeHues(PALETTE, HUE_MARGIN);
  const corpus = Array.from({ length: 300 }, (_, i) => `user${i}@example.com`);

  it('уровни светлоты различимы глазом', () => {
    // Уровни, отличающиеся на пару процентов, дали бы формально разные цвета
    // и ровно ту же путаницу: ось есть, толку нет.
    const sorted = [...AVATAR_LIGHTNESS].sort((a, b) => a - b);
    expect(sorted.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]! - sorted[i - 1]!).toBeGreaterThanOrEqual(8);
    }
    // И все читаются на тёмном фоне.
    for (const value of sorted) expect(value).toBeGreaterThanOrEqual(45);
  });

  it('различает больше авторов, чем один только оттенок', () => {
    const twoAxis = new Set(
      corpus.map((email) => {
        const style = avatarStyle(email, hues, AVATAR_LIGHTNESS);
        return `${style.hue}/${style.lightness}`;
      }),
    );
    const oneAxis = new Set(
      corpus.map((email) => `${avatarStyle(email, hues, [66]).hue}/66`),
    );
    expect(twoAxis.size).toBeGreaterThan(oneAxis.size);
  });

  it('оттенок остаётся безопасным относительно палитры узлов', () => {
    for (const email of corpus) {
      expect(hues).toContain(avatarStyle(email, hues, AVATAR_LIGHTNESS).hue);
    }
  });

  it('цвет по-прежнему выводится только из почты и не зависит от регистра', () => {
    expect(avatarColor(' Anya@E.com ')).toBe(avatarColor('anya@e.com'));
    expect(avatarColor('anya@e.com')).toMatch(/^hsl\(\d+ 70% \d+%\)$/);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run tests/web/avatar.test.ts`
Expected: FAIL, `avatarStyle` и `AVATAR_LIGHTNESS` не экспортируются.

- [ ] **Step 3: Реализовать**

В `web/render/avatar.ts` добавить и переписать `avatarColor`:

```ts
/**
 * Уровни светлоты значка — вторая ось цвета поверх оттенка. Безопасных
 * оттенков всего около сотни, и при восьми авторах примерно в четверти случаев
 * двое получали один цвет; в списке авторов и в карточке узла эти двое стоят
 * рядом, и различить их было нечем, кроме имени. Расширять полосу оттенков
 * обратно нельзя — она сужена затем, чтобы значок не сливался с узлами.
 *
 * Уровни разнесены заметно (а не на пару процентов) и все держатся светлой
 * половины: значок читается поверх тёмной сцены, а луч автора красится в тот
 * же цвет.
 */
export const AVATAR_LIGHTNESS: readonly number[] = [58, 70, 82];

/**
 * Оттенок и светлота значка. Палитра оттенков и набор уровней приходят
 * параметрами, а не берутся из модуля: так тест сравнивает одну ось с двумя,
 * не подменяя модуль.
 */
export function avatarStyle(
  email: string,
  hues: readonly number[],
  lightness: readonly number[],
): { hue: number; lightness: number } {
  const key = email.trim().toLowerCase();
  const total = hues.length * lightness.length;
  const index = hashString(key) % total;
  return { hue: hues[index % hues.length]!, lightness: lightness[Math.floor(index / hues.length)]! };
}

export function avatarColor(email: string): string {
  const style = avatarStyle(email, SAFE_HUES, AVATAR_LIGHTNESS);
  return `hsl(${style.hue} 70% ${style.lightness}%)`;
}
```

Старый докблок `avatarColor` про фиксированную светлоту заменить: светлота больше не фиксирована, и комментарий, обещающий обратное, хуже отсутствующего.

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npx vitest run tests/web/avatar.test.ts`
Expected: PASS, включая прежние тесты модуля.

- [ ] **Step 5: Коммит**

```bash
git add web/render/avatar.ts tests/web/avatar.test.ts
git commit -m "feat(render): add a lightness axis to avatar colors"
```

---

### Task 3: Описание узла на текущем курсоре

**Files:**
- Create: `web/state/node-info.ts`
- Test: `tests/web/node-info.test.ts`

**Interfaces:**
- Consumes: `Pack`, живая маска и размеры движка времени (`engine.alive`, `engine.sizes`), курсор.
- Produces:
  ```ts
  export interface Contributor { author: number; commits: number }
  export interface NodeInfo {
    path: number; fullPath: string; name: string; isDir: boolean; alive: boolean;
    lines: number; files: number; birthCommit: number; lastCommit: number;
    commits: number; contributors: Contributor[]; recentCommits: number[];
    sparkline: Uint32Array;
  }
  export function describeNode(pack, path, cursor, alive, sizes, options?): NodeInfo
  ```

**Одна область видимости на всю карточку: состояние на текущем курсоре.** Всё, что показывает карточка — размер, авторы, последние коммиты, спарклайн, — считается по событиям не позже курсора. Смешивать в одной карточке «сейчас» и «за всю историю» нельзя: пользователь читает её как срез момента, и столбик активности из будущего означал бы, что число строк тоже из будущего. Побочная выгода: во время воспроизведения карточка растёт вместе с историей.

**Каталог — это сумма поддерева.** У каталога своих событий не бывает: события пишутся на файлы. Поэтому для каталога описание собирается по всем файлам внутри. Принадлежность поддереву считается одним восходящим проходом (идентификатор родителя всегда меньше), а не рекурсией по детям.

**Коммит считается один раз.** Автор, тронувший в одном коммите десять файлов каталога, сделал один коммит, а не десять. Поэтому и топ авторов, и список последних коммитов выводятся из множества коммитов, задевших поддерево, а не из списка событий. Число событий отдельно не нужно никому, а вот спарклайн считает именно события — это объём изменений, та же величина, что и в гистограмме под слайдером.

- [ ] **Step 1: Написать падающий тест**

Создать `tests/web/node-info.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildPack } from '../../src/model/build.js';
import { TimeEngine } from '../../web/time/engine.js';
import { describeNode } from '../../web/state/node-info.js';

const add = (path: string, lines: number) => ({
  path,
  kind: 'add' as const,
  added: lines,
  deleted: 0,
  binary: false,
});
const modify = (path: string, added: number, deleted: number) => ({
  path,
  kind: 'modify' as const,
  added,
  deleted,
  binary: false,
});
const remove = (path: string) => ({
  path,
  kind: 'delete' as const,
  added: 0,
  deleted: 0,
  binary: false,
});

const pack = buildPack(
  [
    {
      hash: 'c0',
      authorName: 'Аня',
      authorEmail: 'anya@e.com',
      timestamp: 1000,
      subject: 'первый',
      changes: [add('src/a.ts', 10), add('src/b.ts', 5)],
    },
    {
      hash: 'c1',
      authorName: 'Бо',
      authorEmail: 'bo@e.com',
      timestamp: 2000,
      subject: 'второй',
      changes: [modify('src/a.ts', 3, 1), add('docs/c.md', 2)],
    },
    {
      hash: 'c2',
      authorName: 'Аня',
      authorEmail: 'anya@e.com',
      timestamp: 3000,
      subject: 'третий',
      changes: [remove('src/b.ts')],
    },
  ],
  { repoName: 'demo', head: 'c2' },
);

const id = (path: string): number => {
  const index = pack.paths.indexOf(path);
  if (index < 0) throw new Error(`нет пути ${path}`);
  return index;
};

/** Движок, перемотанный на указанный коммит. */
function at(cursor: number): TimeEngine {
  const engine = new TimeEngine(pack);
  engine.seek(cursor);
  return engine;
}

const info = (path: string, cursor: number, options = {}) => {
  const engine = at(cursor);
  return describeNode(pack, id(path), cursor, engine.alive, engine.sizes, options);
};

describe('describeNode', () => {
  it('описывает файл на текущем курсоре', () => {
    const first = info('src/a.ts', 0);
    expect(first.isDir).toBe(false);
    expect(first.alive).toBe(true);
    expect(first.name).toBe('a.ts');
    expect(first.fullPath).toBe('src/a.ts');
    expect(first.lines).toBe(10);
    expect(first.files).toBe(1);
    expect(first.birthCommit).toBe(0);
    expect(first.lastCommit).toBe(0);
    expect(first.commits).toBe(1);

    const second = info('src/a.ts', 1);
    expect(second.lines).toBe(12); // 10 + 3 - 1
    expect(second.lastCommit).toBe(1);
    expect(second.commits).toBe(2);
  });

  it('каталог суммирует живое поддерево', () => {
    const src = info('src', 1);
    expect(src.isDir).toBe(true);
    expect(src.lines).toBe(17); // a.ts 12 + b.ts 5
    expect(src.files).toBe(2);
    expect(src.commits).toBe(2); // c0 и c1 задели поддерево

    const afterDelete = info('src', 2);
    expect(afterDelete.lines).toBe(12);
    expect(afterDelete.files).toBe(1);
    expect(afterDelete.commits).toBe(3);
  });

  it('не заглядывает за курсор', () => {
    const early = info('docs/c.md', 0);
    expect(early.alive).toBe(false);
    expect(early.lines).toBe(0);
    expect(early.commits).toBe(0);
    expect(early.birthCommit).toBe(-1);
    expect(early.lastCommit).toBe(-1);
    expect(early.contributors).toEqual([]);
    expect(early.recentCommits).toEqual([]);
    expect([...early.sparkline].reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('до начала истории пусто у всего', () => {
    const root = info('', -1);
    expect(root.alive).toBe(false);
    expect(root.files).toBe(0);
    expect(root.commits).toBe(0);
  });

  it('считает автора по коммитам, а не по задетым файлам', () => {
    // Аня в c0 задела два файла внутри src — это один её коммит.
    const src = info('src', 1);
    expect(src.contributors).toEqual([
      { author: pack.authors.findIndex((a) => a.email === 'anya@e.com'), commits: 1 },
      { author: pack.authors.findIndex((a) => a.email === 'bo@e.com'), commits: 1 },
    ]);

    const later = info('src', 2);
    expect(later.contributors[0]).toEqual({
      author: pack.authors.findIndex((a) => a.email === 'anya@e.com'),
      commits: 2,
    });
  });

  it('последние коммиты идут свежими вперёд и не повторяются', () => {
    const src = info('src', 2);
    expect(src.recentCommits).toEqual([2, 1, 0]);
    expect(info('src', 2, { recent: 2 }).recentCommits).toEqual([2, 1]);
  });

  it('спарклайн лежит на оси индексов коммитов', () => {
    const sparkline = info('src', 2, { buckets: 3 }).sparkline;
    expect(sparkline.length).toBe(3);
    // c0 задел два файла src, c1 — один, c2 — один.
    expect([...sparkline]).toEqual([2, 1, 1]);
  });

  it('сохраняет историю удалённого файла', () => {
    const dead = info('src/b.ts', 2);
    expect(dead.alive).toBe(false);
    expect(dead.lines).toBe(0);
    expect(dead.files).toBe(0);
    expect(dead.birthCommit).toBe(0);
    expect(dead.lastCommit).toBe(2);
    expect(dead.commits).toBe(2);
  });

  it('корень называется именем репозитория', () => {
    expect(info('', 2).name).toBe('demo');
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run tests/web/node-info.test.ts`
Expected: FAIL, модуль `web/state/node-info.ts` не найден.

- [ ] **Step 3: Реализовать**

Создать `web/state/node-info.ts`:

```ts
import type { Pack } from '../../src/model/types.js';

export interface Contributor {
  author: number;
  /** Сколько коммитов этого автора задели узел или его поддерево. */
  commits: number;
}

export interface NodeInfo {
  path: number;
  fullPath: string;
  /** Имя без пути; у корня — имя репозитория. */
  name: string;
  isDir: boolean;
  alive: boolean;
  /** Строк сейчас: у каталога — сумма по живому поддереву. */
  lines: number;
  /** Живых файлов: у файла 1 или 0, у каталога — сколько внутри. */
  files: number;
  /** Индекс коммита, в котором путь впервые появился; -1, если ещё не появился. */
  birthCommit: number;
  /** Последний коммит не позже курсора, задевший узел; -1, если таких нет. */
  lastCommit: number;
  /** Сколько всего коммитов задели узел до курсора включительно. */
  commits: number;
  contributors: Contributor[];
  /** Индексы последних коммитов, свежие первыми. */
  recentCommits: number[];
  /** Объём изменений по корзинам оси индексов коммитов — той же, что у слайдера. */
  sparkline: Uint32Array;
}

export interface NodeInfoOptions {
  /** Сколько авторов оставить в топе. */
  contributors?: number;
  /**
   * Сколько последних коммитов перечислить. Не путать с полем `commits` в
   * NodeInfo: там их общее число, здесь — длина списка.
   */
  recent?: number;
  /** На сколько корзин делить ось истории. */
  buckets?: number;
}

/**
 * Всё, что карточка узла показывает про путь на текущем курсоре.
 *
 * Одна область видимости на всю карточку: и размер, и авторы, и коммиты, и
 * спарклайн считаются по событиям не позже курсора. Пользователь читает
 * карточку как срез момента, и столбик активности из будущего означал бы, что
 * и число строк оттуда же.
 *
 * У каталога своих событий не бывает — они пишутся на файлы, — поэтому
 * каталог описывается суммой поддерева. Принадлежность поддереву считается
 * одним восходящим проходом: идентификатор родителя всегда меньше
 * идентификатора потомка.
 *
 * Стоимость — O(числа путей + числа событий поддерева) на вызов. Это цена
 * клика и наведения, а не кадра: результат не пересобирается, пока
 * пользователь не выбрал другой узел или не сдвинул курсор.
 */
export function describeNode(
  pack: Pack,
  path: number,
  cursor: number,
  alive: Uint8Array,
  sizes: Int32Array,
  options: NodeInfoOptions = {},
): NodeInfo {
  const topContributors = options.contributors ?? 5;
  const recentLimit = options.recent ?? 5;
  const buckets = Math.max(1, options.buckets ?? 32);
  const { pathCount, commitCount } = pack.meta;

  const isDir = pack.pathIsDir[path] === 1;
  const fullPath = pack.paths[path] ?? '';
  const slash = fullPath.lastIndexOf('/');
  const name = fullPath === '' ? pack.meta.repoName : fullPath.slice(slash + 1);

  // Члены поддерева: сам путь и всё, что ниже. Один проход по возрастанию.
  const member = new Uint8Array(pathCount);
  member[path] = 1;
  for (let p = path + 1; p < pathCount; p++) {
    if (member[pack.pathParent[p]] === 1) member[p] = 1;
  }

  let lines = 0;
  let files = 0;
  let birthCommit = -1;
  let lastCommit = -1;
  const sparkline = new Uint32Array(buckets);
  /** Коммиты, задевшие поддерево: множество, потому что один коммит трогает много файлов. */
  const touchedCommits = new Set<number>();

  for (let p = path; p < pathCount; p++) {
    if (member[p] !== 1) continue;
    if (pack.pathIsDir[p] === 1) continue; // события и размеры есть только у файлов
    if (alive[p] === 1) {
      lines += sizes[p]!;
      files++;
    }
    for (let k = pack.pathEventStart[p]; k < pack.pathEventStart[p + 1]; k++) {
      const event = pack.pathEventIdx[k]!;
      const commit = pack.eventCommit[event]!;
      // События пути лежат по возрастанию коммита, поэтому дальше смотреть
      // незачем: всё остальное — будущее относительно курсора.
      if (commit > cursor) break;
      touchedCommits.add(commit);
      if (birthCommit === -1 || commit < birthCommit) birthCommit = commit;
      if (commit > lastCommit) lastCommit = commit;
      const bucket = Math.min(buckets - 1, Math.floor((commit / Math.max(1, commitCount)) * buckets));
      sparkline[bucket]++;
    }
  }

  const perAuthor = new Map<number, number>();
  for (const commit of touchedCommits) {
    const author = pack.commitAuthor[commit]!;
    perAuthor.set(author, (perAuthor.get(author) ?? 0) + 1);
  }
  const contributors = [...perAuthor.entries()]
    .map(([author, commits]) => ({ author, commits }))
    .sort((a, b) => b.commits - a.commits || a.author - b.author)
    .slice(0, Math.max(0, topContributors));

  const recentCommits = [...touchedCommits].sort((a, b) => b - a).slice(0, Math.max(0, recentLimit));

  return {
    path,
    fullPath,
    name,
    isDir,
    alive: alive[path] === 1,
    lines,
    files,
    birthCommit,
    lastCommit,
    commits: touchedCommits.size,
    contributors,
    recentCommits,
    sparkline,
  };
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npx vitest run tests/web/node-info.test.ts`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add web/state/node-info.ts tests/web/node-info.test.ts
git commit -m "feat(state): describe a node at the current cursor"
```

---

### Task 4: Карточка узла и клик по холсту

**Files:**
- Create: `web/ui/inspector.ts`
- Modify: `web/index.html`
- Modify: `web/main.ts`
- Test: `tests/web/inspector.test.ts`

**Interfaces:**
- Consumes: `NodeInfo` (Task 3), `pickNode` (Task 1), `avatarColor` (Task 2), `formatCommitLabel` из `web/ui/transport.js`, `drawHistogram` из `web/ui/histogram.js`.
- Produces: `mountInspector(root: HTMLElement, options: InspectorOptions): InspectorHandles`, где `InspectorHandles { show(info: NodeInfo): void; hide(): void; unmount(): void }` и `InspectorOptions { pack: Pack; onClose?(): void }`.

**Спарклайн рисует та же функция, что и гистограмму транспорта** (`drawHistogram`): это те же столбики того же смысла на той же оси. Второй рисовалки для того же самого в проекте быть не должно.

**Клик — это не перетаскивание.** Камера уже слушает `pointerdown`/`pointermove`/`pointerup` и на первом же движении отбирает автовписывание. Инспектор должен открываться только на клике без протяжки: запоминаем точку нажатия и открываем карточку, если указатель сдвинулся меньше чем на несколько пикселей. Иначе конец каждого панорамирования открывал бы случайную карточку.

**Панель справа занимает полосу так же, как левая.** Вписывание камеры уже вычитает полосу слева и снизу; открытая карточка обязана вычитаться справа, иначе повторится дефект среза 5a — часть дерева под панелью и достать её можно только ручным панорамированием, которое навсегда выключает автовписывание.

- [ ] **Step 1: Написать падающий тест**

Создать `tests/web/inspector.test.ts`:

```ts
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { buildPack } from '../../src/model/build.js';
import { describeNode } from '../../web/state/node-info.js';
import { TimeEngine } from '../../web/time/engine.js';
import { mountInspector } from '../../web/ui/inspector.js';

const change = (path: string, added: number) => ({
  path,
  kind: 'add' as const,
  added,
  deleted: 0,
  binary: false,
});

const pack = buildPack(
  [
    {
      hash: 'c0',
      authorName: 'Аня Петрова',
      authorEmail: 'anya@e.com',
      timestamp: 1700000000,
      subject: 'первый',
      changes: [change('src/a.ts', 10), change('src/b.ts', 4)],
    },
    {
      hash: 'c1',
      authorName: 'Бо Ли',
      authorEmail: 'bo@e.com',
      timestamp: 1700086400,
      subject: 'второй',
      changes: [change('docs/c.md', 2)],
    },
  ],
  { repoName: 'demo', head: 'c1' },
);

function infoFor(path: string) {
  const engine = new TimeEngine(pack);
  engine.seek(pack.meta.commitCount - 1);
  const id = pack.paths.indexOf(path);
  return describeNode(pack, id, engine.cursor, engine.alive, engine.sizes);
}

describe('карточка узла', () => {
  it('до выбора узла скрыта', () => {
    const root = document.createElement('aside');
    mountInspector(root, { pack });
    expect(root.hidden).toBe(true);
  });

  it('показывает путь, размер и авторов', () => {
    const root = document.createElement('aside');
    const handles = mountInspector(root, { pack });
    handles.show(infoFor('src/a.ts'));

    expect(root.hidden).toBe(false);
    expect(root.textContent).toContain('src/a.ts');
    expect(root.textContent).toContain('10');
    expect(root.textContent).toContain('Аня Петрова');
    // Автор, не касавшийся файла, в карточке не появляется.
    expect(root.textContent).not.toContain('Бо Ли');
    handles.unmount();
  });

  it('у каталога показывает число файлов', () => {
    const root = document.createElement('aside');
    const handles = mountInspector(root, { pack });
    handles.show(infoFor('src'));
    expect(root.textContent).toContain('файл');
    expect(root.textContent).toContain('14'); // 10 + 4 строк
    handles.unmount();
  });

  it('перерисовывается при показе другого узла, а не дописывается', () => {
    const root = document.createElement('aside');
    const handles = mountInspector(root, { pack });
    handles.show(infoFor('src/a.ts'));
    handles.show(infoFor('docs/c.md'));
    expect(root.textContent).toContain('docs/c.md');
    expect(root.textContent).not.toContain('src/a.ts');
    handles.unmount();
  });

  it('закрывается кнопкой и Escape, сообщая об этом наружу', () => {
    const root = document.createElement('aside');
    let closed = 0;
    const handles = mountInspector(root, { pack, onClose: () => closed++ });
    handles.show(infoFor('src/a.ts'));

    const button = root.querySelector('button');
    expect(button?.getAttribute('aria-label')).toBeTruthy();
    button!.click();
    expect(root.hidden).toBe(true);
    expect(closed).toBe(1);

    handles.show(infoFor('src/a.ts'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(root.hidden).toBe(true);
    expect(closed).toBe(2);
    handles.unmount();
  });

  it('unmount снимает обработчик Escape', () => {
    const root = document.createElement('aside');
    let closed = 0;
    const handles = mountInspector(root, { pack, onClose: () => closed++ });
    handles.show(infoFor('src/a.ts'));
    handles.unmount();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(closed).toBe(0);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run tests/web/inspector.test.ts`
Expected: FAIL, модуль `web/ui/inspector.ts` не найден.

- [ ] **Step 3: Реализовать панель**

Создать `web/ui/inspector.ts`. Требования к содержимому карточки:

- заголовок: имя узла (крупно) и полный путь (мелко, с переносом по словам — путь бывает длинным);
- строка сводки: `строк: N`, для каталога ещё `файлов: N`, а для мёртвого узла — пометка «удалён», иначе карточка мёртвого файла с нулём строк читается как ошибка;
- рождение: дата коммита `birthCommit`; последнее изменение: дата коммита `lastCommit`; оба — через `pack.commitTs`, в формате `YYYY-MM-DD`;
- топ авторов: цветная точка (`avatarColor(pack.authors[author].email)`), имя, число коммитов;
- спарклайн: `<canvas>` фиксированной высоты, отрисовка через `drawHistogram(canvas, info.sparkline)`;
- последние коммиты: `formatCommitLabel(pack, commit)` строкой на коммит;
- кнопка закрытия с `aria-label` (значок ✕ скринридер прочитал бы как символ) и обработчик `Escape` на документе, снимаемый в `unmount`.

Ключевые правила реализации:

```ts
export interface InspectorOptions {
  pack: Pack;
  onClose?(): void;
}

export interface InspectorHandles {
  /** Показывает карточку узла, полностью заменяя прежнее содержимое. */
  show(info: NodeInfo): void;
  hide(): void;
  unmount(): void;
}
```

- `show` собирает содержимое заново и кладёт его через `replaceChildren`: дописывание к прежнему дало бы карточку из двух узлов сразу.
- `hide` ставит `root.hidden = true` и **не** зовёт `onClose`: колбэк сообщает о намерении пользователя, а `hide` — это уже исполнение. Иначе точка входа, закрывая карточку в ответ на `onClose`, получила бы петлю (тот же урок, что и с `setVisibility` в панели фильтров).
- Обработчик `Escape` вешается на `document` один раз при монтировании и проверяет, что карточка открыта.
- Текст только через `textContent`; `innerHTML` не использовать нигде: в карточку попадают темы коммитов и пути из чужого репозитория.

- [ ] **Step 4: Убедиться, что тесты панели проходят**

Run: `npx vitest run tests/web/inspector.test.ts`
Expected: PASS.

- [ ] **Step 5: Разметка и стили**

В `web/index.html` добавить корень панели рядом с `#sidebar`:

```html
    <aside id="inspector" hidden></aside>
```

и стили в общий блок:

```css
      #inspector { position: fixed; right: 12px; top: 12px; width: 300px; max-height: 70vh;
        overflow: auto; padding: 10px 12px; background: #161b22e6;
        border: 1px solid #30363d; border-radius: 8px; }
      #inspector[hidden] { display: none; }
      #inspector h2 { margin: 0; font-size: 14px; }
      #inspector .path { color: #8b949e; overflow-wrap: anywhere; margin: 2px 0 8px; }
      #inspector .row { display: flex; align-items: center; gap: 6px; padding: 1px 0; }
      #inspector .dot { width: 10px; height: 10px; border-radius: 50%; flex: none; }
      #inspector canvas { width: 100%; height: 28px; display: block; margin: 6px 0; }
      #inspector .commit { color: #8b949e; overflow-wrap: anywhere; }
      #inspector .close { position: absolute; right: 8px; top: 6px; background: none;
        border: none; color: #8b949e; cursor: pointer; font: inherit; }
```

- [ ] **Step 6: Проводка в точке входа**

В `web/main.ts`:

1. Смонтировать панель: `const inspectorRoot = document.getElementById('inspector')`, `const inspector = inspectorRoot ? mountInspector(inspectorRoot, { pack, onClose: () => { selected = -1; } }) : null;`
2. Хранить выбранный путь `let selected = -1` и пересобирать карточку, когда меняется курсор или видимость: в конце `applyDelta`, если `selected >= 0`, звать `inspector.show(describeNode(...))`. Так карточка не устаревает во время воспроизведения.
3. Клик по холсту:

```ts
  /** Допуск попадания в экранных пикселях: на отдалении узел меньше пикселя. */
  const PICK_SLACK_PX = 6;
  /** Насколько указатель может сдвинуться, чтобы жест всё ещё считался кликом. */
  const CLICK_SLOP_PX = 4;

  let pressX = 0;
  let pressY = 0;
  canvas.addEventListener('pointerdown', (event) => {
    pressX = event.offsetX;
    pressY = event.offsetY;
  });
  canvas.addEventListener('click', (event) => {
    if (Math.hypot(event.offsetX - pressX, event.offsetY - pressY) > CLICK_SLOP_PX) return;
    const [wx, wy] = camera.toWorld(event.offsetX, event.offsetY);
    const path = pickNode(scene, wx, wy, PICK_SLACK_PX / camera.scale);
    if (path === NOTHING) {
      selected = -1;
      inspector?.hide();
      return;
    }
    selected = path;
    showSelected();
  });
```

4. `showSelected()` — одно место, где собирается карточка:

```ts
  function showSelected(): void {
    if (selected < 0 || !inspector) return;
    inspector.show(describeNode(pack, selected, engine.cursor, engine.alive, engine.sizes));
  }
```

5. Вычесть полосу справа во вписывании: рядом с `reservedLeft` завести `reservedRight` по той же схеме (`getBoundingClientRect().width` плюс отступ, ноль если панели нет или она скрыта), а в `followLayout` считать `width = Math.max(1, canvas.clientWidth - left - reservedRight())`. Смещать `x` вправо не нужно: `fit` центрирует облако в прямоугольнике `[left, left + width]`, и правая граница уже учтена шириной.
6. После `inspector.show`/`hide` полоса справа меняется — позвать `followLayout()`, иначе камера узнает о новой полосе только со следующим сообщением раскладки, которого может уже не быть.

- [ ] **Step 7: Проверка сборки и всего набора**

Run: `npx tsc --noEmit && npm run build && npx vitest run`
Expected: чисто, все тесты проходят.

- [ ] **Step 8: Коммит**

```bash
git add -A
git commit -m "feat(ui): node inspector opened by canvas click"
```

---

### Task 5: Поиск: обводка найденного и фокус камеры

**Files:**
- Create: `web/state/search.ts`
- Create: `web/ui/keys.ts`
- Modify: `web/ui/transport.ts` (забрать общий помощник из `keys.ts`)
- Modify: `web/render/camera.ts`
- Modify: `web/render/scene.ts`
- Modify: `web/ui/sidebar.ts`
- Modify: `web/main.ts`
- Test: `tests/web/search.test.ts`, `tests/web/camera.test.ts`, `tests/web/scene.test.ts`, `tests/web/sidebar.test.ts`

**Interfaces:**
- Consumes: `matchesGlob` из `web/state/glob.js` (тот же матчер, что у фильтра пути: два разных правила «что считается совпадением» в одном интерфейсе — гарантированная путаница), `HIDDEN` из `web/state/visibility.js`.
- Produces:
  ```ts
  export function computeHits(pack: Pack, query: string): Uint8Array
  export function projectHits(hits: Uint8Array, representative: Int32Array, drawn: Uint8Array): { drawnHits: Uint8Array; first: number; count: number }
  ```
  `Camera.focusOn(worldX, worldY, width, height, left?)`; `SceneInput.hit: Uint8Array`; `ownsTextInput(target: EventTarget | null): boolean` из `web/ui/keys.ts`; у панели — `onSearch(query)`, `onSearchSubmit(query)`, `SidebarHandles.setSearchCount(count, query)`, `SidebarHandles.focusSearch()`.

**Обводка живёт своей яркостью, а не яркостью узла.** Найденный файл в погашенной фильтром ветке обязан остаться погашенным — фильтр не отменяется поиском, — но обводка при этом должна быть видна, иначе поиск в отфильтрованном дереве не находит ничего видимого и выглядит сломанным. Поэтому заливка узла идёт с `alpha`, а кольцо — со своей постоянной яркостью. Это единственное место, где слой сознательно не умножается на альфу фильтра, и оно должно быть подписано комментарием.

**Камера уезжает по Enter, а не по каждой букве.** Спека требует фокус на первом совпадении; она не требует делать это на каждое нажатие клавиши. Камера, дёргающаяся на каждую букву, — это не помощь, а потеря контекста: пользователь ещё дописывает образец, а дерево уже уехало. Обводка обновляется инкрементально (это дёшево и информативно), а камера едет по Enter. Подсказать это надо в самом интерфейсе — иначе пользователь не догадается.

- [ ] **Step 1: Написать падающий тест поиска**

Создать `tests/web/search.test.ts`. Проверить:
- пустой и пробельный образец не даёт ни одного попадания (иначе при пустом поле обвелось бы всё дерево);
- образец без подстановочных знаков ищет подстроку без учёта регистра, со звёздочкой — по образцу (то же поведение, что у фильтра пути: берётся тот же матчер);
- попадания ставятся ровно на совпавшие пути и **не** поднимаются к родителям (в отличие от альфы фильтра);
- `projectHits` переносит попадание на представителя: файл внутри свёрнутой папки обводит папку;
- попадание в скрытом поддереве (`representative === HIDDEN`) исчезает и не считается;
- `first` — наименьший идентификатор среди обведённых (детерминированность: камера не должна прыгать в разные места при одном и том же образце), `-1`, если попаданий нет;
- `count` считает обведённые узлы, а не исходные совпадения: два файла внутри одной свёрнутой папки дают один обведённый узел.

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run tests/web/search.test.ts`
Expected: FAIL, модуля нет.

- [ ] **Step 3: Реализовать `web/state/search.ts`**

```ts
import type { Pack } from '../../src/model/types.js';
import { matchesGlob } from './glob.js';
import { HIDDEN } from './visibility.js';

/**
 * Маска совпадений по образцу. Матчер тот же, что у фильтра пути: два разных
 * правила «что считается совпадением» в одном интерфейсе — гарантированная
 * путаница, когда одна и та же строка в поле фильтра и в поле поиска находит
 * разное.
 *
 * Пустой образец не совпадает ни с чем — в отличие от фильтра, где пустая
 * строка означает «фильтра нет». Здесь наоборот: пустое поле поиска не должно
 * обводить всё дерево.
 */
export function computeHits(pack: Pack, query: string): Uint8Array {
  const hits = new Uint8Array(pack.meta.pathCount);
  const trimmed = query.trim();
  if (trimmed.length === 0) return hits;
  for (let path = 0; path < pack.meta.pathCount; path++) {
    // Наверх по дереву попадание не поднимается: обводка — точная метка
    // найденного, а не подсветка ветки. Ветку показывает яркость фильтра.
    if (matchesGlob(pack.paths[path]!, trimmed)) hits[path] = 1;
  }
  return hits;
}

/**
 * Переносит попадания на то, что действительно нарисовано: файл внутри
 * свёрнутой папки обводит папку, попадание в скрытом поддереве исчезает.
 * То же правило, по которому в срезе 5a разрешались лучи авторов.
 */
export function projectHits(
  hits: Uint8Array,
  representative: Int32Array,
  drawn: Uint8Array,
): { drawnHits: Uint8Array; first: number; count: number } {
  const drawnHits = new Uint8Array(hits.length);
  let first = -1;
  let count = 0;
  for (let path = 0; path < hits.length; path++) {
    if (hits[path] !== 1) continue;
    const target = representative[path]!;
    if (target === HIDDEN || drawn[target] !== 1) continue;
    if (drawnHits[target] === 1) continue;
    drawnHits[target] = 1;
    count++;
    // Первое совпадение — наименьший идентификатор, а не первое встреченное:
    // камера обязана ехать в одно и то же место при одном и том же образце.
    if (first === -1 || target < first) first = target;
  }
  return { drawnHits, first, count };
}
```

- [ ] **Step 4: Фокус камеры**

В `web/render/camera.ts` добавить:

```ts
  /**
   * Ставит точку мира в центр отведённого прямоугольника, не меняя масштаб:
   * поиск показывает, где лежит найденное, а не подменяет пользователю зум.
   * Отсчёт слева тот же, что у `fit`, — на полосу, занятую панелью.
   *
   * Считается вмешательством пользователя: он попросил показать конкретное
   * место, и автовписывание, сработав следующим сообщением раскладки, увезло
   * бы камеру обратно.
   */
  focusOn(worldX: number, worldY: number, width: number, height: number, left = 0): void {
    this.userControlled = true;
    this.x = left + width / 2 - worldX * this.scale;
    this.y = height / 2 - worldY * this.scale;
  }
```

Тесты в `tests/web/camera.test.ts`: точка попадает ровно в центр прямоугольника (с учётом левой полосы); масштаб не изменился; после `focusOn` `autoFit` возвращает false.

- [ ] **Step 5: Слой обводки в сцене**

В `web/render/scene.ts` добавить в `SceneInput`:

```ts
  /**
   * Найденное поиском; индекс — идентификатор пути. Отдельная ось от alpha:
   * фильтр гасит непопавшее, поиск обводит попавшее, и одно не отменяет
   * другого.
   */
  hit: Uint8Array;
```

и слой между узлами и лучами:

```ts
  // Кольцо рисуется своей яркостью, а не яркостью узла: это единственный слой,
  // который сознательно не умножается на альфу фильтра. Найденный файл в
  // погашенной ветке обязан остаться погашенным — фильтр поиском не
  // отменяется, — но если погасить и кольцо, поиск по отфильтрованному дереву
  // не найдёт ничего видимого.
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = '#f0f6fc';
  ctx.lineWidth = 2;
  for (let path = 0; path < input.active.length; path++) {
    if (input.active[path] === 0 || input.hit[path] !== 1) continue;
    const [sx, sy] = camera.toScreen(input.positions[path * 2]!, input.positions[path * 2 + 1]!);
    const r = flashRadius(input.radius[path]!, input.flash[path]!) * camera.scale + 3;
    if (sx + r < 0 || sy + r < 0 || sx - r > width || sy - r > height) continue;
    ctx.beginPath();
    ctx.arc(sx, sy, Math.max(2, r), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
```

Тест в `tests/web/scene.test.ts` (поддельным контекстом, как и остальные тесты файла): кольцо рисуется только у узлов с `hit === 1` и только у рисуемых; яркость кольца не падает вместе с `alpha` узла.

- [ ] **Step 6: Общий помощник горячих клавиш**

Создать `web/ui/keys.ts` и перенести туда `ownsSpaceKey` из `web/ui/transport.ts` под именем `ownsTextInput`, с прежним докблоком и с добавлением: тот же вопрос задают и `пробел` транспорта, и `/` поиска. `web/ui/transport.ts` начинает импортировать его оттуда — второй копии этого правила в проекте быть не должно (в прошлом срезе ровно такая копия `extensionOf` дошла до финального ревью).

- [ ] **Step 7: Секция поиска в панели**

В `web/ui/sidebar.ts`:
- секция «Поиск» первой в панели: подпись, поле ввода (`type="text"`, `aria-labelledby` на заголовок секции, как уже сделано у образца пути), под ним строка счётчика;
- на `input` — `options.onSearch(value)`; на `keydown` с `Enter` — `options.onSearchSubmit(value)`;
- подсказка про Enter в самом интерфейсе: `placeholder` вида `имя или образец` и строка счётчика, которая при непустом образце пишет `совпадений: N · Enter — показать первое`, при нуле — `ничего не найдено`, при пустом образце — пусто;
- глобальный обработчик `keydown` на документе: `/` без модификаторов и не в текстовом поле (`ownsTextInput`) — `preventDefault()` и фокус в поле поиска; снимается в `unmount`;
- в `SidebarHandles` добавить `setSearchCount(count: number, query: string): void` и `focusSearch(): void`.

Тесты в `tests/web/sidebar.test.ts`: ввод отдаёт образец наружу; Enter отдаёт его вторым колбэком; `setSearchCount` пишет обе формы строки; `/` из документа фокусирует поле, а `/` внутри поля ввода — нет.

- [ ] **Step 8: Проводка в точке входа**

В `web/main.ts`:
- `let searchQuery = ''` и `let searchHits = new Uint8Array(pathCount)` (маска по исходным путям, пересчитывается только при смене образца);
- `refreshHits()` — проекция на представителей и раздача результата: `scene.hit = projected.drawnHits`, `sidebar?.setSearchCount(projected.count, searchQuery)`. **Результат `mountSidebar` сейчас выбрасывается** — присвоить его (`const sidebar = sidebarRoot ? mountSidebar(...) : null`), иначе звать панель будет нечем, а `handles` в этом файле — ручки транспорта, а не панели; зовётся из `applyDelta` (представители меняются при смене видимости и курсора) и из обработчика поиска;
- `onSearchSubmit` — пересчитать и, если `first >= 0`, увести камеру: `camera.focusOn(scene.positions[first*2], scene.positions[first*2+1], width, height, left)`, где полосы берутся тем же кодом, что и в `followLayout` (вынести общий `viewBox()`, а не считать дважды);
- если совпадений нет — камеру не трогать вовсе.

- [ ] **Step 9: Проверка сборки и всего набора**

Run: `npx tsc --noEmit && npm run build && npx vitest run`
Expected: чисто, все тесты проходят.

- [ ] **Step 10: Коммит**

```bash
git add -A
git commit -m "feat(web): search that outlines matches and focuses the camera"
```

---

### Task 6: Подписи узлов и наведение

**Files:**
- Modify: `web/state/visibility.ts`
- Create: `web/render/labels.ts`
- Modify: `web/render/scene.ts`
- Modify: `web/main.ts`
- Test: `tests/web/visibility.test.ts`, `tests/web/labels.test.ts`, `tests/web/scene.test.ts`

**Interfaces:**
- Consumes: `pickNode` (Task 1), `hit`-маска (Task 5).
- Produces: `VisibilityResult.files: Int32Array`; `selectLabels(input, camera, width, height, options): number[]`; `labelFor(name: string, files: number): string`; `pluralFiles(count: number): string`; `SceneInput.labels: LabelLayer { count: number; path: Uint32Array; text: string[] }`.

Спека (§9) требует у свёрнутой папки подпись «имя папки · N файлов». Числа файлов на представителя сейчас нет: `resolveVisibility` считает только сумму строк. Считается оно тем же проходом.

- [ ] **Step 1: Счётчик файлов на представителя**

В `web/state/visibility.ts` добавить в `VisibilityResult`:

```ts
  /** Сколько живых файлов представляет узел: у свёрнутой папки — всё, что внутри. */
  files: Int32Array;
```

и в том же проходе, где копится `result[rep] += sizes[path]`, копить `files[rep] += pack.pathIsDir[path] === 1 ? 0 : 1`. Каталоги не считаются: пользователю нужно число файлов, а не число узлов, и «12 файлов» на папке, где их 7 плюс 5 подпапок, — это враньё.

Тесты в `tests/web/visibility.test.ts`: свёрнутая папка получает число живых файлов поддерева; подпапки в это число не входят; мёртвые файлы не входят; у обычного файла — 1; скрытое поддерево не даёт ничего никому.

- [ ] **Step 2: Написать падающий тест подписей**

Создать `tests/web/labels.test.ts`. Проверить:

`pluralFiles` — русские числительные, на трудных числах: 1 → `1 файл`, 2 → `2 файла`, 5 → `5 файлов`, 11 → `11 файлов`, 12/13/14 → `файлов`, 21 → `21 файл`, 22 → `22 файла`, 25 → `25 файлов`, 101 → `101 файл`, 111 → `111 файлов`, 114 → `114 файлов`, 0 → `0 файлов`.

`labelFor` — без счётчика (`files === 0`) даёт только имя; со счётчиком даёт `имя · N файлов`.

`selectLabels` — правило отбора:
- подписывается только рисуемый узел (`active === 1`);
- ушедший за край экрана (с полем в 40 px) не подписывается;
- крупный узел (экранный радиус ≥ `MIN_LABEL_RADIUS_PX`) подписывается сам по себе;
- мелкий — только если он наведён или найден поиском;
- погашенный фильтром (`alpha < 0.5`) не подписывается, **кроме** наведённого: на него пользователь показывает явно, и молчать в ответ нельзя;
- наведённый и найденные идут первыми, остальные — по убыванию экранного радиуса;
- длина результата не превышает `limit`.

Сигнатура (камера принимается структурно, чтобы тест не поднимал DOM):

```ts
export interface LabelInput {
  active: Uint8Array;
  positions: Float32Array;
  radius: Float32Array;
  alpha: Float32Array;
  hit: Uint8Array;
}
export interface LabelCamera {
  scale: number;
  toScreen(worldX: number, worldY: number): [number, number];
}
export interface LabelOptions {
  hovered?: number;
  limit?: number;
}
export function selectLabels(
  input: LabelInput,
  camera: LabelCamera,
  width: number,
  height: number,
  options?: LabelOptions,
): number[];
```

- [ ] **Step 3: Убедиться, что тест падает**

Run: `npx vitest run tests/web/labels.test.ts`
Expected: FAIL, модуля нет.

- [ ] **Step 4: Реализовать `web/render/labels.ts`**

Ключевое в реализации:

```ts
/** Начиная с какого экранного радиуса узел подписывается сам по себе. */
export const MIN_LABEL_RADIUS_PX = 9;
/** Сколько подписей рисуется в кадре: дальше они превращаются в кашу. */
export const DEFAULT_LABEL_LIMIT = 24;

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
```

`selectLabels` — один проход по маске с отбором по правилу выше, затем сортировка: наведённый первым, потом найденные, потом по убыванию экранного радиуса; `slice(0, limit)`.

- [ ] **Step 5: Слой подписей в сцене**

В `web/render/scene.ts` добавить:

```ts
/** Подписи узлов: параллельные массивы, длина значима до `count`. */
export interface LabelLayer {
  count: number;
  path: Uint32Array;
  text: string[];
}
```

в `SceneInput` — поле `labels: LabelLayer`, а в конец `drawScene` — слой подписей поверх всего (порядок слоёв из §11: рёбра → узлы → лучи → значки → подписи). Подпись ставится справа от узла со сдвигом на его экранный радиус плюс 4 px, шрифт `11px`, цвет `#c9d1d9`, яркость — яркость узла, но не ниже 0.5 (иначе подпись наведённого узла в погашенной ветке нечитаема). Обрезка по краю экрана — как у остальных слоёв.

Тест в `tests/web/scene.test.ts`: подпись рисуется для перечисленных в слое путей и только для них; текст берётся из слоя, а не собирается отрисовкой.

- [ ] **Step 6: Наведение и сборка подписей в точке входа**

В `web/main.ts`:
- `let hovered = -1`, `let pointerX = -1`, `let pointerY = -1`; обработчик `pointermove` на холсте только запоминает координаты, а подбор идёт **раз в кадр** в `frame()`: подбор — проход по всем путям, и вызывать его на каждое событие указателя незачем;
- курсор холста: `canvas.style.cursor = hovered >= 0 ? 'pointer' : 'default'` — меняется только при смене состояния, а не каждый кадр;
- уход указателя за пределы холста (`pointerleave`) сбрасывает наведение;
- сборка слоя: `selectLabels(...)` → для каждого пути `labelFor(basename(pack.paths[path]), visibilityFiles[path] > 1 && pack.pathIsDir[path] === 1 && collapsed ? visibilityFiles[path] : 0)`. Чтобы это не превратилось в выражение-загадку, завести локальную функцию `labelTextFor(path)`, где решение «показывать ли счётчик» принимается один раз: счётчик показывается, если путь — свёрнутая папка (то есть `pack.pathIsDir[path] === 1` и она есть в `visibilitySpec.collapsed`);
- `visibility.files` сохранять рядом с `scene.representative` в `applyDelta`.

- [ ] **Step 7: Проверка сборки и всего набора**

Run: `npx tsc --noEmit && npm run build && npx vitest run`
Expected: чисто, все тесты проходят.

- [ ] **Step 8: Коммит**

```bash
git add -A
git commit -m "feat(render): node labels, hover and collapsed folder counts"
```

---

### Task 7: Сквозной тест и живая проверка

**Files:**
- Create: `tests/helpers/canvas.ts`
- Modify: `tests/e2e/filtering.spec.ts` (забрать помощники из `canvas.ts`)
- Create: `tests/e2e/inspector-search.spec.ts`

**Interfaces:**
- Consumes: всё построенное в задачах 1–6 через собранное приложение.
- Produces: ничего для кода — только доказательство, что срез работает целиком.

- [ ] **Step 1: Вынести помощники замера яркости**

Перенести `brightness` и `stableBrightness` из `tests/e2e/filtering.spec.ts` в `tests/helpers/canvas.ts` вместе с их докблоками (объяснение, почему пауза не годится, стоит дороже самого кода) и импортировать в обоих сквозных тестах. Второй копии опроса стабилизации в проекте быть не должно.

- [ ] **Step 2: Написать сквозной тест**

Создать `tests/e2e/inspector-search.spec.ts`. Собственный таймаут — как в двух других сквозных тестах, с той же арифметикой в комментарии.

Сценарий на репозитории с известными файлами (`src/alpha.ts`, `src/beta.ts`, `docs/readme.md`, два автора):

1. Дождаться `data-ready` и стабилизации картинки.
2. Найти пиксель узла: `page.evaluate` проходит по `getImageData`, ищет непрозрачный пиксель правее панели фильтров и выше панели транспорта, возвращает его координаты в CSS-пикселях (`/ devicePixelRatio`). Если такого нет — тест обязан упасть с внятным сообщением, а не молча кликнуть в пустоту.
3. Кликнуть туда → `#inspector` виден, и его текст содержит путь (проверять по наличию имени одного из файлов репозитория или имени каталога — то есть по данным, а не по вёрстке).
4. `Escape` → `#inspector` скрыт.
5. Нажать `/` → фокус в поле поиска (`document.activeElement`); ввести `alpha` → строка счётчика показывает одно совпадение.
6. Снять снимок пикселей, нажать `Enter`, дождаться стабилизации, снять второй: они обязаны отличаться — камера уехала к найденному.
7. Ввести заведомо отсутствующий образец (`zzzz`) → `ничего не найдено`, и картинка не меняется: камера при нуле совпадений никуда не едет.

- [ ] **Step 3: Прогнать сквозные тесты**

Run: `npm run build && npx playwright test`
Expected: все проходят, включая прежние.

- [ ] **Step 4: Живая проверка**

Собрать и запустить на настоящем репозитории:

```bash
npm run build
```

Затем: `node dist/node/cli/main.js .`

Проверить и **честно описать в отчёте, включая неудачное**:
- клик по узлу открывает карточку с путём, размером, авторами, спарклайном и последними коммитами; клик по пустому месту закрывает; карточка не мешает дереву — оно вписывается левее её;
- во время воспроизведения карточка выбранного узла обновляется вместе с историей;
- клик по свёрнутой папке показывает карточку папки с числом файлов, а подпись на сцене — то же число;
- панорамирование мышью не открывает карточку;
- `/` попадает в поле поиска, обводка появляется по мере ввода, Enter увозит камеру к первому совпадению, поиск при активном фильтре не отменяет гашение;
- подписи появляются у крупных, наведённых и найденных узлов и не превращаются в кашу на общем плане;
- значки авторов различимы между собой.

- [ ] **Step 5: Коммит**

```bash
git add -A
git commit -m "test(e2e): inspector and search end to end"
```

---

## Что остаётся следующим планам

- **Срез 6:** `--export` статичного HTML, предупреждение о слишком большом репозитории, перф-бюджеты. Там же — записанные долги: перенос разницы в сцену стоит прохода по всему дереву на каждый коммит; `resolveVisibility` пересчитывает представителей, зависящих только от пакета и спеки; пакетные фильтры считают альфы полным проходом; сборка слоёв активности выделяет короткоживущие объекты. К ним добавляется свой долг этого плана: `describeNode` и `pickNode` — тоже полные проходы, но они платятся по клику, а не в кадре.
- **Не вошло из §12 и обосновано:** легенда расширений и переключатель режимов «воспроизведение / исследование». Панели открыты постоянно, камера уже отдаётся пользователю первым же жестом, и отдельный режим сейчас не даёт ничего, что нельзя было бы получить кнопкой паузы.
- **Вписывание камеры считает центры узлов без учёта радиусов** — крупный узел у края может частично уйти за экран. Полосы панелей слева и справа она уже учитывает.
- **Готовность холста не означает, что картинка устоялась:** камера въезжает в плотный ком новорождённых узлов и выезжает обратно 6–8 секунд. Это по-прежнему может читаться как непрошеный рывок на старте.

## Как построено (по итогам исполнения)

- **Подбор узла: прямое накрытие сильнее близости.** Среди накрывающих выигрывает
  нарисованный последним — отрисовка идёт по возрастанию идентификатора, значит
  сверху лежит файл, а не его каталог. Допуск нужен потому, что на отдалении
  радиус узла меньше пикселя; перевод из экранных пикселей делает вызывающий.
- **Вторая ось цвета значков выбрана расчётом, а не на глаз.** Первый вариант дал
  нижний уровень светлоты с запасом 0.04 над порогом читаемости; тест при этом
  сторожил разброс уровней, а не контраст. Порог заменён прямым расчётом по
  всем безопасным оттенкам — то же движение, которым в срезе 4 оттенки выводились
  из палитры узлов вместо числа в коде.
- **Карточка описывает состояние на курсоре целиком, включая спарклайн.** Коммит
  автора считается один раз, даже если он задел десять файлов внутри каталога.
- **Пересборка карточки отвязана от коммитов:** `applyDelta` только помечает её
  устаревшей, пересборка идёт в кадре не чаще раза в 250 мс. Иначе проход по всем
  путям платился бы на каждый шаг воспроизведения.
- **Обводка поиска — единственный слой, сознательно не умножаемый на альфу
  фильтра.** Найденный файл в погашенной ветке остаётся погашенным, но кольцо
  видно; иначе поиск по отфильтрованному дереву не находил бы ничего видимого.
- **Живость проверяется у самого пути, а не только у представителя.** Иначе
  совпадение в файле, которого на курсоре ещё нет, засчитывалось бы, если он
  лежит под свёрнутой папкой, и счётчик менял бы число от того, свёрнута ли она.
- **Размещённость узла подтверждает тот, кто расставлял узлы.** Признак «раскладка
  дала позицию» поднимался главным потоком по своей текущей маске, тогда как
  позиции посчитаны по маске воркера на момент отправки; догоняющее сообщение
  помечало новорождённый путь размещённым с координатами в нуле, и Enter уводил
  камеру в мировой ноль необратимо. Закрыто эпохой в протоколе.
- **Карточка закрывается, когда видимость убрала выбранный узел** — но не когда
  узел умер в истории: инспекция мёртвого пути осмысленна, и строки «удалён» и
  «рождение: —» должны быть достижимы.
- **Найденное подписывается, только пока совпадений немного.** При шести десятках
  совпадений подписи занимали весь лимит, схлопывались в нечитаемое пятно и
  вытесняли подписи крупных узлов: чем удачнее поиск, тем хуже видно результат.
  Обводка сама по себе решает задачу «где нашлось».
- **Окно устойчивости сквозного теста меряется временем, а не числом замеров.**
  Первая версия считала двенадцать отсчётов подряд; отсчёт занимает единицы
  миллисекунд, поэтому окно выходило в десятки миллисекунд — там, где величина
  сходится задолго до настоящего плато. Вторая версия выполняла условие лишь
  точным равенством, спасаемым квантованием часов; окончательная держит в окне
  один замер старше границы, и условие выполняется по построению.

### Хвосты, оставленные дальше

Записаны в §16.1 спецификации: радиусы во вписывании камеры, рывок камеры на
старте, ширина двух панелей на узком окне, порог отключения рёбер на дальнем
зуме, два безусловных прохода по путям в кадре, пересборка списков карточки
во время воспроизведения, ARIA для холста.
