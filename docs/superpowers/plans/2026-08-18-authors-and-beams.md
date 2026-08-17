# Авторы, лучи и вспышки — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Над деревом кода появляются контрибьюторы: значок с инициалами, луч к каждому файлу, которого автор коснулся в текущем коммите, и вспышка на самом файле.

**Architecture:** Кольцевой буфер держит события последних секунд с затуханием. Из него каждый кадр выводится всё остальное: вспышка узла, список лучей и цель для каждого автора. Авторы живут отдельным маленьким полем на главном потоке — пружина к центроиду задетых файлов плюс взаимное отталкивание; в воркер они не уходят, их единицы, а не тысячи.

**Tech Stack:** TypeScript (strict, ESM), Node 20+, Vite, vitest, happy-dom для тестов с DOM, Playwright.

**Spec:** [2026-08-17-gource-reborn-design.md](../specs/2026-08-17-gource-reborn-design.md) — срез 4 из раздела «Порядок реализации», требования в §7 и §11.

**Scope:** инспектор, фильтры-гашение и видимость поддеревьев — срез 5; экспорт и перф-бюджеты — срез 6.

## Global Constraints

- Node `>=20`. ESM, `"type": "module"`.
- **Все относительные импорты пишутся с расширением `.js`**, даже из `.ts`-файлов.
- TypeScript `strict: true`, `noUncheckedIndexedAccess` **выключен**.
- В `src/` — только `node:`-модули. Код в `web/` не зависит от `node:`.
- `Math.random()` запрещён: картинка должна воспроизводиться.
- Тексты для пользователя и комментарии — на русском; идентификаторы, имена файлов, сообщения коммитов — английские.
- Vitest без `globals`: явный `import { describe, it, expect } from 'vitest'`. Среда с DOM включается пофайлово докблоком `// @vitest-environment happy-dom`, не глобально.
- Массивы по узлам индексируются идентификатором пути, по авторам — идентификатором автора. Длины — `pack.meta.pathCount` и `pack.authors.length`.
- Любое время, приходящее снаружи (дельта кадра, момент события), может оказаться нечисловым. Проверяй на конечность до использования — это уже дважды ловилось ревью.
- Каждая задача заканчивается коммитом.

## File Structure

| Файл | Ответственность |
|---|---|
| `web/time/recent.ts` | Кольцевой буфер недавних событий с затуханием |
| `web/time/engine.ts` | Дополняется: синтетические события не попадают в `touched` |
| `web/render/avatar.ts` | Инициалы и цвет автора по имени и почте |
| `web/render/actors.ts` | Поле авторов: пружина к цели и взаимное отталкивание |
| `web/render/scene.ts` | Дополняется слоями вспышек, лучей и значков |
| `web/main.ts` | Сборка: буфер, поле авторов, счётчик в строке состояния |

---

### Task 1: Кольцевой буфер недавних событий

**Files:**
- Create: `web/time/recent.ts`
- Modify: `web/time/engine.ts`
- Test: `tests/web/recent.test.ts`, `tests/web/engine-step.test.ts` (дополняется)

**Interfaces:**
- Consumes: `FLAG_SYNTHETIC` из `src/model/types.js`
- Produces: `class RecentEvents` с конструктором `(capacity: number, lifetimeMs: number, authorCount: number)`, методами `push(path: number, author: number, atMs: number): void`, `forEach(nowMs: number, visit: (path: number, author: number, strength: number) => void): void`, `activeAuthors(nowMs: number): number`, `clear(): void`

- [ ] **Step 1: Написать падающий тест буфера**

`tests/web/recent.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { RecentEvents } from '../../web/time/recent.js';

/** Собирает всё, что буфер считает живым на момент now. */
function collect(buffer: RecentEvents, now: number) {
  const out: { path: number; author: number; strength: number }[] = [];
  buffer.forEach(now, (path, author, strength) => out.push({ path, author, strength }));
  return out;
}

describe('RecentEvents', () => {
  it('отдаёт свежее событие с полной силой', () => {
    const buffer = new RecentEvents(8, 1000, 4);
    buffer.push(5, 1, 0);
    expect(collect(buffer, 0)).toEqual([{ path: 5, author: 1, strength: 1 }]);
  });

  it('гасит событие линейно к концу жизни', () => {
    const buffer = new RecentEvents(8, 1000, 4);
    buffer.push(5, 1, 0);
    expect(collect(buffer, 250)[0]!.strength).toBeCloseTo(0.75, 5);
    expect(collect(buffer, 500)[0]!.strength).toBeCloseTo(0.5, 5);
  });

  it('забывает событие, когда его время вышло', () => {
    const buffer = new RecentEvents(8, 1000, 4);
    buffer.push(5, 1, 0);
    expect(collect(buffer, 1000)).toEqual([]);
    expect(collect(buffer, 5000)).toEqual([]);
  });

  it('держит несколько событий одного пути', () => {
    const buffer = new RecentEvents(8, 1000, 4);
    buffer.push(5, 1, 0);
    buffer.push(5, 2, 0);
    expect(collect(buffer, 0)).toHaveLength(2);
  });

  it('вытесняет самое старое при переполнении', () => {
    const buffer = new RecentEvents(2, 1000, 4);
    buffer.push(1, 0, 0);
    buffer.push(2, 0, 0);
    buffer.push(3, 0, 0);
    expect(collect(buffer, 0).map((e) => e.path)).toEqual([2, 3]);
  });

  it('считает авторов с живыми событиями, без повторов', () => {
    const buffer = new RecentEvents(8, 1000, 4);
    buffer.push(1, 0, 0);
    buffer.push(2, 0, 0);
    buffer.push(3, 1, 0);
    expect(buffer.activeAuthors(0)).toBe(2);
    expect(buffer.activeAuthors(1000)).toBe(0);
  });

  it('пересчитывает авторов заново на каждом вызове', () => {
    const buffer = new RecentEvents(8, 1000, 4);
    buffer.push(1, 0, 0);
    buffer.push(2, 1, 900);
    expect(buffer.activeAuthors(0)).toBe(1);
    expect(buffer.activeAuthors(950)).toBe(1);
    expect(buffer.activeAuthors(1950)).toBe(0);
  });

  it('очищается', () => {
    const buffer = new RecentEvents(8, 1000, 4);
    buffer.push(1, 0, 0);
    buffer.clear();
    expect(collect(buffer, 0)).toEqual([]);
    expect(buffer.activeAuthors(0)).toBe(0);
  });

  it('не портится от нечислового времени', () => {
    const buffer = new RecentEvents(8, 1000, 4);
    buffer.push(1, 0, Number.NaN);
    buffer.push(2, 0, 0);
    // Событие с негодным временем просто не заводится, соседнее живёт.
    expect(collect(buffer, 0).map((e) => e.path)).toEqual([2]);
    expect(collect(buffer, Number.NaN)).toEqual([]);
    expect(buffer.activeAuthors(Number.NaN)).toBe(0);
  });

  it('игнорирует автора вне диапазона', () => {
    const buffer = new RecentEvents(8, 1000, 2);
    buffer.push(1, 99, 0);
    expect(collect(buffer, 0)).toEqual([]);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run tests/web/recent.test.ts`
Expected: FAIL — не найден модуль `web/time/recent.js`.

- [ ] **Step 3: Реализовать буфер**

`web/time/recent.ts`:

```ts
/**
 * События последних секунд с затуханием — основа всего, что рисуется поверх
 * дерева: вспышки узлов, лучи и цели авторов выводятся из него покадрово.
 *
 * Ёмкость ограничена: первый коммит репозитория трогает тысячи файлов, и
 * держать их все ради полутора секунд свечения незачем. При переполнении
 * вытесняется самое старое событие — луч, который и так вот-вот погас бы.
 */
export class RecentEvents {
  private readonly path: Uint32Array;
  private readonly author: Uint32Array;
  private readonly at: Float64Array;
  /** Метка поколения на автора: заменяет Set при подсчёте активных. */
  private readonly seen: Uint32Array;
  private generation = 0;
  private head = 0;
  private size = 0;

  constructor(
    private readonly capacity: number,
    private readonly lifetimeMs: number,
    authorCount: number,
  ) {
    this.path = new Uint32Array(capacity);
    this.author = new Uint32Array(capacity);
    this.at = new Float64Array(capacity);
    this.seen = new Uint32Array(authorCount);
  }

  push(path: number, author: number, atMs: number): void {
    if (!Number.isFinite(atMs)) return;
    if (author < 0 || author >= this.seen.length) return;

    const slot = (this.head + this.size) % this.capacity;
    this.path[slot] = path;
    this.author[slot] = author;
    this.at[slot] = atMs;

    if (this.size < this.capacity) this.size++;
    else this.head = (this.head + 1) % this.capacity;
  }

  /** Сила — от 1 в момент события до 0 в конце его жизни. */
  forEach(nowMs: number, visit: (path: number, author: number, strength: number) => void): void {
    if (!Number.isFinite(nowMs)) return;
    for (let i = 0; i < this.size; i++) {
      const slot = (this.head + i) % this.capacity;
      const age = nowMs - this.at[slot];
      if (age < 0 || age >= this.lifetimeMs) continue;
      visit(this.path[slot], this.author[slot], 1 - age / this.lifetimeMs);
    }
  }

  /** Сколько авторов имеет хотя бы одно живое событие. */
  activeAuthors(nowMs: number): number {
    if (!Number.isFinite(nowMs)) return 0;
    this.generation++;
    let count = 0;
    for (let i = 0; i < this.size; i++) {
      const slot = (this.head + i) % this.capacity;
      const age = nowMs - this.at[slot];
      if (age < 0 || age >= this.lifetimeMs) continue;
      const author = this.author[slot];
      if (this.seen[author] === this.generation) continue;
      this.seen[author] = this.generation;
      count++;
    }
    return count;
  }

  clear(): void {
    this.head = 0;
    this.size = 0;
  }
}
```

- [ ] **Step 4: Написать падающий тест фильтрации синтетических событий**

Дописать в конец `tests/web/engine-step.test.ts`:

```ts
describe('TimeEngine.step и синтетические события', () => {
  it('не сообщает о путях, похороненных сверкой с деревом HEAD', () => {
    const pack = buildPack(
      [
        {
          hash: 'h0',
          authorName: 'A',
          authorEmail: 'a@e.com',
          timestamp: 1,
          subject: 'c0',
          changes: [
            { path: 'живой.txt', kind: 'add', added: 1, deleted: 0, binary: false },
            { path: 'потерянный.txt', kind: 'add', added: 1, deleted: 0, binary: false },
          ],
        },
        {
          hash: 'h1',
          authorName: 'A',
          authorEmail: 'a@e.com',
          timestamp: 2,
          subject: 'c1',
          changes: [{ path: 'живой.txt', kind: 'modify', added: 1, deleted: 0, binary: false }],
        },
      ],
      { repoName: 'd', head: 'h1', headFiles: new Set(['живой.txt']) },
    );

    const engine = new TimeEngine(pack);
    engine.step();
    const delta = engine.step();

    // Сверка дописала удаление «потерянного» последним коммитом: путь обязан
    // умереть, но автор этого коммита его не касался — луча быть не должно.
    expect([...delta.touched]).toEqual([pack.paths.indexOf('живой.txt')]);
    expect([...delta.removed]).toContain(pack.paths.indexOf('потерянный.txt'));
    expect(engine.alive[pack.paths.indexOf('потерянный.txt')]).toBe(0);
  });
});
```

- [ ] **Step 5: Запустить тест и убедиться, что он падает**

Run: `npx vitest run tests/web/engine-step.test.ts`
Expected: FAIL — в `touched` попал и «потерянный.txt».

- [ ] **Step 6: Отфильтровать синтетические события в движке**

`web/time/engine.ts` — добавить в импорт типов флаг:

```ts
import { FLAG_SYNTHETIC } from '../../src/model/types.js';
```

и в `step`, в цикле по событиям коммита, заменить блок накопления затронутых путей на:

```ts
      // Синтетические удаления дописаны сверкой с деревом HEAD, а не автором
      // коммита: на живость и размер они влияют, но лучей и вспышек давать не
      // должны — иначе последний коммит выстрелит по всем похороненным файлам.
      if ((pack.eventFlags[e] & FLAG_SYNTHETIC) === 0 && !touchedSeen.has(path)) {
        touchedSeen.add(path);
        touched.push(path);
      }
```

- [ ] **Step 7: Запустить тесты**

Run: `npx vitest run && npm run typecheck`
Expected: PASS, 10 новых тестов буфера и один новый тест движка зелёные вместе с остальными.

- [ ] **Step 8: Коммит**

```bash
git add -A
git commit -m "feat(time): recent event ring buffer, exclude synthetic events from touched"
```

---

### Task 2: Инициалы и цвет автора

**Files:**
- Create: `web/render/avatar.ts`
- Test: `tests/web/avatar.test.ts`

**Interfaces:**
- Consumes: ничего
- Produces: `initialsFor(name: string, email: string): string`; `avatarColor(email: string): string`

- [ ] **Step 1: Написать падающий тест**

`tests/web/avatar.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { avatarColor, initialsFor } from '../../web/render/avatar.js';

describe('initialsFor', () => {
  it('берёт по букве от имени и фамилии', () => {
    expect(initialsFor('Аня Петрова', 'a@e.com')).toBe('АП');
    expect(initialsFor('Ada Lovelace', 'a@e.com')).toBe('AL');
  });

  it('из одного слова берёт одну букву', () => {
    expect(initialsFor('Аня', 'a@e.com')).toBe('А');
  });

  it('не считает третье слово', () => {
    expect(initialsFor('Жан Батист Гренуй', 'a@e.com')).toBe('ЖБ');
  });

  it('переживает лишние пробелы и знаки', () => {
    expect(initialsFor('  анна-мария  ковач ', 'a@e.com')).toBe('АК');
  });

  it('падает на почту, если имени нет', () => {
    expect(initialsFor('', 'zoe@example.com')).toBe('Z');
    expect(initialsFor('   ', 'zoe@example.com')).toBe('Z');
  });

  it('даёт хоть что-то, когда нет ни имени, ни почты', () => {
    expect(initialsFor('', '')).toBe('?');
  });

  it('не ломается на имени из одних знаков', () => {
    expect(initialsFor('<>', 'q@e.com')).toBe('Q');
  });
});

describe('avatarColor', () => {
  it('устойчив: одна почта — один цвет', () => {
    expect(avatarColor('anya@example.com')).toBe(avatarColor('anya@example.com'));
  });

  it('не зависит от регистра и пробелов — как дедупликация авторов', () => {
    expect(avatarColor(' Anya@Example.COM ')).toBe(avatarColor('anya@example.com'));
  });

  it('разводит разные почты по разным цветам', () => {
    const emails = Array.from({ length: 24 }, (_, i) => `dev${i}@example.com`);
    const colors = new Set(emails.map(avatarColor));
    expect(colors.size).toBeGreaterThanOrEqual(18);
  });

  it('возвращает цвет, пригодный для кисти canvas', () => {
    expect(avatarColor('a@e.com')).toMatch(/^hsl\(/);
  });

  it('не падает на пустой почте', () => {
    expect(avatarColor('')).toMatch(/^hsl\(/);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run tests/web/avatar.test.ts`
Expected: FAIL — не найден модуль `web/render/avatar.js`.

- [ ] **Step 3: Реализовать**

`web/render/avatar.ts`:

```ts
/** Буквы и цифры любого алфавита: имена в истории бывают не только латиницей. */
const LETTER = /\p{L}|\p{N}/u;

function firstLetter(text: string): string {
  for (const char of text) {
    if (LETTER.test(char)) return char.toUpperCase();
  }
  return '';
}

/**
 * Одна-две буквы для значка автора. Имя может быть пустым или состоять из
 * знаков — тогда отступаем к почте, а если и её нет, показываем вопрос:
 * пустой кружок читался бы как ошибка отрисовки.
 */
export function initialsFor(name: string, email: string): string {
  const words = name.split(/[\s.,;:<>()"'|/\\-]+/u).filter((word) => LETTER.test(word));
  const letters = words.slice(0, 2).map(firstLetter).join('');
  if (letters.length > 0) return letters;

  const fromEmail = firstLetter(email);
  return fromEmail.length > 0 ? fromEmail : '?';
}

/**
 * Цвет значка выводится из почты, а не из имени: один человек пишет имя
 * по-разному, а почта — тот же ключ, по которому авторы дедуплицируются при
 * сборке пакета, и приводится он так же.
 *
 * Насыщенность и светлота фиксированы: значки должны читаться поверх тёмной
 * сцены и не сливаться с пастельной палитрой узлов.
 */
export function avatarColor(email: string): string {
  const key = email.trim().toLowerCase();
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  }
  const hue = (hash >>> 0) % 360;
  return `hsl(${hue} 70% 66%)`;
}
```

- [ ] **Step 4: Запустить тесты**

Run: `npx vitest run tests/web/avatar.test.ts && npm run typecheck`
Expected: PASS, 12 тестов.

- [ ] **Step 5: Коммит**

```bash
git add -A
git commit -m "feat(render): author initials and stable avatar color"
```

---

### Task 3: Поле авторов

**Files:**
- Create: `web/render/actors.ts`
- Test: `tests/web/actors.test.ts`

**Interfaces:**
- Consumes: ничего
- Produces: `ActorTarget { author: number; x: number; y: number }`; `class ActorField` с конструктором `(authorCount: number)`, полями `readonly positions: Float32Array` (пары x, y по идентификатору автора) и `readonly active: Uint8Array`, методом `update(dtSeconds: number, targets: readonly ActorTarget[]): void`

- [ ] **Step 1: Написать падающий тест**

`tests/web/actors.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ActorField, type ActorTarget } from '../../web/render/actors.js';

/** Прогоняет поле заданное число кадров по 1/60 секунды. */
function run(field: ActorField, targets: readonly ActorTarget[], frames: number): void {
  for (let i = 0; i < frames; i++) field.update(1 / 60, targets);
}

const at = (author: number, x: number, y: number): ActorTarget => ({ author, x, y });

describe('ActorField', () => {
  it('ставит нового автора сразу в его цель, без перелёта из ниоткуда', () => {
    const field = new ActorField(4);
    field.update(1 / 60, [at(2, 100, -50)]);
    expect(field.positions[4]).toBeCloseTo(100, 3);
    expect(field.positions[5]).toBeCloseTo(-50, 3);
    expect(field.active[2]).toBe(1);
  });

  it('подтягивает автора к сместившейся цели', () => {
    const field = new ActorField(4);
    field.update(1 / 60, [at(0, 0, 0)]);
    run(field, [at(0, 200, 0)], 240);
    expect(field.positions[0]).toBeGreaterThan(150);
    expect(field.positions[0]).toBeLessThan(250);
  });

  it('расталкивает двух авторов с одной целью', () => {
    const field = new ActorField(4);
    field.update(1 / 60, [at(0, 0, 0), at(1, 0, 0)]);
    run(field, [at(0, 0, 0), at(1, 0, 0)], 240);
    const dx = field.positions[0]! - field.positions[2]!;
    const dy = field.positions[1]! - field.positions[3]!;
    expect(Math.hypot(dx, dy)).toBeGreaterThan(10);
  });

  it('гасит активность автора, пропавшего из целей, но помнит место', () => {
    const field = new ActorField(4);
    field.update(1 / 60, [at(1, 30, 40)]);
    field.update(1 / 60, []);
    expect(field.active[1]).toBe(0);
    expect(field.positions[2]).toBeCloseTo(30, 3);
    expect(field.positions[3]).toBeCloseTo(40, 3);
  });

  it('возвращает пропавшего автора туда, где он стоял', () => {
    const field = new ActorField(4);
    field.update(1 / 60, [at(1, 30, 40)]);
    field.update(1 / 60, []);
    field.update(1 / 60, [at(1, 30, 40)]);
    expect(field.positions[2]).toBeCloseTo(30, 3);
  });

  it('переживает пустой список целей', () => {
    const field = new ActorField(2);
    field.update(1 / 60, []);
    expect([...field.active]).toEqual([0, 0]);
  });

  it('не взрывается от огромной дельты времени', () => {
    const field = new ActorField(2);
    field.update(1 / 60, [at(0, 0, 0)]);
    field.update(3600, [at(0, 500, 500)]);
    expect(Number.isFinite(field.positions[0])).toBe(true);
    expect(Number.isFinite(field.positions[1])).toBe(true);
  });

  it('не портится от нечисловой дельты времени', () => {
    const field = new ActorField(2);
    field.update(1 / 60, [at(0, 10, 10)]);
    field.update(Number.NaN, [at(0, 10, 10)]);
    expect(field.positions[0]).toBeCloseTo(10, 3);
  });

  it('игнорирует автора вне диапазона', () => {
    const field = new ActorField(2);
    field.update(1 / 60, [at(9, 10, 10)]);
    expect([...field.active]).toEqual([0, 0]);
  });

  it('детерминирован: два одинаковых прогона дают одно и то же', () => {
    const targets = [at(0, 10, 0), at(1, 10, 0), at(2, -10, 5)];
    const a = new ActorField(4);
    const b = new ActorField(4);
    run(a, targets, 120);
    run(b, targets, 120);
    expect([...a.positions]).toEqual([...b.positions]);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run tests/web/actors.test.ts`
Expected: FAIL — не найден модуль `web/render/actors.js`.

- [ ] **Step 3: Реализовать**

`web/render/actors.ts`:

```ts
export interface ActorTarget {
  author: number;
  x: number;
  y: number;
}

/** Жёсткость пружины к цели, в единицах «за секунду в квадрате». */
const STIFFNESS = 6;
/** Затухание скорости за секунду: без него автор бесконечно колеблется у цели. */
const DAMPING = 5;
/** Насколько сильно авторы расталкиваются и до какого расстояния это считается. */
const REPULSION = 12000;
const REPULSION_RANGE = 112;
/** Потолок дельты времени: свёрнутая вкладка не должна швырнуть авторов за экран. */
const MAX_STEP_SECONDS = 1 / 15;

/**
 * Авторы живут отдельно от force-раскладки узлов: их единицы, а не тысячи, и
 * гонять ради них воркер незачем. Каждый тянется к центроиду файлов, которых
 * коснулся, и слегка отталкивается от соседей, чтобы значки не слипались.
 */
export class ActorField {
  /** Пары x, y по идентификатору автора. */
  readonly positions: Float32Array;
  /** 1, если у автора есть цель в этом кадре. */
  readonly active: Uint8Array;

  private readonly velocity: Float32Array;
  /** Был ли автор хоть раз размещён: первое появление ставится сразу в цель. */
  private readonly placed: Uint8Array;

  constructor(authorCount: number) {
    this.positions = new Float32Array(authorCount * 2);
    this.active = new Uint8Array(authorCount);
    this.velocity = new Float32Array(authorCount * 2);
    this.placed = new Uint8Array(authorCount);
  }

  update(dtSeconds: number, targets: readonly ActorTarget[]): void {
    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return;
    const dt = Math.min(dtSeconds, MAX_STEP_SECONDS);

    this.active.fill(0);

    for (const target of targets) {
      const author = target.author;
      if (author < 0 || author >= this.active.length) continue;
      if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) continue;
      this.active[author] = 1;

      if (this.placed[author] === 0) {
        // Первое появление: ставим в цель, а не запускаем издалека — иначе
        // значок влетал бы в кадр из угла на каждом новом авторе.
        this.placed[author] = 1;
        this.positions[author * 2] = target.x;
        this.positions[author * 2 + 1] = target.y;
        this.velocity[author * 2] = 0;
        this.velocity[author * 2 + 1] = 0;
        continue;
      }

      const dx = target.x - this.positions[author * 2];
      const dy = target.y - this.positions[author * 2 + 1];
      this.velocity[author * 2] += dx * STIFFNESS * dt;
      this.velocity[author * 2 + 1] += dy * STIFFNESS * dt;
    }

    // Отталкивание между активными: их единицы, поэтому попарный обход дешевле
    // любого индекса.
    for (let a = 0; a < this.active.length; a++) {
      if (this.active[a] === 0) continue;
      for (let b = a + 1; b < this.active.length; b++) {
        if (this.active[b] === 0) continue;
        let dx = this.positions[a * 2] - this.positions[b * 2];
        let dy = this.positions[a * 2 + 1] - this.positions[b * 2 + 1];
        let distance = Math.hypot(dx, dy);
        if (distance < 1e-3) {
          // Строго совпавшие авторы: разводим по устойчивому направлению,
          // выведенному из их номеров, — случайность в проекте запрещена.
          dx = Math.cos(a * 2.399963 + b);
          dy = Math.sin(a * 2.399963 + b);
          distance = 1;
        }
        if (distance > REPULSION_RANGE) continue;
        const push = (REPULSION / (distance * distance + 1)) * dt;
        this.velocity[a * 2] += (dx / distance) * push;
        this.velocity[a * 2 + 1] += (dy / distance) * push;
        this.velocity[b * 2] -= (dx / distance) * push;
        this.velocity[b * 2 + 1] -= (dy / distance) * push;
      }
    }

    const damping = Math.max(0, 1 - DAMPING * dt);
    for (let author = 0; author < this.active.length; author++) {
      if (this.active[author] === 0) continue;
      this.velocity[author * 2] *= damping;
      this.velocity[author * 2 + 1] *= damping;
      this.positions[author * 2] += this.velocity[author * 2] * dt;
      this.positions[author * 2 + 1] += this.velocity[author * 2 + 1] * dt;
    }
  }
}
```

- [ ] **Step 4: Запустить тесты**

Run: `npx vitest run tests/web/actors.test.ts && npm run typecheck`
Expected: PASS, 10 тестов.

- [ ] **Step 5: Коммит**

```bash
git add -A
git commit -m "feat(render): actor field with spring targets and mutual repulsion"
```

---

### Task 4: Вспышки, лучи и значки — отрисовка и сборка

Отрисовка и заполнение слоёв — одна неделимая задача: новые поля `SceneInput`
объявляются в одном файле, а заполняются в другом, и по отдельности проект не
собрался бы. Разделение дало бы задачу, заканчивающуюся заведомо красной
типизацией, — это не результат, который можно принять или отклонить.

**Files:**
- Modify: `web/render/scene.ts`, `web/main.ts`, `web/boot.ts`
- Test: `tests/web/scene-layers.test.ts`, `tests/web/boot.test.ts` (правится), `tests/e2e/authors.spec.ts`

**Interfaces:**
- Consumes: `Camera`, `PALETTE`, `RecentEvents` (Task 1), `ActorField` и `ActorTarget` (Task 3), `avatarColor` и `initialsFor` (Task 2)
- Produces: `SceneInput` дополняется полями `flash: Float32Array` (по идентификатору пути), `beams: BeamLayer`, `actors: ActorLayer`; типы `BeamLayer { count: number; fromX: Float32Array; fromY: Float32Array; toPath: Uint32Array; author: Uint32Array; strength: Float32Array }` и `ActorLayer { positions: Float32Array; active: Uint8Array; color: string[]; initials: string[]; name: string[] }`; `flashRadius(radius: number, flash: number): number`; `beamControl(ax: number, ay: number, bx: number, by: number): [number, number]`

- [ ] **Step 1: Написать падающий тест чистых помощников**

`tests/web/scene-layers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { beamControl, flashRadius } from '../../web/render/scene.js';

describe('flashRadius', () => {
  it('без вспышки оставляет радиус как есть', () => {
    expect(flashRadius(10, 0)).toBe(10);
  });

  it('на полной вспышке заметно увеличивает узел', () => {
    expect(flashRadius(10, 1)).toBeGreaterThan(13);
    expect(flashRadius(10, 1)).toBeLessThan(20);
  });

  it('растёт монотонно по силе вспышки', () => {
    expect(flashRadius(10, 0.5)).toBeGreaterThan(flashRadius(10, 0.2));
  });

  it('не даёт отрицательного радиуса на мусорном входе', () => {
    expect(flashRadius(10, -5)).toBeGreaterThanOrEqual(0);
    expect(flashRadius(-3, 1)).toBeGreaterThanOrEqual(0);
  });
});

describe('beamControl', () => {
  it('уводит контрольную точку в сторону от прямой', () => {
    const [cx, cy] = beamControl(0, 0, 100, 0);
    expect(cx).toBeCloseTo(50, 3);
    expect(Math.abs(cy)).toBeGreaterThan(1);
  });

  it('на нулевой длине не даёт нечисловых координат', () => {
    const [cx, cy] = beamControl(7, 7, 7, 7);
    expect(Number.isFinite(cx)).toBe(true);
    expect(Number.isFinite(cy)).toBe(true);
  });

  it('изгиб растёт вместе с длиной луча', () => {
    const short = beamControl(0, 0, 20, 0)[1];
    const long = beamControl(0, 0, 400, 0)[1];
    expect(Math.abs(long)).toBeGreaterThan(Math.abs(short));
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run tests/web/scene-layers.test.ts`
Expected: FAIL — `flashRadius` не экспортируется.

- [ ] **Step 3: Дополнить типы сцены**

`web/render/scene.ts` — в интерфейс `SceneInput`, после поля `linkTarget`, добавить:

```ts
  /** Свечение узла от недавнего касания: 0 — нет, 1 — только что задет. */
  flash: Float32Array;
  beams: BeamLayer;
  actors: ActorLayer;
```

и перед `SceneInput` объявить:

```ts
/**
 * Лучи от авторов к задетым файлам. Параллельные массивы, а не объекты:
 * лучей бывает несколько сотен, и пересобирать их каждый кадр объектами
 * означало бы мусорить в горячем пути отрисовки.
 */
export interface BeamLayer {
  count: number;
  fromX: Float32Array;
  fromY: Float32Array;
  toPath: Uint32Array;
  author: Uint32Array;
  strength: Float32Array;
}

/** Значки авторов; всё индексируется идентификатором автора. */
export interface ActorLayer {
  positions: Float32Array;
  active: Uint8Array;
  color: string[];
  initials: string[];
  name: string[];
}
```

- [ ] **Step 4: Добавить чистые помощники**

`web/render/scene.ts` — после `paletteIndexForPath` добавить:

```ts
/** Насколько узел раздувается на вспышке. */
const FLASH_GROWTH = 0.6;
/** Доля длины луча, на которую он отводится в сторону от прямой. */
const BEAM_BOW = 0.18;

/** Радиус узла с учётом свечения от недавнего касания. */
export function flashRadius(radius: number, flash: number): number {
  const base = Math.max(0, radius);
  const strength = Math.min(1, Math.max(0, flash));
  return base * (1 + FLASH_GROWTH * strength);
}

/**
 * Контрольная точка квадратичной кривой луча. Прямая линия от автора к файлу
 * читается как ребро дерева; изгиб отделяет одно от другого.
 */
export function beamControl(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): [number, number] {
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const dx = bx - ax;
  const dy = by - ay;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return [mx, my];
  return [mx - (dy / length) * length * BEAM_BOW, my + (dx / length) * length * BEAM_BOW];
}
```

- [ ] **Step 5: Нарисовать новые слои**

`web/render/scene.ts` — в `drawScene` заменить цикл по узлам на версию со вспышкой и дописать после него слои лучей и значков:

```ts
  for (let path = 0; path < input.active.length; path++) {
    if (input.active[path] === 0) continue;
    const [sx, sy] = camera.toScreen(input.positions[path * 2]!, input.positions[path * 2 + 1]!);
    const flash = input.flash[path]!;
    const r = flashRadius(input.radius[path]!, flash) * camera.scale;
    // Отсечение: за границами вида рисовать нечего, а узлов десятки тысяч.
    if (sx + r < 0 || sy + r < 0 || sx - r > width || sy - r > height) continue;
    ctx.fillStyle = PALETTE[input.color[path]!]!;
    ctx.beginPath();
    ctx.arc(sx, sy, Math.max(0.5, r), 0, Math.PI * 2);
    ctx.fill();
    if (flash > 0) {
      // Подсветку кладём поверх цвета узла, а не подменяем его: так виден и
      // тип файла, и факт касания.
      ctx.globalAlpha = Math.min(1, flash) * 0.55;
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  ctx.lineWidth = 1.4;
  for (let i = 0; i < input.beams.count; i++) {
    const path = input.beams.toPath[i]!;
    if (input.active[path] === 0) continue;
    const [ax, ay] = camera.toScreen(input.beams.fromX[i]!, input.beams.fromY[i]!);
    const [bx, by] = camera.toScreen(input.positions[path * 2]!, input.positions[path * 2 + 1]!);
    const [cx, cy] = beamControl(ax, ay, bx, by);
    ctx.globalAlpha = Math.min(1, Math.max(0, input.beams.strength[i]!)) * 0.8;
    ctx.strokeStyle = input.actors.color[input.beams.author[i]!] ?? '#ffffff';
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo(cx, cy, bx, by);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Значки рисуются экранным размером, а не мировым: они должны читаться на
  // любом масштабе, иначе на отдалении от них останутся точки.
  ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let author = 0; author < input.actors.active.length; author++) {
    if (input.actors.active[author] === 0) continue;
    const [sx, sy] = camera.toScreen(
      input.actors.positions[author * 2]!,
      input.actors.positions[author * 2 + 1]!,
    );
    if (sx < -40 || sy < -40 || sx > width + 40 || sy > height + 40) continue;

    ctx.fillStyle = input.actors.color[author] ?? '#ffffff';
    ctx.beginPath();
    ctx.arc(sx, sy, 11, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#0b0d12';
    ctx.fillText(input.actors.initials[author] ?? '?', sx, sy + 0.5);

    ctx.textAlign = 'left';
    ctx.fillStyle = input.actors.color[author] ?? '#ffffff';
    ctx.fillText(input.actors.name[author] ?? '', sx + 15, sy + 0.5);
    ctx.textAlign = 'center';
  }
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
```

- [ ] **Step 6: Запустить тесты чистых помощников**

Run: `npx vitest run tests/web/scene-layers.test.ts`
Expected: PASS, 7 тестов. `typecheck` пока не запускай: `SceneInput` уже требует трёх новых полей, а заполнять их будет точка входа на следующих шагах.

- [ ] **Step 7: Написать падающий сквозной тест**

`tests/e2e/authors.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { makeRepo, cleanupRepos } from '../helpers/tmp-repo.js';

let cli: ChildProcess | null = null;

test.afterAll(async () => {
  cli?.kill('SIGTERM');
  await cleanupRepos();
});

function authorCount(text: string | null): number {
  const match = (text ?? '').match(/авторов: (\d+)/);
  return match ? Number(match[1]) : -1;
}

test('во время воспроизведения появляются авторы и гаснут после паузы', async ({ page }) => {
  const repo = await makeRepo([
    { message: 'первый', author: { name: 'Аня Петрова', email: 'anya@e.com' }, write: { 'a.txt': 'a\n' } },
    { message: 'второй', author: { name: 'Бо Ли', email: 'bo@e.com' }, write: { 'src/b.ts': 'b\n' } },
    { message: 'третий', author: { name: 'Аня Петрова', email: 'anya@e.com' }, write: { 'src/c.ts': 'c\n' } },
    { message: 'четвёртый', author: { name: 'Бо Ли', email: 'bo@e.com' }, write: { 'docs/d.md': 'd\n' } },
    { message: 'пятый', author: { name: 'Аня Петрова', email: 'anya@e.com' }, write: { 'e.md': 'e\n' } },
  ]);

  cli = spawn('node', ['dist/node/cli/main.js', repo, '--port', '0', '--no-open'], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });

  const url = await new Promise<string>((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error(`CLI не напечатал URL:\n${out}`)), 30_000);
    cli!.stdout!.on('data', (chunk: Buffer) => {
      out += chunk.toString();
      const match = out.match(/http:\/\/localhost:\d+/);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    });
  });

  await page.goto(url);
  await page.waitForSelector('canvas[data-ready="true"]');

  // В покое на HEAD авторов быть не должно: никто ничего только что не трогал.
  await expect
    .poll(async () => authorCount(await page.locator('#status').textContent()))
    .toBe(0);

  await page.locator('#track input').fill('-1');
  await page.locator('#transport button').click();

  await expect
    .poll(async () => authorCount(await page.locator('#status').textContent()), { timeout: 20_000 })
    .toBeGreaterThan(0);

  // Пауза и ожидание дольше жизни луча — авторы обязаны погаснуть сами.
  await page.locator('#transport button').click();
  await expect
    .poll(async () => authorCount(await page.locator('#status').textContent()), { timeout: 10_000 })
    .toBe(0);
});
```

- [ ] **Step 8: Собрать и убедиться, что тест падает**

Run: `npm run build && npx playwright test tests/e2e/authors.spec.ts`
Expected: FAIL — в строке состояния нет числа авторов.

- [ ] **Step 9: Отделить неизменную часть описания от счётчиков**

`web/boot.ts` — в `describePack` убрать из строки счётчик авторов, оставив имя репозитория, коммиты и файлы: число активных авторов теперь меняется покадрово и живёт рядом с числом узлов. Заменить возвращаемое выражение на:

```ts
  return (
    `${pack.meta.repoName} · ${plural(pack.meta.commitCount, 'коммит', 'коммита', 'коммитов')} · ` +
    `${plural(files, 'файл', 'файла', 'файлов')}`
  );
```

и поправить существующий тест `tests/web/boot.test.ts`, убрав из ожиданий проверку на «1 автор».

- [ ] **Step 10: Подключить всё в точке входа**

`web/main.ts` — добавить импорты:

```ts
import { RecentEvents } from './time/recent.js';
import { ActorField, type ActorTarget } from './render/actors.js';
import { avatarColor, initialsFor } from './render/avatar.js';
import type { ActorLayer, BeamLayer } from './render/scene.js';
```

После объявления `color` и до объявления `scene` добавить подготовку слоёв:

```ts
  /** Сколько миллисекунд живёт луч и вспышка. */
  const ACTIVITY_MS = 1200;
  /** Потолок числа одновременно светящихся событий: первый коммит трогает всё. */
  const ACTIVITY_CAPACITY = 512;

  const authorCount = pack.authors.length;
  const recent = new RecentEvents(ACTIVITY_CAPACITY, ACTIVITY_MS, authorCount);
  const actorField = new ActorField(authorCount);

  const actors: ActorLayer = {
    positions: actorField.positions,
    active: actorField.active,
    color: pack.authors.map((author) => avatarColor(author.email)),
    initials: pack.authors.map((author) => initialsFor(author.name, author.email)),
    name: pack.authors.map((author) => author.name),
  };

  const beams: BeamLayer = {
    count: 0,
    fromX: new Float32Array(ACTIVITY_CAPACITY),
    fromY: new Float32Array(ACTIVITY_CAPACITY),
    toPath: new Uint32Array(ACTIVITY_CAPACITY),
    author: new Uint32Array(ACTIVITY_CAPACITY),
    strength: new Float32Array(ACTIVITY_CAPACITY),
  };

  const flash = new Float32Array(pathCount);
  /** Пути, которым в прошлом кадре ставили свечение: гасим только их. */
  let litPaths: number[] = [];

  // Копилки центроидов заводятся один раз: выделять их на каждом кадре значило
  // бы мусорить шестьдесят раз в секунду ради нескольких чисел.
  const centroidX = new Float64Array(authorCount);
  const centroidY = new Float64Array(authorCount);
  const centroidHits = new Uint32Array(authorCount);
```

В литерал `scene` дописать три поля:

```ts
    flash,
    beams,
    actors,
```

В `applyDelta`, перед блоком обновления строки состояния, добавить регистрацию событий:

```ts
    // Лучи заводятся только на шаге воспроизведения. Перемотка приходит с
    // full = true, и вспыхивать на ней нечему: пользователь не смотрит, как
    // работали авторы, он ищет место в истории.
    if (!full && engine.cursor >= 0) {
      const author = pack.commitAuthor[engine.cursor]!;
      const now = performance.now();
      for (const path of delta.touched) recent.push(path, author, now);
    }
```

Заменить блок обновления строки состояния на версию со счётчиком авторов:

```ts
    if (status) {
      // Описание репозитория за сессию не меняется и посчитано один раз выше:
      // на шаге воспроизведения остаётся только пересчитать живые узлы.
      let live = 0;
      for (let path = 0; path < pathCount; path++) if (scene.active[path] === 1) live++;
      liveNodes = live;
      renderStatus();
    }
```

и объявить рядом с `packDescription`:

```ts
  let liveNodes = 0;
  let shownAuthors = -1;

  function renderStatus(): void {
    if (!status) return;
    status.textContent = `${packDescription} · узлов: ${liveNodes} · авторов: ${shownAuthors < 0 ? 0 : shownAuthors}`;
  }
```

- [ ] **Step 11: Считать слои каждый кадр**

`web/main.ts` — заменить функцию `frame` на версию, пересобирающую свечение, лучи и цели авторов:

```ts
  let lastFrameMs = performance.now();
  const frame = (nowMs: number) => {
    const dt = (nowMs - lastFrameMs) / 1000;
    lastFrameMs = nowMs;
    try {
      if (playback.advance(dt) > 0) syncTransport();

      // Гасим только то, что светилось в прошлом кадре: полный проход по всем
      // путям на каждом кадре был бы дороже самой отрисовки лучей.
      for (const path of litPaths) flash[path] = 0;
      litPaths = [];

      beams.count = 0;
      centroidX.fill(0);
      centroidY.fill(0);
      centroidHits.fill(0);

      recent.forEach(nowMs, (path, author, strength) => {
        if (scene.active[path] !== 1) return;
        if (flash[path] < strength) {
          if (flash[path] === 0) litPaths.push(path);
          flash[path] = strength;
        }
        centroidX[author] += scene.positions[path * 2]!;
        centroidY[author] += scene.positions[path * 2 + 1]!;
        centroidHits[author]++;

        if (beams.count < beams.toPath.length) {
          const i = beams.count++;
          beams.toPath[i] = path;
          beams.author[i] = author;
          beams.strength[i] = strength;
        }
      });

      const targets: ActorTarget[] = [];
      for (let author = 0; author < authorCount; author++) {
        const count = centroidHits[author]!;
        if (count === 0) continue;
        targets.push({ author, x: centroidX[author]! / count, y: centroidY[author]! / count });
      }
      actorField.update(dt, targets);

      // Начало луча — там, где значок оказался после этого шага поля.
      for (let i = 0; i < beams.count; i++) {
        const author = beams.author[i]!;
        beams.fromX[i] = actorField.positions[author * 2]!;
        beams.fromY[i] = actorField.positions[author * 2 + 1]!;
      }

      const authorsNow = recent.activeAuthors(nowMs);
      if (authorsNow !== shownAuthors) {
        shownAuthors = authorsNow;
        renderStatus();
      }

      drawScene(ctx, camera, scene, canvas.clientWidth, canvas.clientHeight);
    } catch (error) {
      showFatal(
        `Не удалось отрисовать кадр: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    requestAnimationFrame(frame);
  };
```

- [ ] **Step 12: Прогнать всё**

Run: `npx vitest run && npm run typecheck && npm run build && npx playwright test`
Expected: PASS во всех четырёх, включая новый сквозной тест и три прежних.

- [ ] **Step 13: Проверить вживую**

Run: `node dist/node/cli/main.js .`
Expected: перемотать в начало, запустить воспроизведение. Над деревом появляются кружки с инициалами авторов и их именами; от кружка к каждому задетому файлу идёт изогнутый луч цвета автора; задетый файл на мгновение вспыхивает и увеличивается. При паузе лучи гаснут за секунду с небольшим, значки исчезают, счётчик авторов в строке состояния возвращается к нулю. Значки не слипаются, когда двое правят один каталог. Перемотка слайдером лучей не порождает. Остановить `Ctrl+C`.

- [ ] **Step 14: Коммит**

```bash
git add -A
git commit -m "feat(web): wire authors, beams and flashes into the scene"
```

---

## Что остаётся следующим планам

- Срез 5: инспектор узла, фильтры-гашение, поиск, видимость поддеревьев. Там же — маска видимости, из-за которой хранилищу узлов придётся разворачивать маску структурно, и вписывание камеры с учётом радиусов.
- Срез 6: `--export`, предупреждение о слишком большом репозитории, перф-бюджеты и снятие долга по стоимости переноса разницы в сцену.
