# Время и воспроизведение — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дерево кода растёт во времени: узлы входят в симуляцию при создании файла и выходят при удалении, есть воспроизведение с паузой, скоростью и перемоткой слайдером.

**Architecture:** Движок времени держит живое множество путей и их размеры, умеет дешёвый шаг на один коммит и полный пересчёт при перемотке. Все массивы индексируются идентификатором пути, а не плотным номером узла, — иначе позиции теряются при каждом изменении состава. Воркер получает не полную переинициализацию, а diff узлов, и помнит позиции удалённых, чтобы вернувшийся файл всплыл там же.

**Tech Stack:** TypeScript (strict, ESM), Node 20+, Vite, d3-force, vitest, Playwright.

**Spec:** [2026-08-17-gource-reborn-design.md](../specs/2026-08-17-gource-reborn-design.md) — этот план реализует срез 3 из раздела «Порядок реализации» и закрывает долг по `--no-merges` из §5.

**Scope:** авторы с лучами и вспышками (срез 4), инспектор, фильтры и видимость поддеревьев (срез 5), экспорт и перф-бюджеты (срез 6) сюда не входят.

## Global Constraints

- Node `>=20`. `package.json` содержит `"type": "module"`.
- **Все относительные импорты пишутся с расширением `.js`**, даже из `.ts`-файлов.
- TypeScript `strict: true`, `noUncheckedIndexedAccess` **выключен**.
- В `src/` запрещены runtime-зависимости: только `node:`-модули. `d3-force` только в web-бандле.
- Код в `web/` попадает в браузерный бандл: никаких зависимостей от `node:`.
- Тексты для пользователя и комментарии — на русском; идентификаторы, имена файлов, сообщения коммитов — английские.
- Vitest без `globals`: в каждом тесте явный `import { describe, it, expect } from 'vitest'`.
- Каждая задача заканчивается коммитом.
- **Все массивы по узлам индексируются идентификатором пути** (`pathId`), а не плотным номером. Длина — `pack.meta.pathCount`. Живость передаётся отдельной маской `active: Uint8Array`.
- Индекс пути `0` — корень репозитория. Идентификатор родителя всегда меньше идентификатора потомка — на этом инварианте построен пересчёт живости за один проход.
- Курсор времени — индекс коммита. Значение `-1` означает «до начала истории», когда не живо ничего.
- Порядок времён коммитов немонотонен (даты автора против порядка по датам коммита). Ничто не должно опираться на возрастание `commitTs`.

## Решение по панелям

Спека §12 называет Preact для панелей. Транспорт этого среза — пять элементов управления, и тянуть ради них фреймворк преждевременно, поэтому здесь обычный DOM с узким интерфейсом монтирования. Решение пересмотреть в срезе 5, когда появится инспектор с реактивным содержимым: там Preact окупится, и транспорт переедет вместе с остальными панелями.

## File Structure

| Файл | Ответственность |
|---|---|
| `src/git/tree.ts` | Список файлов в дереве HEAD |
| `src/model/build.ts` | Дополняется сверкой с деревом HEAD |
| `src/cli/main.ts` | Передаёт список файлов HEAD в сборку |
| `web/time/engine.ts` | Живое множество и размеры на курсоре; `seek` и `step` |
| `web/time/playback.ts` | Воспроизведение: пауза, скорость, накопитель шагов |
| `web/layout/graph.ts` | Активные рёбра и радиусы (переписывается под индексацию по пути) |
| `web/layout/protocol.ts` | Протокол воркера: `init` и `update` вместо полной переинициализации |
| `web/layout/worker.ts` | Симуляция с постоянной картой узлов и памятью позиций |
| `web/render/scene.ts` | Отрисовка с маской активности |
| `web/render/camera.ts` | Дополняется вписыванием по активным узлам |
| `web/ui/transport.ts` | Панель транспорта: play/pause, скорость, слайдер, подпись |
| `web/ui/histogram.ts` | Гистограмма активности под слайдером |
| `web/index.html` | Разметка транспорта и стили |
| `web/main.ts` | Сборка движка времени, воркера, рендера и транспорта |

---

### Task 1: Сверка живого множества с деревом HEAD

Закрывает долг из спеки §5. При `--no-merges` удаление, записанное только в коммите слияния, теряется: файл, удалённый на одной ветке и изменённый на другой, остаётся в модели живым, хотя в дереве HEAD его нет.

**Files:**
- Create: `src/git/tree.ts`
- Modify: `src/model/build.ts`, `src/cli/main.ts`
- Test: `tests/model/head-reconcile.test.ts`

**Interfaces:**
- Consumes: `RepoError` из `src/git/repo.js`; `buildPack(commits, opts)` из `src/model/build.js`; `PathTable`; `KIND_DELETE`
- Produces: `listHeadFiles(root: string): Promise<Set<string>>`; `BuildOptions` получает необязательное поле `headFiles?: ReadonlySet<string>`

- [ ] **Step 1: Написать падающий тест**

`tests/model/head-reconcile.test.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { buildPack } from '../../src/model/build.js';
import { listHeadFiles } from '../../src/git/tree.js';
import { streamCommits } from '../../src/git/log-stream.js';
import { ALIVE } from '../../src/model/history.js';
import type { RawCommit } from '../../src/git/types.js';

const run = promisify(execFile);
const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

/**
 * Репозиторий с расхождением: b.txt удалён на main, затем изменён на ветке,
 * слияние разрешено в пользу удаления. Удаление записано только в коммите
 * слияния, который --no-merges не видит.
 */
async function makeDivergentRepo(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'gr-merge-')));
  dirs.push(root);
  let stamp = 1_700_000_000;
  const git = (args: string[]) =>
    run('git', args, {
      cwd: root,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Fixture',
        GIT_AUTHOR_EMAIL: 'f@e.com',
        GIT_COMMITTER_NAME: 'Fixture',
        GIT_COMMITTER_EMAIL: 'f@e.com',
        GIT_AUTHOR_DATE: `${(stamp += 100)} +0000`,
        GIT_COMMITTER_DATE: `${stamp} +0000`,
      },
    });
  const write = async (path: string, text: string) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  };

  await git(['init', '-q', '-b', 'main']);
  await write('a.txt', 'a\n');
  await write('b.txt', 'b\n');
  await git(['add', '-A']);
  await git(['commit', '-q', '-m', 'первый']);

  await git(['checkout', '-q', '-b', 'feature']);
  await git(['checkout', '-q', 'main']);
  await git(['rm', '-q', 'b.txt']);
  await git(['commit', '-q', '-m', 'удалил b на main']);

  await git(['checkout', '-q', 'feature']);
  await write('b.txt', 'b\nb2\n');
  await git(['add', '-A']);
  await git(['commit', '-q', '-m', 'правил b на ветке']);

  await git(['checkout', '-q', 'main']);
  // Конфликт «изменён против удалён» — разрешаем в пользу удаления.
  await git(['merge', '--no-commit', '--no-ff', 'feature']).catch(() => undefined);
  await git(['rm', '-q', '-f', 'b.txt']).catch(() => undefined);
  await git(['commit', '-q', '-m', 'слияние: оставил удаление']);
  return root;
}

async function collect(root: string): Promise<RawCommit[]> {
  const out: RawCommit[] = [];
  for await (const commit of streamCommits(root)) out.push(commit);
  return out;
}

describe('сверка с деревом HEAD', () => {
  it('без сверки путь остаётся живым, хотя в HEAD его нет', async () => {
    const root = await makeDivergentRepo();
    const pack = buildPack(await collect(root), { repoName: 'demo', head: 'head' });
    const b = pack.paths.indexOf('b.txt');
    expect(b).toBeGreaterThan(0);
    const last = pack.lifetimeStart[b + 1] - 1;
    expect(pack.lifetimeDeath[last]).toBe(ALIVE);
  });

  it('со сверкой путь закрывается на последнем коммите', async () => {
    const root = await makeDivergentRepo();
    const headFiles = await listHeadFiles(root);
    expect(headFiles.has('a.txt')).toBe(true);
    expect(headFiles.has('b.txt')).toBe(false);

    const pack = buildPack(await collect(root), {
      repoName: 'demo',
      head: 'head',
      headFiles,
    });
    const b = pack.paths.indexOf('b.txt');
    const last = pack.lifetimeStart[b + 1] - 1;
    expect(pack.lifetimeDeath[last]).toBe(pack.meta.commitCount - 1);

    const a = pack.paths.indexOf('a.txt');
    const aLast = pack.lifetimeStart[a + 1] - 1;
    expect(pack.lifetimeDeath[aLast]).toBe(ALIVE);
  });

  it('пустая история не ломается сверкой', () => {
    const pack = buildPack([], { repoName: 'x', head: '0', headFiles: new Set(['a.txt']) });
    expect(pack.meta.commitCount).toBe(0);
    expect(pack.eventPath.length).toBe(0);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run tests/model/head-reconcile.test.ts`
Expected: FAIL — не найден модуль `src/git/tree.js`.

- [ ] **Step 3: Реализовать чтение дерева HEAD**

`src/git/tree.ts`:

```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { RepoError } from './repo.js';

const run = promisify(execFile);

/**
 * Пути всех файлов в дереве HEAD. Нужны для сверки: при `--no-merges`
 * удаление, записанное только в коммите слияния, до модели не доходит,
 * и файл остаётся живым, хотя в рабочем дереве его давно нет.
 */
export async function listHeadFiles(root: string): Promise<Set<string>> {
  try {
    const { stdout } = await run(
      'git',
      ['-c', 'core.quotepath=false', 'ls-tree', '-r', '--name-only', 'HEAD'],
      { cwd: root, maxBuffer: 1 << 28 },
    );
    const files = new Set<string>();
    for (const line of stdout.split('\n')) {
      if (line.length > 0) files.add(line);
    }
    return files;
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stderr?: string };
    const stderr = err.stderr?.trim();
    throw new RepoError(
      `Не удалось прочитать дерево HEAD: ${stderr ? stderr : err.message.trim()}`,
    );
  }
}
```

- [ ] **Step 4: Дополнить сборку пакета**

`src/model/build.ts` — в интерфейс `BuildOptions` добавить поле:

```ts
export interface BuildOptions {
  repoName: string;
  head: string;
  /**
   * Файлы дерева HEAD. Если переданы, живые по событиям пути, которых в HEAD
   * нет, закрываются синтетическим удалением на последнем коммите.
   */
  headFiles?: ReadonlySet<string>;
}
```

Внутри `buildPack` завести отслеживание собственной жизни. Сразу после объявления массивов событий добавить:

```ts
  // Какие пути живы по событиям: add и modify оживляют, delete хоронит.
  const liveOwn = new Set<number>();
```

В цикле по изменениям коммита сейчас идентификатор пути вычисляется прямо в
аргументе. Замени начало тела цикла

```ts
    for (const change of commit.changes) {
      eventPath.push(table.intern(change.path));
```

на

```ts
    for (const change of commit.changes) {
      const pathId = table.intern(change.path);
      if (change.kind === 'delete') liveOwn.delete(pathId);
      else liveOwn.add(pathId);
      eventPath.push(pathId);
```

остальные `push` в теле цикла не трогай.

Сразу после цикла по коммитам, до вызова `buildPathHistory`, добавить:

```ts
  // Сверка с деревом HEAD. При `--no-merges` удаление, записанное только
  // в коммите слияния, теряется, и путь остаётся живым навсегда. Дописываем
  // удаление последним коммитом — иначе HEAD показывает файлы, которых нет.
  if (opts.headFiles && commits.length > 0) {
    const lastCommit = commits.length - 1;
    for (const pathId of liveOwn) {
      if (opts.headFiles.has(table.paths[pathId]!)) continue;
      eventPath.push(pathId);
      eventCommit.push(lastCommit);
      eventKind.push(KIND_DELETE);
      eventAdded.push(0);
      eventDeleted.push(0);
      eventFlags.push(0);
    }
    commitEventStart[commitEventStart.length - 1] = eventPath.length;
  }
```

- [ ] **Step 5: Прокинуть список файлов через CLI**

`src/cli/main.ts` — добавить импорт `import { listHeadFiles } from '../git/tree.js';`
и в `collectPack`, перед `return buildPack(...)`, заменить возврат на:

```ts
  const headFiles = await listHeadFiles(info.root);
  return buildPack(commits, { repoName: info.name, head: info.head, headFiles });
```

- [ ] **Step 6: Запустить тесты**

Run: `npx vitest run && npm run typecheck`
Expected: PASS, все тесты зелёные, включая три новых.

- [ ] **Step 7: Коммит**

```bash
git add -A
git commit -m "feat(model): reconcile live set with the HEAD tree"
```

---

### Task 2: Движок времени — полный пересчёт

**Files:**
- Create: `web/time/engine.ts`
- Test: `tests/web/engine-seek.test.ts`

**Interfaces:**
- Consumes: `Pack`; `ALIVE`, `KIND_DELETE` из `src/model/history.js`
- Produces: `BEFORE_HISTORY = -1`; `TimeDelta { added: Uint32Array; removed: Uint32Array; touched: Uint32Array }`; `class TimeEngine` с `readonly alive: Uint8Array`, `readonly sizes: Int32Array`, `get cursor(): number`, `seek(target: number): TimeDelta`

- [ ] **Step 1: Написать падающий тест**

`tests/web/engine-seek.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { BEFORE_HISTORY, TimeEngine } from '../../web/time/engine.js';
import { buildPack } from '../../src/model/build.js';
import type { RawCommit } from '../../src/git/types.js';

function commit(hash: string, changes: RawCommit['changes']): RawCommit {
  return {
    hash,
    authorName: 'Аня',
    authorEmail: 'anya@example.com',
    timestamp: 100,
    subject: hash,
    changes,
  };
}

const pack = buildPack(
  [
    commit('c0', [
      { path: 'src/a.ts', kind: 'add', added: 10, deleted: 0, binary: false },
      { path: 'README.md', kind: 'add', added: 2, deleted: 0, binary: false },
    ]),
    commit('c1', [{ path: 'src/a.ts', kind: 'modify', added: 5, deleted: 1, binary: false }]),
    commit('c2', [{ path: 'src/a.ts', kind: 'delete', added: 0, deleted: 14, binary: false }]),
    commit('c3', [{ path: 'src/deep/b.ts', kind: 'add', added: 3, deleted: 0, binary: false }]),
  ],
  { repoName: 'demo', head: 'c3' },
);

const id = (path: string) => pack.paths.indexOf(path);

describe('TimeEngine.seek', () => {
  it('до начала истории не живо ничего', () => {
    const engine = new TimeEngine(pack);
    expect(engine.cursor).toBe(BEFORE_HISTORY);
    expect([...engine.alive].every((v) => v === 0)).toBe(true);
  });

  it('оживляет пути и их предков', () => {
    const engine = new TimeEngine(pack);
    engine.seek(0);
    expect(engine.alive[id('src/a.ts')]).toBe(1);
    expect(engine.alive[id('src')]).toBe(1);
    expect(engine.alive[0]).toBe(1);
    expect(engine.sizes[id('src/a.ts')]).toBe(10);
  });

  it('хоронит директорию вместе с последним потомком', () => {
    const engine = new TimeEngine(pack);
    engine.seek(2);
    expect(engine.alive[id('src/a.ts')]).toBe(0);
    expect(engine.alive[id('src')]).toBe(0);
    expect(engine.alive[id('README.md')]).toBe(1);
    expect(engine.alive[0]).toBe(1);
  });

  it('оживляет цепочку директорий на глубоком пути', () => {
    const engine = new TimeEngine(pack);
    engine.seek(3);
    expect(engine.alive[id('src/deep/b.ts')]).toBe(1);
    expect(engine.alive[id('src/deep')]).toBe(1);
    expect(engine.alive[id('src')]).toBe(1);
    expect(engine.alive[id('src/a.ts')]).toBe(0);
  });

  it('возвращает разницу живого множества', () => {
    const engine = new TimeEngine(pack);
    engine.seek(1);
    const delta = engine.seek(2);
    expect([...delta.removed].sort((a, b) => a - b)).toEqual(
      [id('src'), id('src/a.ts')].sort((a, b) => a - b),
    );
    expect([...delta.added]).toEqual([]);
  });

  it('зажимает курсор в границы истории', () => {
    const engine = new TimeEngine(pack);
    engine.seek(999);
    expect(engine.cursor).toBe(pack.meta.commitCount - 1);
    engine.seek(-999);
    expect(engine.cursor).toBe(BEFORE_HISTORY);
    expect([...engine.alive].every((v) => v === 0)).toBe(true);
  });

  it('не заглядывает в будущее по размеру', () => {
    const engine = new TimeEngine(pack);
    engine.seek(0);
    expect(engine.sizes[id('src/a.ts')]).toBe(10);
    engine.seek(1);
    expect(engine.sizes[id('src/a.ts')]).toBe(14);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run tests/web/engine-seek.test.ts`
Expected: FAIL — не найден модуль `web/time/engine.js`.

- [ ] **Step 3: Реализовать**

`web/time/engine.ts`:

```ts
import { ALIVE } from '../../src/model/history.js';
import type { Pack } from '../../src/model/types.js';

/** Курсор до первого коммита: не живо ничего. */
export const BEFORE_HISTORY = -1;

export interface TimeDelta {
  /** Идентификаторы путей, ставших живыми. */
  added: Uint32Array;
  /** Идентификаторы путей, ставших мёртвыми. */
  removed: Uint32Array;
  /** Пути, затронутые событиями этого перехода: пригодятся для вспышек. */
  touched: Uint32Array;
}

const EMPTY = new Uint32Array(0);

/**
 * Держит живое множество путей и их размеры на текущем курсоре.
 *
 * Живость пути складывается из двух источников: собственные события файла и
 * наличие живых потомков. Второе считается счётчиком, а не пересчётом дерева,
 * поэтому изменение состояния одного файла стоит O(глубины пути).
 */
export class TimeEngine {
  /** Живые пути; индекс — идентификатор пути. */
  readonly alive: Uint8Array;
  /** Размер файла в строках; директории всегда 0. */
  readonly sizes: Int32Array;

  private readonly ownAlive: Uint8Array;
  private readonly liveChildren: Uint32Array;
  /** Глобальный индекс события → его позиция в CSR по путям. */
  private readonly linePos: Uint32Array;
  private cursorIndex = BEFORE_HISTORY;

  constructor(private readonly pack: Pack) {
    const { pathCount } = pack.meta;
    this.alive = new Uint8Array(pathCount);
    this.sizes = new Int32Array(pathCount);
    this.ownAlive = new Uint8Array(pathCount);
    this.liveChildren = new Uint32Array(pathCount);

    // pathEventLines индексируется позицией в CSR по путям, а события мы
    // обходим по глобальному индексу — строим обратное соответствие один раз.
    this.linePos = new Uint32Array(pack.eventPath.length);
    for (let k = 0; k < pack.pathEventIdx.length; k++) {
      this.linePos[pack.pathEventIdx[k]] = k;
    }
  }

  get cursor(): number {
    return this.cursorIndex;
  }

  /** Полный пересчёт на произвольный коммит. Используется при драге слайдера. */
  seek(target: number): TimeDelta {
    const clamped = Math.max(
      BEFORE_HISTORY,
      Math.min(target, this.pack.meta.commitCount - 1),
    );
    const before = this.alive.slice();
    this.recompute(clamped);
    this.cursorIndex = clamped;

    const added: number[] = [];
    const removed: number[] = [];
    for (let p = 0; p < this.alive.length; p++) {
      if (before[p] === this.alive[p]) continue;
      if (this.alive[p] === 1) added.push(p);
      else removed.push(p);
    }
    return { added: Uint32Array.from(added), removed: Uint32Array.from(removed), touched: EMPTY };
  }

  private recompute(target: number): void {
    const { pack } = this;
    const { pathCount } = pack.meta;
    this.ownAlive.fill(0);
    this.sizes.fill(0);
    this.liveChildren.fill(0);
    this.alive.fill(0);
    if (target < 0) return;

    for (let p = 0; p < pathCount; p++) {
      for (let k = pack.lifetimeStart[p]; k < pack.lifetimeStart[p + 1]; k++) {
        const birth = pack.lifetimeBirth[k];
        if (birth > target) break; // интервалы идут по возрастанию
        const death = pack.lifetimeDeath[k];
        if (death === ALIVE || death > target) {
          this.ownAlive[p] = 1;
          break;
        }
      }

      // Последнее событие пути, попавшее в [0, target] — двоичным поиском.
      let lo = pack.pathEventStart[p];
      let hi = pack.pathEventStart[p + 1] - 1;
      let found = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (pack.eventCommit[pack.pathEventIdx[mid]] <= target) {
          found = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      if (found !== -1) this.sizes[p] = pack.pathEventLines[found];
    }

    // Идентификатор родителя всегда меньше идентификатора потомка, поэтому
    // обход по убыванию гарантирует, что потомки посчитаны раньше родителя.
    for (let p = pathCount - 1; p >= 1; p--) {
      if (this.ownAlive[p] === 1 || this.liveChildren[p] > 0) {
        this.alive[p] = 1;
        this.liveChildren[pack.pathParent[p]]++;
      }
    }
    if (pathCount > 0) {
      this.alive[0] = this.ownAlive[0] === 1 || this.liveChildren[0] > 0 ? 1 : 0;
    }
  }
}
```

- [ ] **Step 4: Запустить тесты**

Run: `npx vitest run tests/web/engine-seek.test.ts && npm run typecheck`
Expected: PASS, 7 тестов.

- [ ] **Step 5: Коммит**

```bash
git add -A
git commit -m "feat(time): time engine with full recomputation"
```

---

### Task 3: Движок времени — инкрементальный шаг

Главная задача среза: шаг на коммит должен стоить ровно столько, сколько событий в этом коммите, и при этом давать результат, неотличимый от полного пересчёта.

**Files:**
- Modify: `web/time/engine.ts`
- Test: `tests/web/engine-step.test.ts`

**Interfaces:**
- Consumes: всё из Task 2
- Produces: `TimeEngine.step(): TimeDelta` — переводит курсор на следующий коммит; на конце истории возвращает пустую разницу и не двигает курсор

- [ ] **Step 1: Написать падающий тест**

`tests/web/engine-step.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { BEFORE_HISTORY, TimeEngine } from '../../web/time/engine.js';
import { buildPack } from '../../src/model/build.js';
import { makeRng } from '../../src/util/rng.js';
import type { RawCommit } from '../../src/git/types.js';

/** Случайная, но воспроизводимая история с созданиями, правками и удалениями. */
function randomCommits(seed: number, count: number): RawCommit[] {
  const rng = makeRng(seed);
  const files = ['a.txt', 'src/b.ts', 'src/deep/c.ts', 'src/deep/d.ts', 'docs/e.md'];
  const alive = new Set<string>();
  const commits: RawCommit[] = [];

  for (let i = 0; i < count; i++) {
    const changes: RawCommit['changes'] = [];
    for (const path of files) {
      if (rng() < 0.55) continue;
      const isAlive = alive.has(path);
      const kind = !isAlive ? 'add' : rng() < 0.3 ? 'delete' : 'modify';
      if (kind === 'add') alive.add(path);
      if (kind === 'delete') alive.delete(path);
      changes.push({
        path,
        kind: kind as 'add' | 'modify' | 'delete',
        added: Math.floor(rng() * 30),
        deleted: Math.floor(rng() * 20),
        binary: false,
      });
    }
    commits.push({
      hash: `h${i}`,
      authorName: 'A',
      authorEmail: 'a@e.com',
      timestamp: 1_700_000_000 + i * 60,
      subject: `c${i}`,
      changes,
    });
  }
  return commits;
}

describe('TimeEngine.step', () => {
  it('на конце истории не двигает курсор', () => {
    const pack = buildPack(randomCommits(1, 3), { repoName: 'd', head: 'h' });
    const engine = new TimeEngine(pack);
    engine.seek(pack.meta.commitCount - 1);
    const delta = engine.step();
    expect(engine.cursor).toBe(pack.meta.commitCount - 1);
    expect(delta.added.length).toBe(0);
    expect(delta.removed.length).toBe(0);
  });

  it('сообщает затронутые пути', () => {
    const pack = buildPack(
      [
        {
          hash: 'h0',
          authorName: 'A',
          authorEmail: 'a@e.com',
          timestamp: 1,
          subject: 'c0',
          changes: [{ path: 'a.txt', kind: 'add', added: 3, deleted: 0, binary: false }],
        },
      ],
      { repoName: 'd', head: 'h' },
    );
    const engine = new TimeEngine(pack);
    const delta = engine.step();
    expect([...delta.touched]).toEqual([pack.paths.indexOf('a.txt')]);
    expect([...delta.added].includes(pack.paths.indexOf('a.txt'))).toBe(true);
  });

  // Главный тест среза: пошаговый проход обязан совпасть с полным пересчётом
  // на каждом коммите. Здесь прячутся все инкрементальные ошибки.
  it('пошаговый проход совпадает с полным пересчётом на каждом коммите', () => {
    for (const seed of [1, 7, 42, 1337, 20260817]) {
      const pack = buildPack(randomCommits(seed, 40), { repoName: 'd', head: 'h' });
      const stepwise = new TimeEngine(pack);
      const reference = new TimeEngine(pack);
      expect(stepwise.cursor, `seed ${seed}`).toBe(BEFORE_HISTORY);

      for (let t = 0; t < pack.meta.commitCount; t++) {
        stepwise.step();
        reference.seek(t);
        expect(stepwise.cursor, `seed ${seed}, коммит ${t}`).toBe(t);
        expect(Array.from(stepwise.alive), `alive: seed ${seed}, коммит ${t}`).toEqual(
          Array.from(reference.alive),
        );
        expect(Array.from(stepwise.sizes), `sizes: seed ${seed}, коммит ${t}`).toEqual(
          Array.from(reference.sizes),
        );
      }
    }
  });

  it('накопленные разницы шагов воспроизводят живое множество', () => {
    const pack = buildPack(randomCommits(99, 30), { repoName: 'd', head: 'h' });
    const engine = new TimeEngine(pack);
    const mask = new Uint8Array(pack.meta.pathCount);

    for (let t = 0; t < pack.meta.commitCount; t++) {
      const delta = engine.step();
      for (const p of delta.added) {
        expect(mask[p], `повторное добавление ${p} на коммите ${t}`).toBe(0);
        mask[p] = 1;
      }
      for (const p of delta.removed) {
        expect(mask[p], `удаление неживого ${p} на коммите ${t}`).toBe(1);
        mask[p] = 0;
      }
      expect(Array.from(mask), `коммит ${t}`).toEqual(Array.from(engine.alive));
    }
  });

  it('шаг после перемотки продолжает с нужного места', () => {
    const pack = buildPack(randomCommits(5, 20), { repoName: 'd', head: 'h' });
    const engine = new TimeEngine(pack);
    const reference = new TimeEngine(pack);

    engine.seek(9);
    engine.step();
    reference.seek(10);
    expect(Array.from(engine.alive)).toEqual(Array.from(reference.alive));
    expect(Array.from(engine.sizes)).toEqual(Array.from(reference.sizes));
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run tests/web/engine-step.test.ts`
Expected: FAIL — `engine.step is not a function`.

- [ ] **Step 3: Реализовать шаг**

`web/time/engine.ts` — добавить импорт `KIND_DELETE`:

```ts
import { ALIVE, KIND_DELETE } from '../../src/model/history.js';
```

и дописать в класс два метода:

```ts
  /**
   * Переводит курсор на следующий коммит, обрабатывая только его события.
   * Это горячий путь воспроизведения: стоимость — O(событий коммита + глубины
   * затронутых путей), без обхода всего дерева.
   */
  step(): TimeDelta {
    const next = this.cursorIndex + 1;
    if (next >= this.pack.meta.commitCount) {
      return { added: EMPTY, removed: EMPTY, touched: EMPTY };
    }

    const { pack } = this;
    const added: number[] = [];
    const removed: number[] = [];
    const touched: number[] = [];

    for (let e = pack.commitEventStart[next]; e < pack.commitEventStart[next + 1]; e++) {
      const path = pack.eventPath[e];
      const kind = pack.eventKind[e];
      touched.push(path);
      this.sizes[path] = pack.pathEventLines[this.linePos[e]];

      const own = kind === KIND_DELETE ? 0 : 1;
      if (own !== this.ownAlive[path]) {
        this.ownAlive[path] = own;
        this.refresh(path, added, removed);
      }
    }

    this.cursorIndex = next;
    return {
      added: Uint32Array.from(added),
      removed: Uint32Array.from(removed),
      touched: Uint32Array.from(touched),
    };
  }

  /**
   * Пересчитывает живость пути и, если она изменилась, поднимается к корню:
   * директория жива ровно пока у неё есть живые потомки.
   */
  private refresh(path: number, added: number[], removed: number[]): void {
    const now = this.ownAlive[path] === 1 || this.liveChildren[path] > 0 ? 1 : 0;
    if (now === this.alive[path]) return;

    this.alive[path] = now;
    if (now === 1) added.push(path);
    else removed.push(path);

    if (path === 0) return; // у корня родитель — он сам
    const parent = this.pack.pathParent[path];
    if (now === 1) this.liveChildren[parent]++;
    else this.liveChildren[parent]--;
    this.refresh(parent, added, removed);
  }
```

- [ ] **Step 4: Запустить тесты**

Run: `npx vitest run tests/web && npm run typecheck`
Expected: PASS, 5 новых тестов зелёные вместе с остальными.

- [ ] **Step 5: Коммит**

```bash
git add -A
git commit -m "feat(time): incremental step with parent liveness counters"
```

---

### Task 4: Протокол воркера и симуляция с памятью позиций

**Files:**
- Modify: `web/layout/protocol.ts` (полная замена), `web/layout/worker.ts` (полная замена), `web/layout/graph.ts` (полная замена)
- Test: `tests/web/graph.test.ts` (полная замена)

**Interfaces:**
- Consumes: `makeRng` из `src/util/rng.js`; `d3-force`
- Produces: `radiusFor(lines: number, isDir: boolean): number`; `ActiveLinks { source: Uint32Array; target: Uint32Array }`; `buildActiveLinks(active: Uint8Array, parent: Uint32Array): ActiveLinks`; типы `LayoutInit { type:'init'; pathCount:number; seed:number }`, `LayoutUpdate { type:'update'; added:Uint32Array; removed:Uint32Array; radiusIds:Uint32Array; radiusValues:Float32Array; linkSource:Uint32Array; linkTarget:Uint32Array; parentOf:Uint32Array }`, `LayoutPositions { type:'positions'; positions:Float32Array; alpha:number }`

- [ ] **Step 1: Написать падающий тест**

`tests/web/graph.test.ts` — заменить содержимое целиком:

```ts
import { describe, it, expect } from 'vitest';
import { buildActiveLinks, radiusFor } from '../../web/layout/graph.js';

describe('buildActiveLinks', () => {
  it('строит рёбра родитель → потомок в идентификаторах путей', () => {
    const active = Uint8Array.from([1, 1, 1]);
    const parent = Uint32Array.from([0, 0, 1]);
    const links = buildActiveLinks(active, parent);
    expect([...links.source]).toEqual([0, 1]);
    expect([...links.target]).toEqual([1, 2]);
  });

  it('не создаёт петлю у корня', () => {
    const links = buildActiveLinks(Uint8Array.from([1]), Uint32Array.from([0]));
    expect(links.source.length).toBe(0);
  });

  it('пропускает ребро, если родитель мёртв', () => {
    const links = buildActiveLinks(Uint8Array.from([1, 0, 1]), Uint32Array.from([0, 0, 1]));
    expect(links.source.length).toBe(0);
  });

  it('пропускает мёртвые узлы', () => {
    const links = buildActiveLinks(Uint8Array.from([1, 1, 0]), Uint32Array.from([0, 0, 1]));
    expect([...links.source]).toEqual([0]);
    expect([...links.target]).toEqual([1]);
  });

  it('не падает на пустом живом множестве', () => {
    const links = buildActiveLinks(new Uint8Array(4), Uint32Array.from([0, 0, 1, 2]));
    expect(links.source.length).toBe(0);
    expect(links.target.length).toBe(0);
  });
});

describe('radiusFor', () => {
  it('растёт как корень из числа строк', () => {
    expect(radiusFor(0, false)).toBeCloseTo(2.5, 1);
    expect(radiusFor(100, false)).toBeGreaterThan(radiusFor(25, false));
    expect(radiusFor(1_000_000, false)).toBeLessThanOrEqual(40);
  });

  it('делает директории мелкими и одинаковыми', () => {
    expect(radiusFor(0, true)).toBe(radiusFor(9999, true));
  });

  it('клэмпит отрицательное число строк', () => {
    expect(radiusFor(-50, false)).toBeCloseTo(2.5, 1);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run tests/web/graph.test.ts`
Expected: FAIL — `buildActiveLinks` не экспортируется.

- [ ] **Step 3: Переписать чистую часть**

`web/layout/graph.ts` — заменить содержимое целиком:

```ts
export interface ActiveLinks {
  /** Идентификаторы путей-родителей. */
  source: Uint32Array;
  /** Идентификаторы путей-потомков. */
  target: Uint32Array;
}

const DIR_RADIUS = 3;
const MIN_RADIUS = 2.5;
const MAX_RADIUS = 40;

export function radiusFor(lines: number, isDir: boolean): number {
  if (isDir) return DIR_RADIUS;
  return Math.min(MAX_RADIUS, MIN_RADIUS + Math.sqrt(Math.max(0, lines)) * 0.6);
}

/**
 * Рёбра дерева между живыми узлами, в идентификаторах путей.
 * Плотной перенумерации больше нет: она ломала бы позиции при каждом
 * изменении состава живых узлов, а состав меняется на каждом коммите.
 */
export function buildActiveLinks(active: Uint8Array, parent: Uint32Array): ActiveLinks {
  const source: number[] = [];
  const target: number[] = [];
  for (let path = 0; path < active.length; path++) {
    if (active[path] === 0) continue;
    const parentId = parent[path];
    if (parentId === path) continue; // корень
    if (active[parentId] === 0) continue;
    source.push(parentId);
    target.push(path);
  }
  return { source: Uint32Array.from(source), target: Uint32Array.from(target) };
}
```

- [ ] **Step 4: Переписать протокол**

`web/layout/protocol.ts` — заменить содержимое целиком:

```ts
/** Главный поток → воркер: однократная настройка размера мира. */
export interface LayoutInit {
  type: 'init';
  /** Длина всех массивов по узлам; индекс — идентификатор пути. */
  pathCount: number;
  /** Фиксированный seed: два запуска на одном репозитории дают похожую картинку. */
  seed: number;
}

/**
 * Главный поток → воркер: изменение состава и геометрии.
 * Передаётся именно разница, а не полный набор: только так у узла сохраняется
 * позиция между кадрами, а вернувшийся файл всплывает там же, где исчез.
 */
export interface LayoutUpdate {
  type: 'update';
  /** Идентификаторы путей, вошедших в симуляцию. */
  added: Uint32Array;
  /** Идентификаторы путей, покинувших симуляцию. */
  removed: Uint32Array;
  /** Пути, у которых изменился радиус, и сами радиусы — параллельные массивы. */
  radiusIds: Uint32Array;
  radiusValues: Float32Array;
  /** Активные рёбра в идентификаторах путей. */
  linkSource: Uint32Array;
  linkTarget: Uint32Array;
  /** Родитель каждого добавленного узла: новый узел появляется рядом с папкой. */
  parentOf: Uint32Array;
}

/** Воркер → главный поток: пары x, y длиной pathCount * 2, индекс — путь. */
export interface LayoutPositions {
  type: 'positions';
  positions: Float32Array;
  /** «Температура» симуляции; ниже 0.02 картинка практически замерла. */
  alpha: number;
}

export type ToWorker = LayoutInit | LayoutUpdate;
export type FromWorker = LayoutPositions;
```

- [ ] **Step 5: Переписать воркер**

`web/layout/worker.ts` — заменить содержимое целиком:

```ts
import {
  forceCenter,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
} from 'd3-force';
import { makeRng } from '../../src/util/rng.js';
import type { FromWorker, ToWorker } from './protocol.js';

interface Node {
  /** Идентификатор пути; сохраняется на всё время сессии. */
  id: number;
  x: number;
  y: number;
  radius: number;
}

/**
 * Все узлы, которые когда-либо появлялись, включая ушедшие. Позиция ушедшего
 * узла остаётся здесь: если файл вернётся, он всплывёт там же, где исчез.
 */
const known = new Map<number, Node>();
let active: Uint8Array = new Uint8Array(0);
let simulation: Simulation<Node, SimulationLinkDatum<Node>> | null = null;
let rng: () => number = makeRng(1);
let lastPost = 0;

function post(alpha: number): void {
  const positions = new Float32Array(active.length * 2);
  for (let path = 0; path < active.length; path++) {
    if (active[path] === 0) continue;
    const node = known.get(path);
    if (!node) continue;
    positions[path * 2] = node.x;
    positions[path * 2 + 1] = node.y;
  }
  const message: FromWorker = { type: 'positions', positions, alpha };
  (self as unknown as Worker).postMessage(message, [positions.buffer]);
}

/** Новый узел рождается рядом с родителем, если тот на сцене, иначе на кольце. */
function spawn(id: number, parentId: number, radius: number): Node {
  const parent = active[parentId] === 1 ? known.get(parentId) : undefined;
  const angle = rng() * Math.PI * 2;
  if (parent) {
    const jitter = 8 + rng() * 12;
    return { id, x: parent.x + Math.cos(angle) * jitter, y: parent.y + Math.sin(angle) * jitter, radius };
  }
  const distance = Math.sqrt(rng()) * 400;
  return { id, x: Math.cos(angle) * distance, y: Math.sin(angle) * distance, radius };
}

self.onmessage = (event: MessageEvent<ToWorker>) => {
  const message = event.data;

  if (message.type === 'init') {
    known.clear();
    active = new Uint8Array(message.pathCount);
    rng = makeRng(message.seed);
    lastPost = 0;
    simulation?.stop();
    simulation = null;
    return;
  }

  for (const id of message.removed) active[id] = 0;
  for (let i = 0; i < message.added.length; i++) {
    const id = message.added[i]!;
    active[id] = 1;
    if (!known.has(id)) {
      known.set(id, spawn(id, message.parentOf[i]!, 3));
    }
  }
  for (let i = 0; i < message.radiusIds.length; i++) {
    const node = known.get(message.radiusIds[i]!);
    if (node) node.radius = message.radiusValues[i]!;
  }

  const nodes: Node[] = [];
  for (let path = 0; path < active.length; path++) {
    if (active[path] === 1) {
      const node = known.get(path);
      if (node) nodes.push(node);
    }
  }

  const byId = new Map<number, Node>();
  for (const node of nodes) byId.set(node.id, node);
  const links: SimulationLinkDatum<Node>[] = [];
  for (let i = 0; i < message.linkSource.length; i++) {
    const source = byId.get(message.linkSource[i]!);
    const target = byId.get(message.linkTarget[i]!);
    if (source && target) links.push({ source, target });
  }

  if (!simulation) {
    simulation = forceSimulation<Node>(nodes)
      .force('charge', forceManyBody<Node>().strength((node) => -30 - node.radius * 4))
      .force('center', forceCenter(0, 0))
      .alphaDecay(0.015)
      .on('tick', () => {
        // Рендер всё равно не успевает чаще ~30 Гц, а сообщения не бесплатны.
        const now = performance.now();
        if (now - lastPost < 33) return;
        lastPost = now;
        post(simulation!.alpha());
      })
      .on('end', () => post(0));
  } else {
    simulation.nodes(nodes);
  }

  simulation.force('link', forceLink<Node, SimulationLinkDatum<Node>>(links).distance(24).strength(0.7));
  // Подогреваем: новые узлы должны разойтись, а не остаться в точке рождения.
  simulation.alpha(Math.max(simulation.alpha(), 0.4)).restart();
  post(simulation.alpha());
};
```

- [ ] **Step 6: Запустить тесты и сборку**

Run: `npx vitest run tests/web/graph.test.ts && npm run build:web`
Expected: тесты PASS (8 штук). Сборка **упадёт**: `web/main.ts` ещё использует старый протокол. Это ожидаемо, чинится в Task 6.

- [ ] **Step 7: Коммит**

```bash
git add -A
git commit -m "feat(layout): diff-based worker protocol with position memory"
```

---

### Task 5: Рендер и камера по маске активности

**Files:**
- Modify: `web/render/scene.ts`, `web/render/camera.ts`
- Test: `tests/web/camera.test.ts` (дополняется)

**Interfaces:**
- Consumes: `Camera`
- Produces: `SceneInput { active: Uint8Array; positions: Float32Array; radius: Float32Array; color: string[]; linkSource: Uint32Array; linkTarget: Uint32Array }`; `Camera.fitActive(positions: Float32Array, active: Uint8Array, width: number, height: number): boolean` — возвращает `false`, если вписывать было нечего

- [ ] **Step 1: Написать падающий тест**

Дописать в конец `tests/web/camera.test.ts`:

```ts
describe('Camera.fitActive', () => {
  it('вписывает только активные узлы', () => {
    const camera = new Camera();
    // Мёртвый узел лежит далеко: если он попадёт в расчёт, масштаб рухнет.
    const positions = Float32Array.from([-10, -10, 10, 10, 100000, 100000]);
    const active = Uint8Array.from([1, 1, 0]);
    camera.fitActive(positions, active, 800, 600);

    const [ax, ay] = camera.toScreen(-10, -10);
    const [bx, by] = camera.toScreen(10, 10);
    expect(ax).toBeGreaterThan(0);
    expect(ay).toBeGreaterThan(0);
    expect(bx).toBeLessThan(800);
    expect(by).toBeLessThan(600);
    expect(camera.scale).toBeGreaterThan(1);
  });

  it('не трогает камеру, если активных узлов нет, и сообщает об этом', () => {
    const camera = new Camera();
    const before = camera.scale;
    const fitted = camera.fitActive(Float32Array.from([1, 1]), Uint8Array.from([0]), 800, 600);
    expect(fitted).toBe(false);
    expect(camera.scale).toBe(before);
  });

  it('сообщает об успешном вписывании', () => {
    const camera = new Camera();
    const fitted = camera.fitActive(
      Float32Array.from([-5, -5, 5, 5]),
      Uint8Array.from([1, 1]),
      800,
      600,
    );
    expect(fitted).toBe(true);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run tests/web/camera.test.ts`
Expected: FAIL — `camera.fitActive is not a function`.

- [ ] **Step 3: Дописать камеру**

`web/render/camera.ts` — добавить метод в класс `Camera`, сразу после `fit`:

```ts
  /**
   * Вписывает в вид только активные узлы. Массив позиций покрывает все пути
   * за всю историю, и мёртвые узлы в нём хранят старые координаты — если их
   * учесть, масштаб определится по давно исчезнувшему углу дерева.
   * Возвращает false, если активных узлов не оказалось: вызывающий не должен
   * считать, что камера настроена, иначе она останется настроенной никогда.
   */
  fitActive(positions: Float32Array, active: Uint8Array, width: number, height: number): boolean {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let count = 0;
    for (let path = 0; path < active.length; path++) {
      if (active[path] === 0) continue;
      const px = positions[path * 2]!;
      const py = positions[path * 2 + 1]!;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
      count++;
    }
    if (count === 0) return false;
    this.fit(Float32Array.from([minX, minY, maxX, maxY]), width, height);
    return true;
  }
```

- [ ] **Step 4: Обновить сцену**

`web/render/scene.ts` — заменить интерфейс `SceneInput` и тело `drawScene`, оставив `colorForPath` и палитру без изменений:

```ts
export interface SceneInput {
  /** Маска живых узлов; индекс — идентификатор пути. */
  active: Uint8Array;
  /** Пары x, y в мировых координатах; индекс пары — идентификатор пути. */
  positions: Float32Array;
  radius: Float32Array;
  color: string[];
  linkSource: Uint32Array;
  linkTarget: Uint32Array;
}

export function drawScene(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  input: SceneInput,
  width: number,
  height: number,
): void {
  ctx.clearRect(0, 0, width, height);

  ctx.strokeStyle = '#2a3140';
  ctx.lineWidth = Math.max(0.4, camera.scale * 0.35);
  ctx.beginPath();
  for (let i = 0; i < input.linkSource.length; i++) {
    const a = input.linkSource[i]! * 2;
    const b = input.linkTarget[i]! * 2;
    const [ax, ay] = camera.toScreen(input.positions[a]!, input.positions[a + 1]!);
    const [bx, by] = camera.toScreen(input.positions[b]!, input.positions[b + 1]!);
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
  }
  ctx.stroke();

  for (let path = 0; path < input.active.length; path++) {
    if (input.active[path] === 0) continue;
    const [sx, sy] = camera.toScreen(input.positions[path * 2]!, input.positions[path * 2 + 1]!);
    const r = input.radius[path]! * camera.scale;
    // Отсечение: за границами вида рисовать нечего, а узлов десятки тысяч.
    if (sx + r < 0 || sy + r < 0 || sx - r > width || sy - r > height) continue;
    ctx.fillStyle = input.color[path]!;
    ctx.beginPath();
    ctx.arc(sx, sy, Math.max(0.5, r), 0, Math.PI * 2);
    ctx.fill();
  }
}
```

- [ ] **Step 5: Запустить тесты**

Run: `npx vitest run tests/web/camera.test.ts && npm run typecheck`
Expected: тесты PASS (10 штук). `typecheck` **сообщит об ошибке** в `web/main.ts`: старый `SceneInput` без поля `active`. Это ожидаемо, чинится в Task 6.

- [ ] **Step 6: Коммит**

```bash
git add -A
git commit -m "feat(render): draw by path id with an active mask"
```

---

### Task 6: Сборка главного потока на движке времени

Задача восстанавливает работоспособность: поведение остаётся прежним — статичное дерево на HEAD, — но всё уже собрано на новых механизмах. Существующий E2E должен снова стать зелёным.

**Files:**
- Modify: `web/main.ts` (полная замена)

**Interfaces:**
- Consumes: `TimeEngine`, `buildActiveLinks`, `radiusFor`, `SceneInput`, `Camera.fitActive`, протокол воркера
- Produces: функция `applyDelta` внутри `main.ts` — точка, куда Task 7 подключит воспроизведение

- [ ] **Step 1: Заменить точку входа**

`web/main.ts` — заменить содержимое целиком:

```ts
import { describePack, loadPack, showFatal } from './boot.js';
import { TimeEngine, type TimeDelta } from './time/engine.js';
import { buildActiveLinks, radiusFor } from './layout/graph.js';
import type { FromWorker, LayoutInit, LayoutUpdate } from './layout/protocol.js';
import { Camera } from './render/camera.js';
import { colorForPath, drawScene, type SceneInput } from './render/scene.js';
import type { Pack } from '../src/model/types.js';

const DIR_COLOR = '#39414d';

async function start(): Promise<void> {
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const status = document.getElementById('status');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    showFatal('Браузер не дал контекст canvas 2D.');
    return;
  }

  const pack: Pack = await loadPack();
  const { pathCount } = pack.meta;

  const color: string[] = new Array<string>(pathCount);
  for (let path = 0; path < pathCount; path++) {
    color[path] = pack.pathIsDir[path] === 1 ? DIR_COLOR : colorForPath(pack.paths[path]!);
  }

  const scene: SceneInput = {
    active: new Uint8Array(pathCount),
    positions: new Float32Array(pathCount * 2),
    radius: new Float32Array(pathCount),
    color,
    linkSource: new Uint32Array(0),
    linkTarget: new Uint32Array(0),
  };

  const camera = new Camera();
  camera.attach(canvas);
  let fitted = false;

  const worker = new Worker(new URL('./layout/worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<FromWorker>) => {
    if (event.data.type !== 'positions') return;
    scene.positions = event.data.positions;
    // Вписываем камеру один раз — но только когда вписывать действительно было
    // что: на пустой сцене fitActive ничего не делает, и поднимать флаг нельзя.
    if (!fitted && event.data.alpha < 0.3) {
      fitted = camera.fitActive(
        scene.positions,
        scene.active,
        canvas.clientWidth,
        canvas.clientHeight,
      );
    }
  };
  // Ловит и ошибку загрузки модуля воркера, и необработанное исключение внутри
  // него: без этого раскладка молча не запускается, а узлы остаются в нуле.
  worker.onerror = (event: ErrorEvent) => {
    const detail = event.message || 'подробности недоступны';
    showFatal(`Раскладка не запустилась: воркер аварийно завершился. ${detail}`);
  };

  const init: LayoutInit = { type: 'init', pathCount, seed: 20260817 };
  worker.postMessage(init);

  const engine = new TimeEngine(pack);

  /**
   * Переносит разницу движка времени в сцену и в воркер.
   * `full` обязателен после перемотки: `seek` не сообщает затронутые пути, а
   * размеры при этом меняются у любого выжившего файла — без полного обхода
   * радиусы остались бы от прежнего положения курсора.
   */
  function applyDelta(delta: TimeDelta, full = false): void {
    scene.active.set(engine.alive);

    const radiusIds: number[] = [];
    const radiusValues: number[] = [];
    const remember = (path: number) => {
      // Округляем до float32: scene.radius хранит именно его, и без округления
      // сравнение «изменилось ли» было бы истинным всегда.
      const next = Math.fround(radiusFor(engine.sizes[path]!, pack.pathIsDir[path] === 1));
      if (scene.radius[path] === next) return;
      scene.radius[path] = next;
      radiusIds.push(path);
      radiusValues.push(next);
    };
    if (full) {
      for (let path = 0; path < pathCount; path++) {
        if (scene.active[path] === 1) remember(path);
      }
    } else {
      for (const path of delta.added) remember(path);
      for (const path of delta.touched) remember(path);
    }

    const links = buildActiveLinks(scene.active, pack.pathParent);
    scene.linkSource = links.source;
    scene.linkTarget = links.target;

    const parentOf = new Uint32Array(delta.added.length);
    for (let i = 0; i < delta.added.length; i++) {
      parentOf[i] = pack.pathParent[delta.added[i]!]!;
    }

    const update: LayoutUpdate = {
      type: 'update',
      added: delta.added,
      removed: delta.removed,
      radiusIds: Uint32Array.from(radiusIds),
      radiusValues: Float32Array.from(radiusValues),
      linkSource: links.source,
      linkTarget: links.target,
      parentOf,
    };
    worker.postMessage(update);

    if (status) {
      let live = 0;
      for (let path = 0; path < pathCount; path++) if (scene.active[path] === 1) live++;
      status.textContent = `${describePack(pack)} · узлов: ${live}`;
    }
  }

  applyDelta(engine.seek(pack.meta.commitCount - 1), true);

  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  window.addEventListener('resize', resize);
  resize();

  // Исключение внутри кадра не должно молча остановить цикл на недостижимом
  // requestAnimationFrame: показываем причину и прекращаем цикл осознанно.
  const frame = () => {
    try {
      drawScene(ctx, camera, scene, canvas.clientWidth, canvas.clientHeight);
    } catch (error) {
      showFatal(
        `Не удалось отрисовать кадр: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  canvas.dataset.ready = 'true';
}

start().catch((error: unknown) => {
  showFatal(error instanceof Error ? error.message : 'Не удалось построить визуализацию.');
});
```

- [ ] **Step 2: Прогнать всё**

Run: `npx vitest run && npm run typecheck && npm run build && npx playwright test`
Expected: PASS во всех четырёх. Существующий E2E снова зелёный: картинка та же, механизмы новые.

- [ ] **Step 3: Коммит**

```bash
git add -A
git commit -m "feat(web): drive the scene from the time engine"
```

---

### Task 7: Воспроизведение

**Files:**
- Create: `web/time/playback.ts`
- Test: `tests/web/playback.test.ts`

**Interfaces:**
- Consumes: ничего
- Produces: `class Playback` с `get playing(): boolean`, `speed: number`, `play()`, `pause()`, `toggle()`, `advance(dtSeconds: number): number`, `reset()`. Конструктор принимает `onStep: () => boolean` — колбэк делает один шаг и возвращает `false`, когда история кончилась.

- [ ] **Step 1: Написать падающий тест**

`tests/web/playback.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Playback } from '../../web/time/playback.js';

describe('Playback', () => {
  it('на паузе не делает шагов', () => {
    let steps = 0;
    const playback = new Playback(() => {
      steps++;
      return true;
    });
    expect(playback.playing).toBe(false);
    expect(playback.advance(10)).toBe(0);
    expect(steps).toBe(0);
  });

  it('делает шаги по скорости в коммитах за секунду', () => {
    let steps = 0;
    const playback = new Playback(() => {
      steps++;
      return true;
    });
    playback.speed = 4;
    playback.play();
    expect(playback.advance(1)).toBe(4);
    expect(steps).toBe(4);
  });

  it('копит дробный остаток между кадрами', () => {
    const playback = new Playback(() => true);
    playback.speed = 2;
    playback.play();
    // Четыре кадра по четверти секунды при скорости два — ровно два шага.
    expect(playback.advance(0.25)).toBe(0);
    expect(playback.advance(0.25)).toBe(1);
    expect(playback.advance(0.25)).toBe(0);
    expect(playback.advance(0.25)).toBe(1);
  });

  it('останавливается, когда история кончилась', () => {
    let remaining = 3;
    const playback = new Playback(() => {
      remaining--;
      return remaining > 0;
    });
    playback.speed = 100;
    playback.play();
    expect(playback.advance(1)).toBe(3);
    expect(playback.playing).toBe(false);
  });

  it('не копит время, пока стоит на паузе', () => {
    const playback = new Playback(() => true);
    playback.speed = 10;
    expect(playback.advance(5)).toBe(0);
    playback.play();
    expect(playback.advance(0.1)).toBe(1);
  });

  it('сбрасывает накопитель по reset', () => {
    const playback = new Playback(() => true);
    playback.speed = 2;
    playback.play();
    playback.advance(0.4);
    playback.reset();
    expect(playback.advance(0.4)).toBe(0);
  });

  it('переключается туда и обратно', () => {
    const playback = new Playback(() => true);
    playback.toggle();
    expect(playback.playing).toBe(true);
    playback.toggle();
    expect(playback.playing).toBe(false);
  });

  it('защищён от гигантского шага времени при возврате вкладки', () => {
    let steps = 0;
    const playback = new Playback(() => {
      steps++;
      return true;
    });
    playback.speed = 8;
    playback.play();
    // Вкладка была свёрнута полчаса: не должно быть тысяч шагов за кадр.
    playback.advance(1800);
    expect(steps).toBeLessThanOrEqual(8);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run tests/web/playback.test.ts`
Expected: FAIL — не найден модуль `web/time/playback.js`.

- [ ] **Step 3: Реализовать**

`web/time/playback.ts`:

```ts
/** Ограничение на один кадр: свёрнутая вкладка не должна прокрутить всю историю. */
const MAX_STEP_SECONDS = 1;

/**
 * Воспроизведение по коммитам, а не по календарным датам: иначе полугодовой
 * перерыв в истории превращается в полминуты мёртвого экрана.
 */
export class Playback {
  /** Коммитов в секунду. */
  speed = 2;

  private running = false;
  private carry = 0;

  /** Колбэк делает один шаг и возвращает false, когда история кончилась. */
  constructor(private readonly onStep: () => boolean) {}

  get playing(): boolean {
    return this.running;
  }

  play(): void {
    this.running = true;
  }

  pause(): void {
    this.running = false;
    this.carry = 0;
  }

  toggle(): void {
    if (this.running) this.pause();
    else this.play();
  }

  /** Забывает накопленный дробный остаток — нужно после перемотки слайдером. */
  reset(): void {
    this.carry = 0;
  }

  /** Продвигает воспроизведение на прошедшее время; возвращает число шагов. */
  advance(dtSeconds: number): number {
    if (!this.running) return 0;

    this.carry += Math.min(Math.max(dtSeconds, 0), MAX_STEP_SECONDS) * this.speed;
    let steps = 0;
    while (this.carry >= 1) {
      this.carry -= 1;
      steps++;
      if (!this.onStep()) {
        this.pause();
        break;
      }
    }
    return steps;
  }
}
```

- [ ] **Step 4: Запустить тесты**

Run: `npx vitest run tests/web/playback.test.ts && npm run typecheck`
Expected: PASS, 8 тестов.

- [ ] **Step 5: Коммит**

```bash
git add -A
git commit -m "feat(time): playback with speed and frame-time clamping"
```

---

### Task 8: Гистограмма активности

Перед реализацией отрисовки **обязательно загрузи skill `dataviz`** — это визуализация данных, и в проекте есть правила на такие вещи.

**Files:**
- Create: `web/ui/histogram.ts`
- Test: `tests/web/histogram.test.ts`

**Interfaces:**
- Consumes: ничего
- Produces: `bucketCommits(ts: Uint32Array, buckets: number): Uint32Array`; `drawHistogram(canvas: HTMLCanvasElement, counts: Uint32Array): void`

- [ ] **Step 1: Написать падающий тест**

`tests/web/histogram.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { bucketCommits } from '../../web/ui/histogram.js';

describe('bucketCommits', () => {
  it('раскладывает равномерные времена по корзинам', () => {
    const counts = bucketCommits(Uint32Array.from([0, 25, 50, 75, 100]), 5);
    expect(counts.length).toBe(5);
    expect([...counts].reduce((a, b) => a + b, 0)).toBe(5);
    expect(counts[0]).toBe(1);
    expect(counts[4]).toBe(1);
  });

  it('не зависит от порядка времён', () => {
    // Даты автора немонотонны после rebase: раскладка идёт по значению.
    const sorted = bucketCommits(Uint32Array.from([10, 20, 30, 40]), 4);
    const shuffled = bucketCommits(Uint32Array.from([30, 10, 40, 20]), 4);
    expect([...shuffled]).toEqual([...sorted]);
  });

  it('кладёт последнее значение в последнюю корзину, а не за неё', () => {
    const counts = bucketCommits(Uint32Array.from([0, 100]), 4);
    expect(counts[3]).toBe(1);
    expect([...counts].reduce((a, b) => a + b, 0)).toBe(2);
  });

  it('переживает одинаковые времена', () => {
    const counts = bucketCommits(Uint32Array.from([7, 7, 7]), 3);
    expect([...counts].reduce((a, b) => a + b, 0)).toBe(3);
  });

  it('переживает пустую историю', () => {
    expect([...bucketCommits(new Uint32Array(0), 4)]).toEqual([0, 0, 0, 0]);
  });

  it('концентрирует всплеск активности в одной корзине', () => {
    const ts = Uint32Array.from([0, 100, 101, 102, 103, 104, 200]);
    const counts = bucketCommits(ts, 4);
    expect(Math.max(...counts)).toBeGreaterThanOrEqual(5);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run tests/web/histogram.test.ts`
Expected: FAIL — не найден модуль `web/ui/histogram.js`.

- [ ] **Step 3: Реализовать**

`web/ui/histogram.ts`:

```ts
/**
 * Плотность коммитов по времени. Раскладка идёт по значению времени, а не по
 * порядку в массиве: даты автора немонотонны после rebase и cherry-pick.
 */
export function bucketCommits(ts: Uint32Array, buckets: number): Uint32Array {
  const counts = new Uint32Array(buckets);
  if (ts.length === 0 || buckets <= 0) return counts;

  let min = ts[0]!;
  let max = ts[0]!;
  for (let i = 1; i < ts.length; i++) {
    if (ts[i]! < min) min = ts[i]!;
    if (ts[i]! > max) max = ts[i]!;
  }

  const span = max - min;
  if (span === 0) {
    counts[0] = ts.length;
    return counts;
  }
  for (let i = 0; i < ts.length; i++) {
    // Крайнее правое значение иначе попало бы в несуществующую корзину.
    const bucket = Math.min(buckets - 1, Math.floor(((ts[i]! - min) / span) * buckets));
    counts[bucket]++;
  }
  return counts;
}

/** Рисует плотность коммитов подложкой под слайдером. */
export function drawHistogram(canvas: HTMLCanvasElement, counts: Uint32Array): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (counts.length === 0) return;

  let peak = 0;
  for (let i = 0; i < counts.length; i++) if (counts[i]! > peak) peak = counts[i]!;
  if (peak === 0) return;

  const step = width / counts.length;
  ctx.fillStyle = '#2f3a4d';
  for (let i = 0; i < counts.length; i++) {
    // Минимум в один пиксель: полностью пустой промежуток должен отличаться
    // от промежутка с единственным коммитом.
    const barHeight = counts[i]! === 0 ? 0 : Math.max(1, (counts[i]! / peak) * height);
    ctx.fillRect(i * step, height - barHeight, Math.max(1, step - 1), barHeight);
  }
}
```

- [ ] **Step 4: Запустить тесты**

Run: `npx vitest run tests/web/histogram.test.ts && npm run typecheck`
Expected: PASS, 6 тестов.

- [ ] **Step 5: Коммит**

```bash
git add -A
git commit -m "feat(ui): commit activity histogram"
```

---

### Task 9: Панель транспорта

**Files:**
- Create: `web/ui/transport.ts`
- Modify: `web/index.html`
- Test: `tests/web/transport.test.ts`

**Interfaces:**
- Consumes: `bucketCommits`, `drawHistogram`; `Pack`
- Produces: `formatCommitLabel(pack: Pack, index: number): string`; `TransportOptions { commitCount: number; commitTs: Uint32Array; onSeek(index: number): void; onTogglePlay(): void; onSpeedChange(speed: number): void }`; `TransportHandles { setCursor(index: number, label: string): void; setPlaying(playing: boolean): void }`; `mountTransport(root: HTMLElement, options: TransportOptions): TransportHandles`

- [ ] **Step 1: Написать падающий тест**

`tests/web/transport.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatCommitLabel } from '../../web/ui/transport.js';
import { buildPack } from '../../src/model/build.js';
import type { RawCommit } from '../../src/git/types.js';

const commits: RawCommit[] = [
  {
    hash: 'aaa111bbb222',
    authorName: 'Аня',
    authorEmail: 'a@e.com',
    timestamp: 1_700_000_000,
    subject: 'первый коммит',
    changes: [{ path: 'a.txt', kind: 'add', added: 1, deleted: 0, binary: false }],
  },
  {
    hash: 'ccc333ddd444',
    authorName: 'Бо',
    authorEmail: 'b@e.com',
    timestamp: 1_700_086_400,
    subject: '',
    changes: [],
  },
];

const pack = buildPack(commits, { repoName: 'demo', head: 'ccc333' });

describe('formatCommitLabel', () => {
  it('показывает дату, хэш и тему', () => {
    const label = formatCommitLabel(pack, 0);
    expect(label).toContain('2023-11-14');
    expect(label).toContain('aaa111');
    expect(label).toContain('первый коммит');
  });

  it('переживает пустую тему', () => {
    const label = formatCommitLabel(pack, 1);
    expect(label).toContain('ccc333');
    expect(label).not.toContain('undefined');
  });

  it('сообщает о положении до начала истории', () => {
    expect(formatCommitLabel(pack, -1)).toBe('до начала истории');
  });

  it('зажимает индекс за границей истории', () => {
    expect(formatCommitLabel(pack, 999)).toBe(formatCommitLabel(pack, 1));
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run tests/web/transport.test.ts`
Expected: FAIL — не найден модуль `web/ui/transport.js`.

- [ ] **Step 3: Добавить разметку и стили**

`web/index.html` — внутри `<style>`, перед закрывающим тегом, добавить:

```css
      #transport { position: fixed; left: 12px; right: 12px; bottom: 12px;
        display: flex; align-items: center; gap: 10px; padding: 8px 12px;
        background: #161b22e6; border: 1px solid #30363d; border-radius: 8px; }
      #transport button { min-width: 34px; padding: 4px 8px; cursor: pointer;
        background: #21262d; color: #c9d1d9; border: 1px solid #30363d;
        border-radius: 5px; font: inherit; }
      #transport select { background: #21262d; color: #c9d1d9; font: inherit;
        border: 1px solid #30363d; border-radius: 5px; padding: 4px; }
      #track { position: relative; flex: 1; height: 28px; }
      #histogram { position: absolute; inset: 0; width: 100%; height: 100%; }
      #track input { position: absolute; inset: 0; width: 100%; margin: 0; }
      #cursor-label { min-width: 34ch; color: #8b949e; white-space: nowrap;
        overflow: hidden; text-overflow: ellipsis; }
```

и заменить `<canvas id="scene"></canvas>` на:

```html
    <canvas id="scene"></canvas>
    <div id="transport" hidden></div>
```

- [ ] **Step 4: Реализовать панель**

`web/ui/transport.ts`:

```ts
import type { Pack } from '../../src/model/types.js';
import { bucketCommits, drawHistogram } from './histogram.js';

export interface TransportOptions {
  commitCount: number;
  commitTs: Uint32Array;
  onSeek(index: number): void;
  onTogglePlay(): void;
  onSpeedChange(speed: number): void;
}

export interface TransportHandles {
  setCursor(index: number, label: string): void;
  setPlaying(playing: boolean): void;
}

const SPEEDS = [0.5, 1, 2, 4, 8];

/** Подпись под курсором: дата, короткий хэш и тема коммита. */
export function formatCommitLabel(pack: Pack, index: number): string {
  if (index < 0) return 'до начала истории';
  const clamped = Math.min(index, pack.meta.commitCount - 1);
  if (clamped < 0) return 'до начала истории';
  const date = new Date(pack.commitTs[clamped]! * 1000).toISOString().slice(0, 10);
  const subject = pack.commitSubject[clamped] ?? '';
  const hash = (pack.commitHash[clamped] ?? '').slice(0, 7);
  return subject.length > 0 ? `${date} · ${hash} · ${subject}` : `${date} · ${hash}`;
}

export function mountTransport(root: HTMLElement, options: TransportOptions): TransportHandles {
  root.hidden = false;
  root.replaceChildren();

  const playButton = document.createElement('button');
  playButton.type = 'button';
  playButton.textContent = '▶';
  playButton.title = 'Воспроизвести (пробел)';
  playButton.addEventListener('click', () => options.onTogglePlay());

  const speed = document.createElement('select');
  speed.title = 'Скорость: коммитов в секунду';
  for (const value of SPEEDS) {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = `${value}×`;
    if (value === 2) option.selected = true;
    speed.append(option);
  }
  speed.addEventListener('change', () => options.onSpeedChange(Number(speed.value)));

  const track = document.createElement('div');
  track.id = 'track';
  const histogram = document.createElement('canvas');
  histogram.id = 'histogram';
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '-1';
  slider.max = String(Math.max(-1, options.commitCount - 1));
  slider.step = '1';
  slider.value = String(Math.max(-1, options.commitCount - 1));
  slider.title = 'Перемотка по коммитам';
  slider.addEventListener('input', () => options.onSeek(Number(slider.value)));
  track.append(histogram, slider);

  const label = document.createElement('span');
  label.id = 'cursor-label';

  root.append(playButton, speed, track, label);

  // Гистограмма рисуется после вставки в документ: до этого у канвы нет размера.
  const redraw = () => drawHistogram(histogram, bucketCommits(options.commitTs, 120));
  redraw();
  window.addEventListener('resize', redraw);

  document.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.code !== 'Space') return;
    if (event.target instanceof HTMLElement && event.target.tagName === 'INPUT') return;
    event.preventDefault();
    options.onTogglePlay();
  });

  return {
    setCursor(index: number, text: string): void {
      slider.value = String(index);
      label.textContent = text;
    },
    setPlaying(playing: boolean): void {
      playButton.textContent = playing ? '❚❚' : '▶';
      playButton.title = playing ? 'Пауза (пробел)' : 'Воспроизвести (пробел)';
    },
  };
}
```

- [ ] **Step 5: Запустить тесты**

Run: `npx vitest run tests/web/transport.test.ts && npm run typecheck && npm run build:web`
Expected: PASS, 4 теста, сборка проходит.

- [ ] **Step 6: Коммит**

```bash
git add -A
git commit -m "feat(ui): transport bar with slider, speed and activity histogram"
```

---

### Task 10: Подключение воспроизведения и сквозной тест

**Files:**
- Modify: `web/main.ts`
- Test: `tests/e2e/playback.spec.ts`

**Interfaces:**
- Consumes: всё предыдущее
- Produces: рабочее воспроизведение на странице

- [ ] **Step 1: Написать падающий E2E-тест**

`tests/e2e/playback.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { makeRepo, cleanupRepos } from '../helpers/tmp-repo.js';

let cli: ChildProcess | null = null;

test.afterAll(async () => {
  cli?.kill('SIGTERM');
  await cleanupRepos();
});

/** Число живых узлов страница показывает в строке статуса. */
async function liveNodes(text: string | null): Promise<number> {
  const match = (text ?? '').match(/узлов: (\d+)/);
  return match ? Number(match[1]) : -1;
}

test('воспроизведение выращивает дерево, перемотка возвращает назад', async ({ page }) => {
  const repo = await makeRepo([
    { message: 'первый', write: { 'a.txt': 'a\n' } },
    { message: 'второй', write: { 'src/b.ts': 'b\n' } },
    { message: 'третий', write: { 'src/c.ts': 'c\n' } },
    { message: 'четвёртый', write: { 'src/deep/d.ts': 'd\n' } },
    { message: 'пятый', write: { 'docs/e.md': 'e\n' } },
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
  await expect(page.locator('#transport')).toBeVisible();

  // Перематываем в начало: должно остаться пусто.
  await page.locator('#track input').fill('-1');
  await expect
    .poll(async () => liveNodes(await page.locator('#status').textContent()))
    .toBe(0);

  // Запускаем воспроизведение — дерево обязано вырасти.
  await page.locator('#transport button').click();
  await expect
    .poll(async () => liveNodes(await page.locator('#status').textContent()), { timeout: 20_000 })
    .toBeGreaterThan(5);
  await expect(page.locator('#cursor-label')).toContainText('·');

  // Пауза и перемотка назад — дерево обязано уменьшиться.
  await page.locator('#transport button').click();
  await page.locator('#track input').fill('0');
  await expect
    .poll(async () => liveNodes(await page.locator('#status').textContent()))
    .toBe(2);
});
```

- [ ] **Step 2: Собрать и убедиться, что тест падает**

Run: `npm run build && npx playwright test tests/e2e/playback.spec.ts`
Expected: FAIL — панель транспорта не смонтирована, `#transport` невидим.

- [ ] **Step 3: Подключить транспорт и воспроизведение**

`web/main.ts` — добавить импорты:

```ts
import { Playback } from './time/playback.js';
import { formatCommitLabel, mountTransport } from './ui/transport.js';
```

Заменить строку `applyDelta(engine.seek(pack.meta.commitCount - 1), true);` на:

```ts
  const transportRoot = document.getElementById('transport');

  const playback = new Playback(() => {
    applyDelta(engine.step());
    return engine.cursor < pack.meta.commitCount - 1;
  });

  const handles = transportRoot
    ? mountTransport(transportRoot, {
        commitCount: pack.meta.commitCount,
        commitTs: pack.commitTs,
        onSeek: (index: number) => {
          playback.pause();
          playback.reset();
          applyDelta(engine.seek(index), true);
          syncTransport();
        },
        onTogglePlay: () => {
          // С конца истории воспроизведение начинается заново с начала.
          if (!playback.playing && engine.cursor >= pack.meta.commitCount - 1) {
            applyDelta(engine.seek(-1), true);
          }
          playback.toggle();
          syncTransport();
        },
        onSpeedChange: (value: number) => {
          playback.speed = value;
        },
      })
    : null;

  function syncTransport(): void {
    handles?.setCursor(engine.cursor, formatCommitLabel(pack, engine.cursor));
    handles?.setPlaying(playback.playing);
  }

  applyDelta(engine.seek(pack.meta.commitCount - 1), true);
  syncTransport();
```

Заменить функцию `frame` на версию, продвигающую воспроизведение:

```ts
  let lastFrameMs = performance.now();
  const frame = (nowMs: number) => {
    const dt = (nowMs - lastFrameMs) / 1000;
    lastFrameMs = nowMs;
    try {
      if (playback.advance(dt) > 0) syncTransport();
      drawScene(ctx, camera, scene, canvas.clientWidth, canvas.clientHeight);
    } catch (error) {
      showFatal(
        `Не удалось отрисовать кадр: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
```

- [ ] **Step 4: Прогнать всё**

Run: `npx vitest run && npm run typecheck && npm run build && npx playwright test`
Expected: PASS во всех четырёх, включая оба E2E-теста.

- [ ] **Step 5: Проверить вживую**

Run: `node dist/node/cli/main.js .`
Expected: открывается вкладка, снизу панель транспорта с гистограммой активности. Слайдер в начало — сцена пуста. Кнопка воспроизведения — дерево растёт по коммитам, подпись показывает дату, хэш и тему. Пробел ставит на паузу. Смена скорости ускоряет и замедляет. Перемотка назад и вперёд работает без рывков и не теряет узлы. Остановить `Ctrl+C`.

- [ ] **Step 6: Коммит**

```bash
git add -A
git commit -m "feat(web): wire playback and transport into the scene"
```

---

## Что остаётся следующим планам

- Срез 4 «Авторы»: значки контрибьюторов, лучи к затронутым файлам, вспышки узлов. Поле `touched` в `TimeDelta` для этого уже есть и заполняется.
- Срез 5 «Взаимодействие»: инспектор, фильтры-гашение, поиск, видимость поддеревьев. Здесь же переезд панелей на Preact и переход `SceneInput.color` со строк на числовую палитру — для пер-кадрового умножения на альфу строки неудобны.
- Срез 6 «Упаковка»: `--export`, предупреждение о слишком большом репозитории, перф-бюджеты на синтетическом репозитории в 50k коммитов, двойной буфер позиций вместо выделения нового массива на каждое сообщение воркера.
