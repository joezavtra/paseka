# Конвейер данных и первый кадр — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npx gource-reborn` в папке git-репозитория парсит историю, поднимает локальный сервер и показывает в браузере force-directed дерево файлов на состоянии HEAD.

**Architecture:** CLI стримингово читает `git log --raw --numstat`, собирает компактный бинарный pack (пулы строк + typed arrays + CSR-индексы), сервер отдаёт его одним запросом. Браузер декодирует pack без копирования, вычисляет живые на HEAD узлы, гоняет d3-force в Web Worker и рисует результат на canvas 2D.

**Tech Stack:** TypeScript (strict, ESM), Node 20+, Vite, d3-force, vitest, Playwright. Node-часть — только `node:`-встроенные модули, без runtime-зависимостей.

**Scope:** это первый из шести планов по спеке [2026-08-17-gource-reborn-design.md](../specs/2026-08-17-gource-reborn-design.md) — срезы 1 и 2 из раздела «Порядок реализации». Время, авторы, фильтры, видимость поддеревьев, инспектор и экспорт идут отдельными планами и здесь намеренно отсутствуют.

## Global Constraints

- Node `>=20`. `package.json` содержит `"type": "module"`.
- **Все относительные импорты пишутся с расширением `.js`** (`import { x } from './parse.js'`), даже из `.ts`-файлов. Иначе собранный Node-ESM не найдёт модули в рантайме.
- TypeScript `strict: true`. `noUncheckedIndexedAccess` **выключен** — иначе индексация typed arrays превращается в `number | undefined` и код тонет в проверках.
- В Node-части (`src/`) запрещены runtime-зависимости: только `node:`-модули. `d3-force` попадает исключительно в web-бандл.
- Тексты, адресованные пользователю, и комментарии — на русском. Идентификаторы, имена файлов, сообщения коммитов — английские.
- Vitest без `globals`: в каждом тесте явный `import { describe, it, expect } from 'vitest'`.
- Тесты живут в `tests/`, зеркалируя структуру `src/` и `web/`.
- Каждая задача заканчивается коммитом.
- Индекс пути `0` всегда зарезервирован под корень репозитория (пустая строка, директория, родитель — сам себе).
- Константа `ALIVE = 0xFFFFFFFF` означает «интервал жизни не закрыт».

## File Structure

| Файл | Ответственность |
|---|---|
| `src/git/types.ts` | Типы сырых данных из git: `RawCommit`, `RawFileChange`, `ChangeKind` |
| `src/git/parse.ts` | Аргументы `git log` и чистый стриминговый парсер его вывода |
| `src/git/repo.ts` | Обнаружение и проверка репозитория, дружелюбные ошибки |
| `src/git/log-stream.ts` | Запуск `git log` и выдача `RawCommit` асинхронным генератором |
| `src/model/types.ts` | Тип `Pack` и `PackMeta` |
| `src/model/path-table.ts` | Интернирование путей, создание директорий, дерево родителей |
| `src/model/history.ts` | Времена жизни путей и накопленные размеры файлов |
| `src/model/build.ts` | Сборка `Pack` из `RawCommit[]` |
| `src/util/rng.ts` | Детерминированный ГПСЧ; общий для воркера и тестов |
| `src/pack/encode.ts` | `Pack` → `Uint8Array` |
| `src/pack/decode.ts` | `Uint8Array` → `Pack` (работает и в браузере) |
| `src/server/serve.ts` | HTTP: статика + `/api/pack` с gzip |
| `src/cli/open-browser.ts` | Открытие вкладки на текущей платформе |
| `src/cli/main.ts` | Разбор аргументов, оркестрация, прогресс |
| `web/index.html` | Разметка: canvas и оверлей статуса |
| `web/boot.ts` | Загрузка и декодирование pack, экран ошибки |
| `web/time/alive.ts` | Живые узлы и размеры файлов на заданном коммите |
| `web/layout/protocol.ts` | Типы сообщений между главным потоком и воркером |
| `web/layout/graph.ts` | Чистое построение графа симуляции из живого множества |
| `web/layout/worker.ts` | d3-force в Web Worker |
| `web/render/camera.ts` | Преобразования мира и экрана, zoom и pan |
| `web/render/scene.ts` | Отрисовка рёбер и узлов на canvas |
| `web/main.ts` | Сборка всего вместе на странице |
| `tests/helpers/tmp-repo.ts` | Создание временного git-репозитория для тестов |

---

### Task 1: Каркас проекта и парсер вывода git

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.node.json`, `vitest.config.ts`, `.gitignore`
- Create: `src/git/types.ts`, `src/git/parse.ts`
- Test: `tests/git/parse.test.ts`

**Interfaces:**
- Consumes: ничего
- Produces: `ChangeKind = 'add' | 'modify' | 'delete'`; `RawFileChange { path: string; kind: ChangeKind; added: number; deleted: number; binary: boolean }`; `RawCommit { hash: string; authorName: string; authorEmail: string; timestamp: number; subject: string; changes: RawFileChange[] }`; `GIT_LOG_ARGS: string[]`; `parseRecord(record: string): RawCommit | null`; `class CommitParser { push(chunk: string): RawCommit[]; flush(): RawCommit[] }`

- [ ] **Step 1: Инициализировать пакет и зависимости**

```bash
cd paseka
npm init -y
npm i -D typescript vite vitest tsx @types/node d3-force @types/d3-force
```

- [ ] **Step 2: Записать конфигурацию**

`package.json` — заменить сгенерированное содержимое, сохранив блок `devDependencies`, который создал npm:

```json
{
  "name": "gource-reborn",
  "version": "0.1.0",
  "description": "Интерактивная визуализация истории git-репозитория",
  "type": "module",
  "bin": { "gource-reborn": "dist/node/cli/main.js" },
  "files": ["dist"],
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "npm run build:node && npm run build:web",
    "build:node": "tsc -p tsconfig.node.json",
    "build:web": "vite build",
    "dev": "tsx src/cli/main.ts",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable", "WebWorker"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": false,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "web", "tests", "*.config.ts"]
}
```

`tsconfig.node.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "outDir": "dist/node",
    "rootDir": "src",
    "lib": ["ES2022"],
    "types": ["node"]
  },
  "include": ["src"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 20_000,
  },
});
```

`.gitignore`:

```
node_modules/
dist/
coverage/
.vite/
test-results/
playwright-report/
```

- [ ] **Step 3: Написать типы сырых данных**

`src/git/types.ts`:

```ts
/** Что произошло с файлом в коммите. Берётся из raw-блока git log. */
export type ChangeKind = 'add' | 'modify' | 'delete';

export interface RawFileChange {
  path: string;
  kind: ChangeKind;
  /** Добавлено строк. Для бинарных файлов всегда 0. */
  added: number;
  /** Удалено строк. Для бинарных файлов всегда 0. */
  deleted: number;
  binary: boolean;
}

export interface RawCommit {
  hash: string;
  authorName: string;
  authorEmail: string;
  /** Unix-время автора в секундах. */
  timestamp: number;
  subject: string;
  changes: RawFileChange[];
}
```

- [ ] **Step 4: Написать падающий тест парсера**

`tests/git/parse.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { CommitParser, parseRecord } from '../../src/git/parse.js';

const REC = '\x01';
const FS = '\x1f';

/** Двухкоммитный лог в точности в том виде, в каком его печатает git. */
const LOG = [
  `${REC}aaa111${FS}Аня${FS}anya@example.com${FS}1700000000${FS}первый коммит`,
  ':000000 100644 0000000 f0f2307 A\ta.txt',
  ':000000 100644 0000000 587be6b A\tsrc/б.ts',
  '3\t0\ta.txt',
  '1\t0\tsrc/б.ts',
  '',
  `${REC}bbb222${FS}Bob${FS}bob@example.com${FS}1700000100${FS}`,
  ':100644 100644 f0f2307 0ddd0f3 M\ta.txt',
  ':000000 100644 0000000 8352675 A\tbin.dat',
  ':100644 000000 587be6b 0000000 D\tsrc/б.ts',
  '1\t0\ta.txt',
  '-\t-\tbin.dat',
  '0\t1\tsrc/б.ts',
].join('\n');

describe('parseRecord', () => {
  it('разбирает заголовок и файлы обычного коммита', () => {
    const record = LOG.slice(1, LOG.indexOf(REC, 1));
    const c = parseRecord(record);
    expect(c).not.toBeNull();
    expect(c!.hash).toBe('aaa111');
    expect(c!.authorName).toBe('Аня');
    expect(c!.authorEmail).toBe('anya@example.com');
    expect(c!.timestamp).toBe(1700000000);
    expect(c!.subject).toBe('первый коммит');
    expect(c!.changes).toEqual([
      { path: 'a.txt', kind: 'add', added: 3, deleted: 0, binary: false },
      { path: 'src/б.ts', kind: 'add', added: 1, deleted: 0, binary: false },
    ]);
  });

  it('различает удаление и вырезание строк, помечает бинарные файлы', () => {
    const c = parseRecord(LOG.slice(LOG.indexOf(REC, 1) + 1))!;
    expect(c.subject).toBe('');
    expect(c.changes).toEqual([
      { path: 'a.txt', kind: 'modify', added: 1, deleted: 0, binary: false },
      { path: 'bin.dat', kind: 'add', added: 0, deleted: 0, binary: true },
      { path: 'src/б.ts', kind: 'delete', added: 0, deleted: 1, binary: false },
    ]);
  });

  it('принимает коммит без изменений файлов', () => {
    const c = parseRecord(`ccc333${FS}Zoe${FS}z@e.com${FS}1700000200${FS}пустой`)!;
    expect(c.changes).toEqual([]);
  });

  it('отбрасывает запись с недостающими полями', () => {
    expect(parseRecord(`ccc333${FS}Zoe`)).toBeNull();
  });
});

describe('CommitParser', () => {
  it('собирает коммиты при любой нарезке потока на чанки', () => {
    for (const size of [1, 7, 64, 4096]) {
      const parser = new CommitParser();
      const got = [];
      for (let i = 0; i < LOG.length; i += size) {
        got.push(...parser.push(LOG.slice(i, i + size)));
      }
      got.push(...parser.flush());
      expect(got.map((c) => c.hash), `чанк ${size}`).toEqual(['aaa111', 'bbb222']);
      expect(got[1]!.changes).toHaveLength(3);
    }
  });
});
```

- [ ] **Step 5: Запустить тест и убедиться, что он падает**

Run: `npx vitest run tests/git/parse.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/git/parse.js"`.

- [ ] **Step 6: Реализовать парсер**

`src/git/parse.ts`:

```ts
import type { ChangeKind, RawCommit, RawFileChange } from './types.js';

export const RECORD_SEP = '\x01';
export const FIELD_SEP = '\x1f';

/**
 * `--raw` и `--numstat` нужны оба: numstat даёт числа строк, но не статус —
 * строка `0\t42\tpath` одинаково означает «файл удалён» и «из файла вырезали
 * 42 строки». Комбинация `--numstat --name-status` не работает: эти опции
 * перекрывают друг друга, и git печатает только один блок.
 */
export const GIT_LOG_ARGS: string[] = [
  '-c',
  'core.quotepath=false',
  'log',
  '--reverse',
  '--no-merges',
  '--no-renames',
  '--raw',
  '--numstat',
  `--pretty=format:${RECORD_SEP}%H${FIELD_SEP}%an${FIELD_SEP}%ae${FIELD_SEP}%at${FIELD_SEP}%s`,
];

function statusToKind(letter: string): ChangeKind {
  if (letter === 'A') return 'add';
  if (letter === 'D') return 'delete';
  return 'modify';
}

/** Разбирает одну запись — всё, что лежит между двумя разделителями `\x01`. */
export function parseRecord(record: string): RawCommit | null {
  const nl = record.indexOf('\n');
  const header = nl === -1 ? record : record.slice(0, nl);

  const at: number[] = [];
  let cursor = -1;
  for (let i = 0; i < 4; i++) {
    cursor = header.indexOf(FIELD_SEP, cursor + 1);
    if (cursor === -1) return null;
    at.push(cursor);
  }

  const hash = header.slice(0, at[0]);
  const timestamp = Number(header.slice(at[2] + 1, at[3]));
  if (hash.length === 0 || !Number.isFinite(timestamp)) return null;

  const changes: RawFileChange[] = [];
  const byPath = new Map<string, RawFileChange>();

  if (nl !== -1) {
    for (const line of record.slice(nl + 1).split('\n')) {
      if (line.length === 0) continue;
      const tab = line.indexOf('\t');
      if (tab === -1) continue;

      if (line.charCodeAt(0) === 58 /* ':' */) {
        // raw: `:<srcmode> <dstmode> <srcsha> <dstsha> <status>\t<path>`
        const meta = line.slice(0, tab);
        const status = meta.slice(meta.lastIndexOf(' ') + 1);
        const path = line.slice(tab + 1);
        const change: RawFileChange = {
          path,
          kind: statusToKind(status.charAt(0)),
          added: 0,
          deleted: 0,
          binary: false,
        };
        changes.push(change);
        byPath.set(path, change);
        continue;
      }

      // numstat: `<added>\t<deleted>\t<path>`, у бинарных файлов оба поля — `-`
      const tab2 = line.indexOf('\t', tab + 1);
      if (tab2 === -1) continue;
      const addedText = line.slice(0, tab);
      const deletedText = line.slice(tab + 1, tab2);
      const path = line.slice(tab2 + 1);
      const binary = addedText === '-';
      const existing = byPath.get(path);
      const target =
        existing ??
        (() => {
          // numstat без парного raw-блока не встречался, но терять файл нельзя
          const c: RawFileChange = { path, kind: 'modify', added: 0, deleted: 0, binary: false };
          changes.push(c);
          byPath.set(path, c);
          return c;
        })();
      target.binary = binary;
      target.added = binary ? 0 : Number(addedText) || 0;
      target.deleted = binary ? 0 : Number(deletedText) || 0;
    }
  }

  return {
    hash,
    authorName: header.slice(at[0] + 1, at[1]),
    authorEmail: header.slice(at[1] + 1, at[2]),
    timestamp,
    subject: header.slice(at[3] + 1),
    changes,
  };
}

/**
 * Стриминговый разбор: держит в памяти только хвост незавершённой записи.
 * Вызывающий обязан завершить работу вызовом `flush()`.
 */
export class CommitParser {
  private buffer = '';

  push(chunk: string): RawCommit[] {
    this.buffer += chunk;
    const out: RawCommit[] = [];
    let start = this.buffer.indexOf(RECORD_SEP);
    if (start === -1) return out;
    for (;;) {
      const next = this.buffer.indexOf(RECORD_SEP, start + 1);
      if (next === -1) break;
      const commit = parseRecord(this.buffer.slice(start + 1, next));
      if (commit) out.push(commit);
      start = next;
    }
    this.buffer = this.buffer.slice(start);
    return out;
  }

  flush(): RawCommit[] {
    const out: RawCommit[] = [];
    if (this.buffer.startsWith(RECORD_SEP)) {
      const commit = parseRecord(this.buffer.slice(1));
      if (commit) out.push(commit);
    }
    this.buffer = '';
    return out;
  }
}
```

- [ ] **Step 7: Запустить тесты и типизацию**

Run: `npx vitest run tests/git/parse.test.ts && npm run typecheck`
Expected: PASS, 5 тестов зелёные, `tsc` молчит.

- [ ] **Step 8: Коммит**

```bash
git add -A
git commit -m "feat(git): streaming parser for git log --raw --numstat"
```

---

### Task 2: Запуск git и стриминг коммитов

**Files:**
- Create: `src/git/repo.ts`, `src/git/log-stream.ts`
- Create: `tests/helpers/tmp-repo.ts`
- Test: `tests/git/log-stream.test.ts`

**Interfaces:**
- Consumes: `GIT_LOG_ARGS`, `CommitParser`, `RawCommit` из Task 1
- Produces: `class RepoError extends Error`; `RepoInfo { root: string; name: string; head: string; shallow: boolean }`; `inspectRepo(cwd: string): Promise<RepoInfo>`; `streamCommits(root: string): AsyncGenerator<RawCommit>`; тестовый хелпер `makeRepo(commits: FixtureCommit[]): Promise<string>` с `FixtureCommit { message: string; author?: { name: string; email: string }; write?: Record<string, string>; writeBinary?: Record<string, number[]>; remove?: string[] }`

- [ ] **Step 1: Написать хелпер временного репозитория**

`tests/helpers/tmp-repo.ts`:

```ts
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, realpath, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface FixtureCommit {
  message: string;
  author?: { name: string; email: string };
  write?: Record<string, string>;
  writeBinary?: Record<string, number[]>;
  remove?: string[];
}

const created: string[] = [];

/**
 * Создаёт временный репозиторий с заданной историей. Время коммитов детерминировано.
 * Путь канонизируется: на macOS `/var` и `/tmp` — симлинки в `/private`, mkdtemp
 * возвращает путь со ссылкой, а `git rev-parse --show-toplevel` — всегда настоящий.
 * Без realpath сравнение корня репозитория со строкой из git никогда не сойдётся.
 */
export async function makeRepo(commits: FixtureCommit[]): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'gource-reborn-')));
  created.push(root);
  const git = (args: string[], env: NodeJS.ProcessEnv = {}) =>
    run('git', args, { cwd: root, env: { ...process.env, ...env } });

  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.name', 'Fixture']);
  await git(['config', 'user.email', 'fixture@example.com']);

  let stamp = 1_700_000_000;
  for (const commit of commits) {
    for (const [path, text] of Object.entries(commit.write ?? {})) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), text);
    }
    for (const [path, bytes] of Object.entries(commit.writeBinary ?? {})) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), Buffer.from(bytes));
    }
    for (const path of commit.remove ?? []) {
      await git(['rm', '-q', '-f', path]);
    }
    await git(['add', '-A']);
    const date = `${stamp} +0000`;
    stamp += 100;
    await git(
      ['commit', '-q', '--allow-empty', '-m', commit.message],
      {
        GIT_AUTHOR_NAME: commit.author?.name ?? 'Fixture',
        GIT_AUTHOR_EMAIL: commit.author?.email ?? 'fixture@example.com',
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_NAME: 'Fixture',
        GIT_COMMITTER_EMAIL: 'fixture@example.com',
        GIT_COMMITTER_DATE: date,
      },
    );
  }
  return root;
}

/** Вызывается из глобального afterAll в тестах, которые создают репозитории. */
export async function cleanupRepos(): Promise<void> {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
}
```

- [ ] **Step 2: Написать падающий тест стриминга**

`tests/git/log-stream.test.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { join } from 'node:path';
import { inspectRepo, RepoError } from '../../src/git/repo.js';
import { streamCommits } from '../../src/git/log-stream.js';
import { makeRepo, cleanupRepos } from '../helpers/tmp-repo.js';
import type { RawCommit } from '../../src/git/types.js';

afterAll(cleanupRepos);

async function collect(root: string): Promise<RawCommit[]> {
  const out: RawCommit[] = [];
  for await (const commit of streamCommits(root)) out.push(commit);
  return out;
}

describe('streamCommits', () => {
  it('отдаёт коммиты от старых к новым с правильными статусами', async () => {
    const root = await makeRepo([
      { message: 'первый', write: { 'a.txt': 'l1\nl2\nl3\n', 'src/b.ts': 'x\n' } },
      {
        message: 'второй',
        author: { name: 'Бо', email: 'bo@example.com' },
        write: { 'a.txt': 'l1\nl2\nl3\nl4\n' },
        writeBinary: { 'bin.dat': [0, 1, 2] },
        remove: ['src/b.ts'],
      },
    ]);

    const commits = await collect(root);
    expect(commits).toHaveLength(2);
    expect(commits[0]!.subject).toBe('первый');
    expect(commits[0]!.changes.map((c) => [c.path, c.kind])).toEqual([
      ['a.txt', 'add'],
      ['src/b.ts', 'add'],
    ]);

    expect(commits[1]!.authorEmail).toBe('bo@example.com');
    const second = new Map(commits[1]!.changes.map((c) => [c.path, c]));
    expect(second.get('src/b.ts')!.kind).toBe('delete');
    expect(second.get('bin.dat')!.binary).toBe(true);
    expect(second.get('a.txt')!.added).toBe(1);
  });

  it('переживает пустой коммит', async () => {
    const root = await makeRepo([
      { message: 'первый', write: { 'a.txt': 'x\n' } },
      { message: 'пустой' },
    ]);
    const commits = await collect(root);
    expect(commits).toHaveLength(2);
    expect(commits[1]!.changes).toEqual([]);
  });
});

describe('inspectRepo', () => {
  it('возвращает корень, имя и HEAD', async () => {
    const root = await makeRepo([{ message: 'первый', write: { 'a.txt': 'x\n' } }]);
    const info = await inspectRepo(join(root, '.'));
    expect(info.root).toBe(root);
    expect(info.head).toMatch(/^[0-9a-f]{7,}$/);
    expect(info.shallow).toBe(false);
  });

  it('внятно ругается, если это не репозиторий', async () => {
    await expect(inspectRepo('/')).rejects.toBeInstanceOf(RepoError);
  });
});
```

- [ ] **Step 3: Запустить тест и убедиться, что он падает**

Run: `npx vitest run tests/git/log-stream.test.ts`
Expected: FAIL — модули `src/git/repo.js` и `src/git/log-stream.js` не найдены.

- [ ] **Step 4: Реализовать обнаружение репозитория**

`src/git/repo.ts`:

```ts
import { execFile } from 'node:child_process';
import { basename, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Ошибка с текстом, который не стыдно показать пользователю в терминале. */
export class RepoError extends Error {}

export interface RepoInfo {
  root: string;
  name: string;
  head: string;
  shallow: boolean;
}

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await run('git', args, { cwd, maxBuffer: 1 << 20 });
    return stdout.trim();
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stderr?: string };
    if (err.code === 'ENOENT') {
      throw new RepoError('git не найден в PATH. Установите git и повторите.');
    }
    // `??` тут не годится: пустая строка — валидное значение stderr и прошла бы
    // фильтр, оставив пользователя с RepoError без текста.
    const stderrText = err.stderr?.trim();
    throw new RepoError(stderrText ? stderrText : err.message.trim());
  }
}

export async function inspectRepo(cwd: string): Promise<RepoInfo> {
  const dir = resolve(cwd);
  let root: string;
  try {
    root = await git(dir, ['rev-parse', '--show-toplevel']);
  } catch (error) {
    throw new RepoError(
      `${dir} не является git-репозиторием. Запустите gource-reborn внутри репозитория ` +
        'или укажите путь к нему аргументом.',
    );
  }

  let head: string;
  try {
    head = await git(root, ['rev-parse', '--short', 'HEAD']);
  } catch {
    throw new RepoError('В репозитории нет ни одного коммита — визуализировать нечего.');
  }

  const shallow = (await git(root, ['rev-parse', '--is-shallow-repository'])) === 'true';
  return { root, name: basename(root), head, shallow };
}
```

- [ ] **Step 5: Реализовать стриминг**

`src/git/log-stream.ts`:

```ts
import { spawn } from 'node:child_process';
import { CommitParser, GIT_LOG_ARGS } from './parse.js';
import { RepoError } from './repo.js';
import type { RawCommit } from './types.js';

/**
 * Читает историю репозитория, не удерживая вывод git целиком:
 * stdout приходит чанками, парсер держит только хвост незавершённой записи.
 */
export async function* streamCommits(root: string): AsyncGenerator<RawCommit> {
  const child = spawn('git', GIT_LOG_ARGS, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');

  let stderr = '';
  child.stderr.on('data', (chunk: string) => {
    if (stderr.length < 4096) stderr += chunk;
  });

  // `exit` никогда не отклоняется: ошибка спавна запоминается в `spawnError`,
  // а промис в любом случае резолвится. Иначе при ENOENT/EACCES реджект случится
  // раньше, чем кто-либо начнёт ждать `exit` (см. цикл чтения stdout ниже), и
  // Node сочтёт его необработанным ещё до того, как мы дойдём до `await exit`.
  let spawnError: RepoError | null = null;
  const exit = new Promise<number>((resolveExit) => {
    child.on('error', (error: NodeJS.ErrnoException) => {
      spawnError =
        error.code === 'ENOENT'
          ? new RepoError('git не найден в PATH. Установите git и повторите.')
          : new RepoError(error.message);
      resolveExit(-1);
    });
    child.on('close', (code) => resolveExit(code ?? 0));
  });

  // Ошибка чтения stdout (например, поток оборвался) запоминается, а не
  // пробрасывается сразу: причина обрыва может быть в неудачном спавне —
  // тогда приоритет у `spawnError`, — а может быть и самостоятельной проблемой
  // при штатном коде возврата. Разбираем это ниже, после `await exit`, чтобы
  // не выдать тихий успех с оборванной историей коммитов.
  const parser = new CommitParser();
  let streamError: unknown = null;
  try {
    for await (const chunk of child.stdout as AsyncIterable<string>) {
      yield* parser.push(chunk);
    }
  } catch (error) {
    streamError = error;
  } finally {
    if (child.exitCode === null) child.kill();
  }

  const code = await exit;
  // Порядок проверки — по убыванию определённости причины: сначала сбой
  // самого спавна, затем явный ненулевой код завершения git, и только потом
  // ошибка чтения потока при формально успешном (код 0) завершении.
  if (spawnError) throw spawnError;
  if (code !== 0) {
    throw new RepoError(`git log завершился с кодом ${code}:\n${stderr.trim()}`);
  }
  if (streamError) {
    const message = streamError instanceof Error ? streamError.message : String(streamError);
    throw new RepoError(`Чтение вывода git log прервалось: ${message}`);
  }
  yield* parser.flush();
}
```

- [ ] **Step 6: Запустить тесты**

Run: `npx vitest run tests/git && npm run typecheck`
Expected: PASS, 9 тестов зелёные.

- [ ] **Step 7: Коммит**

```bash
git add -A
git commit -m "feat(git): repo inspection and streaming commit reader"
```

---

### Task 3: Таблица путей и дерево директорий

**Files:**
- Create: `src/model/path-table.ts`
- Test: `tests/model/path-table.test.ts`

**Interfaces:**
- Consumes: ничего
- Produces: `class PathTable` с полями `paths: string[]`, `parent: number[]`, `isDir: number[]` и методами `intern(path: string): number`, `size(): number`. Индекс `0` — корень (`''`).

- [ ] **Step 1: Написать падающий тест**

`tests/model/path-table.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PathTable } from '../../src/model/path-table.js';

describe('PathTable', () => {
  it('заводит корень под индексом 0', () => {
    const t = new PathTable();
    expect(t.size()).toBe(1);
    expect(t.paths[0]).toBe('');
    expect(t.parent[0]).toBe(0);
    expect(t.isDir[0]).toBe(1);
  });

  it('создаёт все промежуточные директории', () => {
    const t = new PathTable();
    const id = t.intern('src/a/b.ts');
    expect(t.paths).toEqual(['', 'src', 'src/a', 'src/a/b.ts']);
    expect(t.isDir).toEqual([1, 1, 1, 0]);
    expect(t.parent[id]).toBe(2);
    expect(t.parent[2]).toBe(1);
    expect(t.parent[1]).toBe(0);
  });

  it('возвращает тот же идентификатор при повторном обращении', () => {
    const t = new PathTable();
    expect(t.intern('a/b.ts')).toBe(t.intern('a/b.ts'));
    expect(t.size()).toBe(3);
  });

  it('переиспользует общие директории', () => {
    const t = new PathTable();
    t.intern('src/a.ts');
    t.intern('src/b.ts');
    expect(t.paths).toEqual(['', 'src', 'src/a.ts', 'src/b.ts']);
  });

  it('нормализует ведущий ./ и двойные слэши', () => {
    const t = new PathTable();
    const a = t.intern('./src//a.ts');
    expect(t.paths[a]).toBe('src/a.ts');
    expect(t.intern('src/a.ts')).toBe(a);
  });

  it('возвращает корень для пустого пути', () => {
    const t = new PathTable();
    expect(t.intern('')).toBe(0);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run tests/model/path-table.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Реализовать**

`src/model/path-table.ts`:

```ts
/**
 * Интернирует пути файлов и попутно строит дерево директорий.
 * Директории получают собственные идентификаторы: рендер рисует их как узлы,
 * а движок времени считает их живыми, пока жив хотя бы один потомок.
 */
export class PathTable {
  /** Полные пути; индекс в этом массиве и есть идентификатор пути. */
  readonly paths: string[] = [''];
  /** Идентификатор родителя; у корня родитель — он сам. */
  readonly parent: number[] = [0];
  /** 1 для директорий, 0 для файлов. */
  readonly isDir: number[] = [1];

  private readonly index = new Map<string, number>([['', 0]]);

  size(): number {
    return this.paths.length;
  }

  /** Возвращает идентификатор файла, создавая недостающие директории по пути. */
  intern(path: string): number {
    const normalized = normalize(path);
    const known = this.index.get(normalized);
    if (known !== undefined) return known;

    const cut = normalized.lastIndexOf('/');
    const parentId = cut === -1 ? 0 : this.internDir(normalized.slice(0, cut));
    return this.add(normalized, parentId, 0);
  }

  private internDir(path: string): number {
    const known = this.index.get(path);
    if (known !== undefined) {
      // Путь, хоть раз выступивший родителем, — директория, и это необратимо.
      // В истории репозитория файл без расширения вполне может смениться
      // директорией того же имени (`docs` → `docs/guide.md`), а мы храним
      // объединение всех путей за всё время: без этой строки узел навсегда
      // остался бы помечен файлом, уже имея потомков.
      this.isDir[known] = 1;
      return known;
    }
    const cut = path.lastIndexOf('/');
    const parentId = cut === -1 ? 0 : this.internDir(path.slice(0, cut));
    return this.add(path, parentId, 1);
  }

  private add(path: string, parentId: number, dir: number): number {
    const id = this.paths.length;
    this.paths.push(path);
    this.parent.push(parentId);
    this.isDir.push(dir);
    this.index.set(path, id);
    return id;
  }
}

function normalize(path: string): string {
  let out = path;
  while (out.startsWith('./')) out = out.slice(2);
  out = out.replace(/\/{2,}/g, '/');
  if (out.endsWith('/')) out = out.slice(0, -1);
  return out;
}
```

- [ ] **Step 4: Запустить тесты**

Run: `npx vitest run tests/model/path-table.test.ts`
Expected: PASS, 6 тестов.

- [ ] **Step 5: Коммит**

```bash
git add -A
git commit -m "feat(model): path interning with directory tree"
```

---

### Task 4: Времена жизни путей и накопленные размеры

**Files:**
- Create: `src/model/history.ts`
- Test: `tests/model/history.test.ts`

**Interfaces:**
- Consumes: ничего
- Produces: `const ALIVE = 0xffffffff`; `const KIND_ADD = 0`, `KIND_MODIFY = 1`, `KIND_DELETE = 2`; `PathHistoryInput { pathCount: number; eventPath: Uint32Array; eventCommit: Uint32Array; eventKind: Uint8Array; eventAdded: Uint32Array; eventDeleted: Uint32Array }`; `PathHistory { pathEventStart: Uint32Array; pathEventIdx: Uint32Array; pathEventLines: Int32Array; lifetimeStart: Uint32Array; lifetimeBirth: Uint32Array; lifetimeDeath: Uint32Array }`; `buildPathHistory(input: PathHistoryInput): PathHistory`

- [ ] **Step 1: Написать падающий тест**

`tests/model/history.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  ALIVE,
  KIND_ADD,
  KIND_DELETE,
  KIND_MODIFY,
  buildPathHistory,
} from '../../src/model/history.js';

/** Компактная запись событий: [путь, коммит, вид, добавлено, удалено]. */
function input(rows: number[][], pathCount: number) {
  return {
    pathCount,
    eventPath: Uint32Array.from(rows.map((r) => r[0]!)),
    eventCommit: Uint32Array.from(rows.map((r) => r[1]!)),
    eventKind: Uint8Array.from(rows.map((r) => r[2]!)),
    eventAdded: Uint32Array.from(rows.map((r) => r[3]!)),
    eventDeleted: Uint32Array.from(rows.map((r) => r[4]!)),
  };
}

describe('buildPathHistory', () => {
  it('группирует события по путям в порядке коммитов', () => {
    const h = buildPathHistory(
      input(
        [
          [1, 0, KIND_ADD, 10, 0],
          [2, 0, KIND_ADD, 5, 0],
          [1, 1, KIND_MODIFY, 3, 1],
        ],
        3,
      ),
    );
    expect([...h.pathEventStart]).toEqual([0, 0, 2, 3]);
    expect([...h.pathEventIdx]).toEqual([0, 2, 1]);
  });

  it('копит размер файла и обнуляет его на удалении', () => {
    const h = buildPathHistory(
      input(
        [
          [1, 0, KIND_ADD, 10, 0],
          [1, 1, KIND_MODIFY, 4, 1],
          [1, 2, KIND_DELETE, 0, 13],
        ],
        2,
      ),
    );
    expect([...h.pathEventLines]).toEqual([10, 13, 0]);
  });

  it('не даёт размеру уйти в минус', () => {
    const h = buildPathHistory(
      input(
        [
          [1, 0, KIND_ADD, 2, 0],
          [1, 1, KIND_MODIFY, 0, 99],
        ],
        2,
      ),
    );
    expect([...h.pathEventLines]).toEqual([2, 0]);
  });

  it('строит два интервала для сценария создан → удалён → создан заново', () => {
    const h = buildPathHistory(
      input(
        [
          [1, 0, KIND_ADD, 10, 0],
          [1, 3, KIND_DELETE, 0, 10],
          [1, 7, KIND_ADD, 4, 0],
        ],
        2,
      ),
    );
    expect([...h.lifetimeStart]).toEqual([0, 0, 2]);
    expect([...h.lifetimeBirth]).toEqual([0, 7]);
    expect([...h.lifetimeDeath]).toEqual([3, ALIVE]);
  });

  it('считает рождением первое событие, даже если это modify', () => {
    const h = buildPathHistory(input([[1, 5, KIND_MODIFY, 1, 1]], 2));
    expect([...h.lifetimeBirth]).toEqual([5]);
    expect([...h.lifetimeDeath]).toEqual([ALIVE]);
  });

  it('игнорирует удаление уже мёртвого пути', () => {
    const h = buildPathHistory(
      input(
        [
          [1, 0, KIND_ADD, 1, 0],
          [1, 1, KIND_DELETE, 0, 1],
          [1, 2, KIND_DELETE, 0, 0],
        ],
        2,
      ),
    );
    expect([...h.lifetimeBirth]).toEqual([0]);
    expect([...h.lifetimeDeath]).toEqual([1]);
  });

  it('работает на пустом наборе событий', () => {
    const h = buildPathHistory(input([], 3));
    expect([...h.pathEventStart]).toEqual([0, 0, 0, 0]);
    expect(h.lifetimeBirth).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run tests/model/history.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Реализовать**

`src/model/history.ts`:

```ts
export const KIND_ADD = 0;
export const KIND_MODIFY = 1;
export const KIND_DELETE = 2;

/** Маркер незакрытого интервала жизни: путь дожил до конца истории. */
export const ALIVE = 0xffffffff;

export interface PathHistoryInput {
  pathCount: number;
  eventPath: Uint32Array;
  eventCommit: Uint32Array;
  eventKind: Uint8Array;
  eventAdded: Uint32Array;
  eventDeleted: Uint32Array;
}

export interface PathHistory {
  /** CSR-смещения: события пути p лежат в [start[p], start[p+1]). */
  pathEventStart: Uint32Array;
  /** Индексы в глобальных массивах событий, по возрастанию коммита. */
  pathEventIdx: Uint32Array;
  /** Размер файла в строках сразу после соответствующего события. */
  pathEventLines: Int32Array;
  /** CSR-смещения интервалов жизни. */
  lifetimeStart: Uint32Array;
  lifetimeBirth: Uint32Array;
  /** Индекс коммита, в котором путь умер, либо ALIVE. */
  lifetimeDeath: Uint32Array;
}

/**
 * Раскладывает плоский список событий по путям и выводит из него две вещи,
 * на которых стоит вся визуализация: когда путь существовал и какого он был
 * размера в каждый момент.
 */
export function buildPathHistory(input: PathHistoryInput): PathHistory {
  const { pathCount, eventPath, eventCommit, eventKind, eventAdded, eventDeleted } = input;
  const eventCount = eventPath.length;

  // Сортировка подсчётом: события уже идут в порядке коммитов, поэтому
  // раскладка по путям сохраняет хронологию внутри каждого пути.
  const pathEventStart = new Uint32Array(pathCount + 1);
  for (let i = 0; i < eventCount; i++) pathEventStart[eventPath[i] + 1]++;
  for (let p = 0; p < pathCount; p++) pathEventStart[p + 1] += pathEventStart[p];

  const cursor = pathEventStart.slice(0, pathCount);
  const pathEventIdx = new Uint32Array(eventCount);
  for (let i = 0; i < eventCount; i++) {
    pathEventIdx[cursor[eventPath[i]]++] = i;
  }

  const pathEventLines = new Int32Array(eventCount);
  const lifetimeStart = new Uint32Array(pathCount + 1);
  const births: number[] = [];
  const deaths: number[] = [];

  for (let p = 0; p < pathCount; p++) {
    lifetimeStart[p] = births.length;
    let lines = 0;
    let openInterval = -1;

    for (let k = pathEventStart[p]; k < pathEventStart[p + 1]; k++) {
      const e = pathEventIdx[k];
      const kind = eventKind[e];
      const commit = eventCommit[e];

      if (kind === KIND_DELETE) {
        if (openInterval !== -1) {
          deaths[openInterval] = commit;
          openInterval = -1;
        }
        lines = 0;
      } else {
        if (openInterval === -1) {
          // Рождением считаем и modify: при обрезанной истории (shallow clone)
          // первое известное событие файла вполне может быть изменением.
          openInterval = births.length;
          births.push(commit);
          deaths.push(ALIVE);
          lines = 0;
        }
        lines = kind === KIND_ADD ? eventAdded[e] : lines + eventAdded[e] - eventDeleted[e];
        if (lines < 0) lines = 0;
      }
      pathEventLines[k] = lines;
    }
  }
  lifetimeStart[pathCount] = births.length;

  return {
    pathEventStart,
    pathEventIdx,
    pathEventLines,
    lifetimeStart,
    lifetimeBirth: Uint32Array.from(births),
    lifetimeDeath: Uint32Array.from(deaths),
  };
}
```

- [ ] **Step 4: Запустить тесты**

Run: `npx vitest run tests/model/history.test.ts && npm run typecheck`
Expected: PASS, 7 тестов.

- [ ] **Step 5: Коммит**

```bash
git add -A
git commit -m "feat(model): path lifetimes and cumulative file sizes"
```

---

### Task 5: Сборка Pack

**Files:**
- Create: `src/model/types.ts`, `src/model/build.ts`
- Test: `tests/model/build.test.ts`

**Interfaces:**
- Consumes: `PathTable` (Task 3), `buildPathHistory` и константы видов (Task 4), `RawCommit` (Task 1)
- Produces: `PackMeta { repoName: string; head: string; commitCount: number; pathCount: number; firstTs: number; lastTs: number }`; `Author { name: string; email: string }`; интерфейс `Pack` со всеми полями (см. ниже); `FLAG_BINARY = 1`; `buildPack(commits: RawCommit[], opts: { repoName: string; head: string }): Pack`

- [ ] **Step 1: Написать падающий тест**

`tests/model/build.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildPack } from '../../src/model/build.js';
import { ALIVE, KIND_ADD, KIND_DELETE } from '../../src/model/history.js';
import { FLAG_BINARY } from '../../src/model/types.js';
import type { RawCommit } from '../../src/git/types.js';

const commits: RawCommit[] = [
  {
    hash: 'aaa111',
    authorName: 'Аня',
    authorEmail: 'anya@example.com',
    timestamp: 100,
    subject: 'первый',
    changes: [
      { path: 'src/a.ts', kind: 'add', added: 10, deleted: 0, binary: false },
      { path: 'README.md', kind: 'add', added: 2, deleted: 0, binary: false },
    ],
  },
  {
    hash: 'bbb222',
    authorName: 'Бо',
    authorEmail: 'bo@example.com',
    timestamp: 200,
    subject: 'второй',
    changes: [
      { path: 'src/a.ts', kind: 'delete', added: 0, deleted: 10, binary: false },
      { path: 'logo.png', kind: 'add', added: 0, deleted: 0, binary: true },
    ],
  },
];

describe('buildPack', () => {
  it('заполняет метаданные', () => {
    const pack = buildPack(commits, { repoName: 'demo', head: 'bbb222' });
    expect(pack.meta).toEqual({
      repoName: 'demo',
      head: 'bbb222',
      commitCount: 2,
      pathCount: pack.paths.length,
      firstTs: 100,
      lastTs: 200,
    });
  });

  it('строит пул путей вместе с директориями', () => {
    const pack = buildPack(commits, { repoName: 'demo', head: 'bbb222' });
    expect(pack.paths).toEqual(['', 'src', 'src/a.ts', 'README.md', 'logo.png']);
    expect([...pack.pathIsDir]).toEqual([1, 1, 0, 0, 0]);
    expect(pack.pathParent[2]).toBe(1);
  });

  it('дедуплицирует авторов по email', () => {
    const pack = buildPack([...commits, { ...commits[0]!, hash: 'ccc333', timestamp: 300 }], {
      repoName: 'demo',
      head: 'ccc333',
    });
    expect(pack.authors.map((a) => a.email)).toEqual(['anya@example.com', 'bo@example.com']);
    expect([...pack.commitAuthor]).toEqual([0, 1, 0]);
  });

  it('раскладывает события в CSR по коммитам', () => {
    const pack = buildPack(commits, { repoName: 'demo', head: 'bbb222' });
    expect([...pack.commitEventStart]).toEqual([0, 2, 4]);
    expect([...pack.eventCommit]).toEqual([0, 0, 1, 1]);
    expect([...pack.eventKind]).toEqual([KIND_ADD, KIND_ADD, KIND_DELETE, KIND_ADD]);
  });

  it('помечает бинарные файлы флагом', () => {
    const pack = buildPack(commits, { repoName: 'demo', head: 'bbb222' });
    const png = pack.paths.indexOf('logo.png');
    const event = [...pack.eventPath].indexOf(png);
    expect(pack.eventFlags[event] & FLAG_BINARY).toBe(FLAG_BINARY);
  });

  it('прокидывает времена жизни из history', () => {
    const pack = buildPack(commits, { repoName: 'demo', head: 'bbb222' });
    const a = pack.paths.indexOf('src/a.ts');
    const readme = pack.paths.indexOf('README.md');
    expect(pack.lifetimeDeath[pack.lifetimeStart[a]]).toBe(1);
    expect(pack.lifetimeDeath[pack.lifetimeStart[readme]]).toBe(ALIVE);
  });

  it('переживает пустую историю', () => {
    const pack = buildPack([], { repoName: 'empty', head: '0000000' });
    expect(pack.meta.commitCount).toBe(0);
    expect(pack.paths).toEqual(['']);
    expect([...pack.commitEventStart]).toEqual([0]);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run tests/model/build.test.ts`
Expected: FAIL — модули не найдены.

- [ ] **Step 3: Описать тип Pack**

`src/model/types.ts`:

```ts
/** Бинарный файл: в numstat вместо чисел стоят прочерки. */
export const FLAG_BINARY = 1;

export interface PackMeta {
  repoName: string;
  head: string;
  commitCount: number;
  pathCount: number;
  /** Unix-секунды первого и последнего коммита. */
  firstTs: number;
  lastTs: number;
}

export interface Author {
  name: string;
  email: string;
}

/**
 * Всё, что браузеру нужно знать о репозитории. Строки живут в пулах,
 * числа — в typed arrays, связи «один-ко-многим» — в CSR (offsets + плоский
 * массив). Никаких объектов на элемент: на 50k коммитов их было бы полмиллиона.
 */
export interface Pack {
  meta: PackMeta;

  /** Пул путей; индекс 0 — корень репозитория. */
  paths: string[];
  pathParent: Uint32Array;
  pathIsDir: Uint8Array;

  authors: Author[];

  commitTs: Uint32Array;
  commitAuthor: Uint32Array;
  commitHash: string[];
  commitSubject: string[];
  /** CSR: события коммита c лежат в [commitEventStart[c], commitEventStart[c+1]). */
  commitEventStart: Uint32Array;

  eventPath: Uint32Array;
  eventCommit: Uint32Array;
  eventKind: Uint8Array;
  eventAdded: Uint32Array;
  eventDeleted: Uint32Array;
  eventFlags: Uint8Array;

  /** CSR по путям, см. buildPathHistory. */
  pathEventStart: Uint32Array;
  pathEventIdx: Uint32Array;
  pathEventLines: Int32Array;
  lifetimeStart: Uint32Array;
  lifetimeBirth: Uint32Array;
  lifetimeDeath: Uint32Array;
}
```

- [ ] **Step 4: Реализовать сборку**

`src/model/build.ts`:

```ts
import type { RawCommit } from '../git/types.js';
import { KIND_ADD, KIND_DELETE, KIND_MODIFY, buildPathHistory } from './history.js';
import { PathTable } from './path-table.js';
import { FLAG_BINARY, type Author, type Pack } from './types.js';

export interface BuildOptions {
  repoName: string;
  head: string;
}

const KIND_BY_NAME = { add: KIND_ADD, modify: KIND_MODIFY, delete: KIND_DELETE } as const;

export function buildPack(commits: RawCommit[], opts: BuildOptions): Pack {
  const table = new PathTable();

  const authors: Author[] = [];
  const authorIndex = new Map<string, number>();

  const commitTs: number[] = [];
  const commitAuthor: number[] = [];
  const commitHash: string[] = [];
  const commitSubject: string[] = [];
  const commitEventStart: number[] = [0];

  const eventPath: number[] = [];
  const eventCommit: number[] = [];
  const eventKind: number[] = [];
  const eventAdded: number[] = [];
  const eventDeleted: number[] = [];
  const eventFlags: number[] = [];

  for (let c = 0; c < commits.length; c++) {
    const commit = commits[c]!;

    // Ключ нормализуем, а хранимый email — нет: разные git-клиенты пишут почту
    // в разном регистре, и без этого один человек распался бы на двух авторов.
    // В пул при этом кладём написание из первого вхождения — данные не переписываем.
    const authorKey = commit.authorEmail.trim().toLowerCase();
    let authorId = authorIndex.get(authorKey);
    if (authorId === undefined) {
      authorId = authors.length;
      authors.push({ name: commit.authorName, email: commit.authorEmail });
      authorIndex.set(authorKey, authorId);
    }

    commitTs.push(commit.timestamp);
    commitAuthor.push(authorId);
    commitHash.push(commit.hash.slice(0, 10));
    commitSubject.push(commit.subject.slice(0, 200));

    for (const change of commit.changes) {
      eventPath.push(table.intern(change.path));
      eventCommit.push(c);
      eventKind.push(KIND_BY_NAME[change.kind]);
      eventAdded.push(change.added);
      eventDeleted.push(change.deleted);
      eventFlags.push(change.binary ? FLAG_BINARY : 0);
    }
    commitEventStart.push(eventPath.length);
  }

  const pathCount = table.size();
  const history = buildPathHistory({
    pathCount,
    eventPath: Uint32Array.from(eventPath),
    eventCommit: Uint32Array.from(eventCommit),
    eventKind: Uint8Array.from(eventKind),
    eventAdded: Uint32Array.from(eventAdded),
    eventDeleted: Uint32Array.from(eventDeleted),
  });

  return {
    meta: {
      repoName: opts.repoName,
      head: opts.head,
      commitCount: commits.length,
      pathCount,
      firstTs: commitTs.length > 0 ? commitTs[0]! : 0,
      lastTs: commitTs.length > 0 ? commitTs[commitTs.length - 1]! : 0,
    },
    paths: table.paths.slice(),
    pathParent: Uint32Array.from(table.parent),
    pathIsDir: Uint8Array.from(table.isDir),
    authors,
    commitTs: Uint32Array.from(commitTs),
    commitAuthor: Uint32Array.from(commitAuthor),
    commitHash,
    commitSubject,
    commitEventStart: Uint32Array.from(commitEventStart),
    eventPath: Uint32Array.from(eventPath),
    eventCommit: Uint32Array.from(eventCommit),
    eventKind: Uint8Array.from(eventKind),
    eventAdded: Uint32Array.from(eventAdded),
    eventDeleted: Uint32Array.from(eventDeleted),
    eventFlags: Uint8Array.from(eventFlags),
    ...history,
  };
}
```

- [ ] **Step 5: Запустить тесты**

Run: `npx vitest run tests/model && npm run typecheck`
Expected: PASS, 13 тестов.

- [ ] **Step 6: Коммит**

```bash
git add -A
git commit -m "feat(model): assemble Pack from raw commits"
```

---

### Task 6: CLI со сводкой по репозиторию

**Files:**
- Create: `src/cli/main.ts`
- Test: `tests/cli/stats.test.ts`

**Interfaces:**
- Consumes: `inspectRepo`, `streamCommits`, `buildPack`
- Produces: `parseArgs(argv: string[]): CliOptions` с `CliOptions { repoPath: string; port: number; open: boolean; stats: boolean }`; `collectPack(repoPath: string, onProgress?: (n: number) => void): Promise<Pack>`; `formatStats(pack: Pack): string`; `run(argv: string[]): Promise<number>`

- [ ] **Step 1: Написать падающий тест**

`tests/cli/stats.test.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { collectPack, formatStats, parseArgs, run } from '../../src/cli/main.js';
import { makeRepo, cleanupRepos } from '../helpers/tmp-repo.js';

afterAll(cleanupRepos);

describe('parseArgs', () => {
  it('по умолчанию берёт текущую папку и открывает браузер', () => {
    const o = parseArgs([]);
    expect(o.repoPath).toBe(process.cwd());
    expect(o.open).toBe(true);
    expect(o.stats).toBe(false);
  });

  it('читает путь и флаги', () => {
    const o = parseArgs(['/tmp/x', '--port', '9000', '--no-open', '--stats']);
    expect(o).toEqual({ repoPath: '/tmp/x', port: 9000, open: false, stats: true, help: false });
  });

  it('не трогает репозиторий при --help', async () => {
    expect(await run(['--help', '/does/not/exist'])).toBe(0);
  });
});

describe('collectPack', () => {
  it('собирает pack из настоящего репозитория', async () => {
    const root = await makeRepo([
      { message: 'первый', write: { 'src/a.ts': 'x\ny\n', 'README.md': 'hi\n' } },
      { message: 'второй', remove: ['src/a.ts'] },
    ]);

    const pack = await collectPack(root);
    expect(pack.meta.commitCount).toBe(2);
    expect(pack.paths).toContain('README.md');
    expect(pack.paths).toContain('src/a.ts');

    const summary = formatStats(pack);
    expect(summary).toContain('коммитов: 2');
    expect(summary).toContain('авторов: 1');
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run tests/cli/stats.test.ts`
Expected: FAIL — модуль `src/cli/main.js` не найден.

- [ ] **Step 3: Реализовать CLI**

`src/cli/main.ts`:

```ts
import { realpathSync } from 'node:fs';
import { parseArgs as parseNodeArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { inspectRepo, RepoError } from '../git/repo.js';
import { streamCommits } from '../git/log-stream.js';
import { buildPack } from '../model/build.js';
import type { Pack } from '../model/types.js';
import type { RawCommit } from '../git/types.js';

export interface CliOptions {
  repoPath: string;
  port: number;
  open: boolean;
  stats: boolean;
  help: boolean;
}

const USAGE = `gource-reborn — интерактивная визуализация истории git

  npx gource-reborn [путь]

  --port <n>   порт локального сервера (по умолчанию 7420)
  --no-open    не открывать браузер
  --stats      напечатать сводку и выйти
  --help       показать эту справку
`;

export function parseArgs(argv: string[]): CliOptions {
  const { values, positionals } = parseNodeArgs({
    args: argv,
    allowPositionals: true,
    options: {
      port: { type: 'string' },
      open: { type: 'boolean', default: true },
      // node:util parseArgs не умеет автоматически превращать булев флаг
      // `open` в отрицание по `--no-open` — заводим отдельную опцию и
      // объединяем значения вручную.
      'no-open': { type: 'boolean', default: false },
      stats: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });

  return {
    repoPath: positionals[0] ?? process.cwd(),
    port: values.port ? Number(values.port) : 7420,
    open: values['no-open'] ? false : values.open !== false,
    stats: values.stats === true,
    help: values.help === true,
  };
}

/** Читает историю репозитория и собирает pack, сообщая о прогрессе. */
export async function collectPack(
  repoPath: string,
  onProgress?: (commits: number) => void,
): Promise<Pack> {
  const info = await inspectRepo(repoPath);
  if (info.shallow) {
    process.stderr.write(
      'Предупреждение: репозиторий склонирован частично (shallow), история обрезана.\n',
    );
  }

  const commits: RawCommit[] = [];
  for await (const commit of streamCommits(info.root)) {
    commits.push(commit);
    if (onProgress && commits.length % 500 === 0) onProgress(commits.length);
  }
  onProgress?.(commits.length);

  return buildPack(commits, { repoName: info.name, head: info.head });
}

export function formatStats(pack: Pack): string {
  const files = [...pack.pathIsDir].filter((d) => d === 0).length;
  const span =
    pack.meta.commitCount > 0
      ? `${new Date(pack.meta.firstTs * 1000).toISOString().slice(0, 10)} — ` +
        `${new Date(pack.meta.lastTs * 1000).toISOString().slice(0, 10)}`
      : '—';
  return [
    `репозиторий: ${pack.meta.repoName} (${pack.meta.head})`,
    `коммитов: ${pack.meta.commitCount}`,
    `авторов: ${pack.authors.length}`,
    `путей: ${pack.meta.pathCount} (файлов: ${files})`,
    `изменений файлов: ${pack.eventPath.length}`,
    `период: ${span}`,
  ].join('\n');
}

export async function run(argv: string[]): Promise<number> {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  try {
    const pack = await collectPack(options.repoPath, (n) => {
      process.stderr.write(`\rпрочитано коммитов: ${n}`);
    });
    process.stderr.write('\r\x1b[K');
    process.stdout.write(`${formatStats(pack)}\n`);
    return 0;
  } catch (error) {
    if (error instanceof RepoError) {
      process.stderr.write(`${error.message}\n`);
      return 1;
    }
    throw error;
  }
}

/**
 * Определяет, запущен ли модуль напрямую как исполняемый файл (а не
 * импортирован тестами). Сравнивать `import.meta.url` с сырым
 * `process.argv[1]` нельзя: npm ставит бинарники симлинками
 * (`bin.gource-reborn` в package.json), `process.argv[1]` при запуске через
 * симлинк остаётся путём симлинка, а `import.meta.url` резолвится в
 * реальный путь файла — строки никогда не совпадут. Поэтому разыменовываем
 * оба пути перед сравнением; любая неудача (файла нет, путь не задан)
 * означает «не главный модуль», а не падение CLI.
 */
function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  run(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
```

- [ ] **Step 4: Запустить тесты**

Run: `npx vitest run && npm run typecheck`
Expected: PASS, все тесты зелёные.

- [ ] **Step 5: Проверить CLI вживую на этом же репозитории**

Run: `npx tsx src/cli/main.ts . --stats`
Expected: печатается сводка — имя репозитория, число коммитов, авторов, путей.

- [ ] **Step 6: Коммит**

```bash
git add -A
git commit -m "feat(cli): repository summary command"
```

---

### Task 7: Кодек pack

**Files:**
- Create: `src/util/rng.ts`, `src/pack/encode.ts`, `src/pack/decode.ts`
- Test: `tests/pack/codec.test.ts`

**Interfaces:**
- Consumes: `Pack` (Task 5)
- Produces: `makeRng(seed: number): () => number`; `PACK_VERSION = 1`; `encodePack(pack: Pack): Uint8Array`; `class PackError extends Error`; `decodePack(bytes: Uint8Array): Pack`

- [ ] **Step 1: Написать детерминированный ГПСЧ**

Модуль общий: его используют и property-тесты, и воркер симуляции (Task 11).
Зависимостей от `node:` в нём нет, поэтому он спокойно попадает в web-бандл.

`src/util/rng.ts`:

```ts
/**
 * mulberry32 — крошечный детерминированный генератор.
 * Math.random() запрещён и в тестах (падение должно воспроизводиться),
 * и в раскладке графа (два запуска на репозитории должны давать похожую картинку).
 */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

- [ ] **Step 2: Написать падающий тест**

`tests/pack/codec.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { encodePack } from '../../src/pack/encode.js';
import { decodePack, PackError } from '../../src/pack/decode.js';
import { buildPack } from '../../src/model/build.js';
import { makeRng } from '../../src/util/rng.js';
import type { RawCommit } from '../../src/git/types.js';
import type { Pack } from '../../src/model/types.js';

function randomCommits(seed: number, count: number): RawCommit[] {
  const rng = makeRng(seed);
  const files = ['a.txt', 'src/b.ts', 'src/deep/c.ts', 'docs/d.md', 'logo.png'];
  const commits: RawCommit[] = [];
  const alive = new Set<string>();

  for (let i = 0; i < count; i++) {
    const changes = [];
    for (const path of files) {
      if (rng() < 0.5) continue;
      const isAlive = alive.has(path);
      const kind = !isAlive ? 'add' : rng() < 0.2 ? 'delete' : 'modify';
      if (kind === 'add') alive.add(path);
      if (kind === 'delete') alive.delete(path);
      changes.push({
        path,
        kind: kind as 'add' | 'modify' | 'delete',
        added: Math.floor(rng() * 40),
        deleted: Math.floor(rng() * 20),
        binary: path.endsWith('.png'),
      });
    }
    commits.push({
      hash: `hash${i.toString(16).padStart(6, '0')}`,
      authorName: rng() < 0.5 ? 'Аня' : 'Bob',
      authorEmail: rng() < 0.5 ? 'anya@example.com' : 'bob@example.com',
      timestamp: 1_700_000_000 + i * 60,
      subject: `коммит №${i} — тест ${'x'.repeat(i % 7)}`,
      changes,
    });
  }
  return commits;
}

const TYPED_FIELDS: (keyof Pack)[] = [
  'pathParent', 'pathIsDir', 'commitTs', 'commitAuthor', 'commitEventStart',
  'eventPath', 'eventCommit', 'eventKind', 'eventAdded', 'eventDeleted', 'eventFlags',
  'pathEventStart', 'pathEventIdx', 'pathEventLines',
  'lifetimeStart', 'lifetimeBirth', 'lifetimeDeath',
];

function expectSamePack(a: Pack, b: Pack): void {
  expect(b.meta).toEqual(a.meta);
  expect(b.paths).toEqual(a.paths);
  expect(b.authors).toEqual(a.authors);
  expect(b.commitHash).toEqual(a.commitHash);
  expect(b.commitSubject).toEqual(a.commitSubject);
  for (const field of TYPED_FIELDS) {
    const left = a[field] as ArrayLike<number>;
    const right = b[field] as ArrayLike<number>;
    expect(Array.from(right), String(field)).toEqual(Array.from(left));
  }
}

describe('кодек pack', () => {
  it('переживает round-trip на случайных историях', () => {
    for (const seed of [1, 2, 3, 42, 1337]) {
      const pack = buildPack(randomCommits(seed, 40), { repoName: 'демо', head: 'abc1234' });
      expectSamePack(pack, decodePack(encodePack(pack)));
    }
  });

  it('переживает round-trip на пустой истории', () => {
    const pack = buildPack([], { repoName: 'empty', head: '0000000' });
    expectSamePack(pack, decodePack(encodePack(pack)));
  });

  it('декодирует из невыровненного среза буфера', () => {
    const pack = buildPack(randomCommits(7, 10), { repoName: 'демо', head: 'abc1234' });
    const encoded = encodePack(pack);
    const padded = new Uint8Array(encoded.length + 3);
    padded.set(encoded, 3);
    expectSamePack(pack, decodePack(padded.subarray(3)));
  });

  it('отвергает чужие данные', () => {
    expect(() => decodePack(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])))
      .toThrow(PackError);
  });

  // Порча собственного формата обязана давать PackError с внятным текстом,
  // а не RangeError из конструктора typed array: обрыв ответа сервера,
  // пакет от другой сборки и подобное попадут на экран ошибки в браузере.
  describe('порча данных', () => {
    const pack = buildPack(randomCommits(11, 20), { repoName: 'демо', head: 'abc1234' });

    /** Пересобирает пакет с изменённым JSON-заголовком. */
    function corruptHeader(mutate: (header: Record<string, unknown>) => void): Uint8Array {
      const encoded = encodePack(pack);
      const view = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength);
      const headerLength = view.getUint32(8, true);
      const header = JSON.parse(
        new TextDecoder().decode(encoded.subarray(12, 12 + headerLength)),
      ) as Record<string, unknown>;
      mutate(header);

      const headerBytes = new TextEncoder().encode(JSON.stringify(header));
      const dataStart = (12 + headerBytes.length + 3) & ~3;
      const oldDataStart = (12 + headerLength + 3) & ~3;
      const out = new Uint8Array(dataStart + (encoded.length - oldDataStart));
      out.set(encoded.subarray(0, 12), 0);
      new DataView(out.buffer).setUint32(8, headerBytes.length, true);
      out.set(headerBytes, 12);
      out.set(encoded.subarray(oldDataStart), dataStart);
      return out;
    }

    it('отвергает усечённый буфер', () => {
      const encoded = encodePack(pack);
      expect(() => decodePack(encoded.subarray(0, encoded.length - 5))).toThrow(PackError);
    });

    it('отвергает заголовок без списка секций', () => {
      expect(() => decodePack(corruptHeader((h) => delete h.sections))).toThrow(PackError);
    });

    it('отвергает секцию с завышенной длиной', () => {
      expect(() =>
        decodePack(
          corruptHeader((h) => {
            (h.sections as { length: number }[])[0]!.length = 999_999;
          }),
        ),
      ).toThrow(PackError);
    });

    it('отвергает заголовок с потерянной секцией', () => {
      expect(() =>
        decodePack(
          corruptHeader((h) => {
            (h.sections as unknown[]).splice(0, 1);
          }),
        ),
      ).toThrow(PackError);
    });
  });
});
```

- [ ] **Step 3: Запустить тест и убедиться, что он падает**

Run: `npx vitest run tests/pack/codec.test.ts`
Expected: FAIL — модули не найдены.

- [ ] **Step 4: Реализовать кодирование**

`src/pack/encode.ts`:

```ts
import type { Pack } from '../model/types.js';

export const PACK_VERSION = 1;
export const MAGIC = [0x47, 0x52, 0x50, 0x4b]; // GRPK
export const HEADER_OFFSET = 12;

/** Порядок секций фиксирован: он же определяет раскладку файла. */
export const SECTION_FIELDS = [
  'pathParent', 'pathIsDir', 'commitTs', 'commitAuthor', 'commitEventStart',
  'eventPath', 'eventCommit', 'eventKind', 'eventAdded', 'eventDeleted', 'eventFlags',
  'pathEventStart', 'pathEventIdx', 'pathEventLines',
  'lifetimeStart', 'lifetimeBirth', 'lifetimeDeath',
] as const;

export type SectionField = (typeof SECTION_FIELDS)[number];
export type SectionKind = 'u8' | 'u32' | 'i32';

export interface SectionDescriptor {
  name: SectionField;
  kind: SectionKind;
  length: number;
  offset: number;
}

export function align4(n: number): number {
  return (n + 3) & ~3;
}

function kindOf(array: Uint8Array | Uint32Array | Int32Array): SectionKind {
  if (array instanceof Uint8Array) return 'u8';
  if (array instanceof Int32Array) return 'i32';
  return 'u32';
}

/**
 * Раскладка: `GRPK` | версия u32 | длина заголовка u32 | JSON-заголовок |
 * выравнивание до 4 | секции подряд, каждая выровнена на 4 байта.
 * Строки (пути, хэши, subject) живут в JSON-заголовке, числа — в секциях,
 * поэтому декодирование не копирует горячие данные.
 */
export function encodePack(pack: Pack): Uint8Array {
  const sections: SectionDescriptor[] = [];
  let dataLength = 0;
  for (const name of SECTION_FIELDS) {
    const array = pack[name];
    sections.push({ name, kind: kindOf(array), length: array.length, offset: dataLength });
    dataLength += align4(array.byteLength);
  }

  const headerBytes = new TextEncoder().encode(
    JSON.stringify({
      meta: pack.meta,
      paths: pack.paths,
      authors: pack.authors,
      commitHash: pack.commitHash,
      commitSubject: pack.commitSubject,
      sections,
    }),
  );

  const dataStart = align4(HEADER_OFFSET + headerBytes.length);
  const out = new Uint8Array(dataStart + dataLength);
  out.set(MAGIC, 0);
  const view = new DataView(out.buffer);
  view.setUint32(4, PACK_VERSION, true);
  view.setUint32(8, headerBytes.length, true);
  out.set(headerBytes, HEADER_OFFSET);

  for (const section of sections) {
    const array = pack[section.name];
    out.set(
      new Uint8Array(array.buffer, array.byteOffset, array.byteLength),
      dataStart + section.offset,
    );
  }
  return out;
}
```

- [ ] **Step 5: Реализовать декодирование**

`src/pack/decode.ts`:

```ts
import type { Author, Pack, PackMeta } from '../model/types.js';
import {
  HEADER_OFFSET,
  MAGIC,
  PACK_VERSION,
  SECTION_FIELDS,
  align4,
  type SectionDescriptor,
} from './encode.js';

export class PackError extends Error {}

interface PackHeader {
  meta: PackMeta;
  paths: string[];
  authors: Author[];
  commitHash: string[];
  commitSubject: string[];
  sections: SectionDescriptor[];
}

export function decodePack(input: Uint8Array): Pack {
  // Секции выровнены на 4 байта относительно начала pack, поэтому невыровненный
  // срез (например, кусок сетевого буфера) ломает создание typed array.
  const bytes = input.byteOffset % 4 === 0 ? input : new Uint8Array(input);

  if (bytes.length < HEADER_OFFSET || MAGIC.some((b, i) => bytes[i] !== b)) {
    throw new PackError('Это не файл данных gource-reborn.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(4, true);
  if (version !== PACK_VERSION) {
    throw new PackError(`Неподдерживаемая версия данных: ${version}. Пересоберите визуализацию.`);
  }

  const headerLength = view.getUint32(8, true);
  let header: PackHeader;
  try {
    header = JSON.parse(
      new TextDecoder().decode(bytes.subarray(HEADER_OFFSET, HEADER_OFFSET + headerLength)),
    ) as PackHeader;
  } catch {
    throw new PackError('Заголовок данных повреждён.');
  }

  // Порченый заголовок от другой сборки может вообще не содержать sections —
  // без этой проверки итерация ниже падает сырым TypeError.
  if (!Array.isArray(header.sections)) {
    throw new PackError('Заголовок данных повреждён: отсутствует список секций. Пересоберите визуализацию.');
  }

  const dataStart = align4(HEADER_OFFSET + headerLength);
  // Граница данных отсчитывается от dataStart на уже (при необходимости)
  // скопированном буфере bytes, а не от исходного input.
  const dataLength = bytes.length - dataStart;

  const read = (section: SectionDescriptor) => {
    const bytesPerElement = section.kind === 'u8' ? 1 : 4;
    const byteLength = section.length * bytesPerElement;
    // Без этой проверки испорченная или завышенная длина секции ломает
    // конструктор typed array сырым RangeError вместо понятного PackError.
    // Обрыв ответа сервера выглядит именно так.
    if (
      typeof section.offset !== 'number' ||
      typeof section.length !== 'number' ||
      section.offset < 0 ||
      byteLength < 0 ||
      section.offset + byteLength > dataLength
    ) {
      throw new PackError(
        `Заголовок данных повреждён: секция «${section.name}» выходит за границы файла. Пересоберите визуализацию.`,
      );
    }
    const at = bytes.byteOffset + dataStart + section.offset;
    if (section.kind === 'u8') return new Uint8Array(bytes.buffer, at, section.length);
    if (section.kind === 'i32') return new Int32Array(bytes.buffer, at, section.length);
    return new Uint32Array(bytes.buffer, at, section.length);
  };

  const arrays = {} as Record<SectionDescriptor['name'], ReturnType<typeof read>>;
  for (const section of header.sections) {
    arrays[section.name] = read(section);
  }

  // Заголовок мог описывать не все обязательные секции (например, файл от
  // более старой сборки) — без этой проверки Pack тихо уедет с undefined
  // в одном из typed-array полей, и падение обнаружится позже и не там.
  const missing = SECTION_FIELDS.filter((name) => !(name in arrays));
  if (missing.length > 0) {
    throw new PackError(
      `Заголовок данных повреждён: отсутствуют обязательные секции (${missing.join(', ')}). Пересоберите визуализацию.`,
    );
  }

  return {
    meta: header.meta,
    paths: header.paths,
    authors: header.authors,
    commitHash: header.commitHash,
    commitSubject: header.commitSubject,
    pathParent: arrays.pathParent as Uint32Array,
    pathIsDir: arrays.pathIsDir as Uint8Array,
    commitTs: arrays.commitTs as Uint32Array,
    commitAuthor: arrays.commitAuthor as Uint32Array,
    commitEventStart: arrays.commitEventStart as Uint32Array,
    eventPath: arrays.eventPath as Uint32Array,
    eventCommit: arrays.eventCommit as Uint32Array,
    eventKind: arrays.eventKind as Uint8Array,
    eventAdded: arrays.eventAdded as Uint32Array,
    eventDeleted: arrays.eventDeleted as Uint32Array,
    eventFlags: arrays.eventFlags as Uint8Array,
    pathEventStart: arrays.pathEventStart as Uint32Array,
    pathEventIdx: arrays.pathEventIdx as Uint32Array,
    pathEventLines: arrays.pathEventLines as Int32Array,
    lifetimeStart: arrays.lifetimeStart as Uint32Array,
    lifetimeBirth: arrays.lifetimeBirth as Uint32Array,
    lifetimeDeath: arrays.lifetimeDeath as Uint32Array,
  };
}
```

- [ ] **Step 6: Запустить тесты**

Run: `npx vitest run tests/pack && npm run typecheck`
Expected: PASS, 8 тестов.

- [ ] **Step 7: Коммит**

```bash
git add -A
git commit -m "feat(pack): binary codec for Pack"
```

---

### Task 8: HTTP-сервер

**Files:**
- Create: `src/server/serve.ts`
- Test: `tests/server/serve.test.ts`

**Interfaces:**
- Consumes: ничего из предыдущих задач напрямую (получает готовые байты)
- Produces: `ServeOptions { webRoot: string; port: number; getPack: () => Promise<Uint8Array> }`; `RunningServer { url: string; port: number; close(): Promise<void> }`; `startServer(options: ServeOptions): Promise<RunningServer>`

- [ ] **Step 1: Написать падающий тест**

`tests/server/serve.test.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer, type RunningServer } from '../../src/server/serve.js';

const running: RunningServer[] = [];
afterAll(async () => {
  await Promise.all(running.map((s) => s.close()));
});

async function makeWebRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gr-web-'));
  await writeFile(join(dir, 'index.html'), '<!doctype html><title>ok</title>');
  return dir;
}

describe('startServer', () => {
  it('отдаёт pack и статику', async () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const server = await startServer({
      webRoot: await makeWebRoot(),
      port: 0,
      getPack: async () => payload,
    });
    running.push(server);

    const packResponse = await fetch(`${server.url}/api/pack`);
    expect(packResponse.status).toBe(200);
    expect(new Uint8Array(await packResponse.arrayBuffer())).toEqual(payload);

    const indexResponse = await fetch(`${server.url}/`);
    expect(await indexResponse.text()).toContain('<title>ok</title>');
    expect(indexResponse.headers.get('content-type')).toContain('text/html');
  });

  it('не выпускает за пределы webRoot', async () => {
    const server = await startServer({
      webRoot: await makeWebRoot(),
      port: 0,
      getPack: async () => new Uint8Array(),
    });
    running.push(server);
    const response = await fetch(`${server.url}/../../etc/passwd`);
    expect(response.status).toBe(404);
  });

  it('занимает следующий свободный порт, если указанный занят', async () => {
    const webRoot = await makeWebRoot();
    const first = await startServer({ webRoot, port: 0, getPack: async () => new Uint8Array() });
    running.push(first);
    const second = await startServer({
      webRoot,
      port: first.port,
      getPack: async () => new Uint8Array(),
    });
    running.push(second);
    expect(second.port).not.toBe(first.port);
  });

  it('сжимает пакет один раз при параллельных запросах', async () => {
    let calls = 0;
    const server = await startServer({
      webRoot: await makeWebRoot(),
      port: 0,
      getPack: async () => {
        calls++;
        await new Promise((done) => setTimeout(done, 20));
        return new Uint8Array([1, 2, 3, 4]);
      },
    });
    running.push(server);

    const [a, b] = await Promise.all([
      fetch(`${server.url}/api/pack`).then((r) => r.arrayBuffer()),
      fetch(`${server.url}/api/pack`).then((r) => r.arrayBuffer()),
    ]);
    expect(calls).toBe(1);
    expect(new Uint8Array(a!)).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(new Uint8Array(b!)).toEqual(new Uint8Array(a!));
  });

  it('пробует снова, если сборка пакета упала', async () => {
    let attempt = 0;
    const server = await startServer({
      webRoot: await makeWebRoot(),
      port: 0,
      getPack: async () => {
        attempt++;
        if (attempt === 1) throw new Error('сборка не удалась');
        return new Uint8Array([7, 7, 7]);
      },
    });
    running.push(server);

    expect((await fetch(`${server.url}/api/pack`)).status).toBe(500);
    const second = await fetch(`${server.url}/api/pack`);
    expect(second.status).toBe(200);
    expect(new Uint8Array(await second.arrayBuffer())).toEqual(new Uint8Array([7, 7, 7]));
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run tests/server/serve.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Реализовать сервер**

`src/server/serve.ts`:

```ts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { AddressInfo } from 'node:net';

export interface ServeOptions {
  webRoot: string;
  /** 0 — попросить свободный порт у системы. */
  port: number;
  getPack: () => Promise<Uint8Array>;
}

export interface RunningServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

/** Сколько соседних портов пробовать, если запрошенный занят. */
const PORT_ATTEMPTS = 20;

export async function startServer(options: ServeOptions): Promise<RunningServer> {
  // Кэшируем именно промис вычисления, а не готовый буфер: между проверкой
  // на null и присваиванием стоит await, и без этого два параллельных запроса
  // к /api/pack успевают оба увидеть пустой кэш и оба запустить сжатие.
  // Если getPack() падает, промис сбрасывается — иначе кэш «залипает»
  // в сломанном состоянии и следующий запрос никогда не попробует снова.
  let packGzip: Promise<Buffer> | null = null;

  function getPackGzip(): Promise<Buffer> {
    packGzip ??= (async () => gzipSync(await options.getPack()))().catch((error: unknown) => {
      packGzip = null;
      throw error;
    });
    return packGzip;
  }

  const server = createServer((request, response) => {
    handle(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://localhost');

    if (url.pathname === '/api/pack') {
      const body = await getPackGzip();
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-encoding': 'gzip',
        'cache-control': 'no-store',
        'content-length': String(body.length),
      });
      response.end(body);
      return;
    }

    const relative = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    const target = resolve(join(options.webRoot, relative === '/' ? 'index.html' : relative));
    if (target !== resolve(options.webRoot) && !target.startsWith(resolve(options.webRoot) + sep)) {
      response.writeHead(404).end('not found');
      return;
    }

    try {
      const body = await readFile(target);
      const dot = target.lastIndexOf('.');
      response.writeHead(200, {
        'content-type': MIME[target.slice(dot)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      });
      response.end(body);
    } catch {
      response.writeHead(404).end('not found');
    }
  }

  const port = await listen(server, options.port);
  return {
    port,
    url: `http://localhost:${port}`,
    close: () =>
      new Promise((done) => {
        server.close(() => done());
      }),
  };
}

function listen(server: ReturnType<typeof createServer>, wanted: number): Promise<number> {
  return new Promise((done, fail) => {
    let attempt = 0;
    const tryPort = (port: number) => {
      const onError = (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE' && attempt < PORT_ATTEMPTS && port !== 0) {
          attempt++;
          tryPort(port + 1);
          return;
        }
        fail(error);
      };
      server.once('error', onError);
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', onError);
        done((server.address() as AddressInfo).port);
      });
    };
    tryPort(wanted);
  });
}
```

- [ ] **Step 4: Запустить тесты**

Run: `npx vitest run tests/server && npm run typecheck`
Expected: PASS, 5 тестов.

- [ ] **Step 5: Коммит**

```bash
git add -A
git commit -m "feat(server): static hosting and gzipped pack endpoint"
```

---

### Task 9: Веб-каркас и загрузка pack

**Files:**
- Create: `vite.config.ts`, `web/index.html`, `web/boot.ts`, `web/main.ts`
- Test: `tests/web/boot.test.ts`

**Interfaces:**
- Consumes: `decodePack`, `PackError` (Task 7), `Pack` (Task 5)
- Produces: `loadPack(url?: string): Promise<Pack>`; `describePack(pack: Pack): string`; `showFatal(message: string): void`

- [ ] **Step 1: Написать падающий тест**

`tests/web/boot.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { describePack } from '../../web/boot.js';
import { buildPack } from '../../src/model/build.js';
import type { RawCommit } from '../../src/git/types.js';

const commits: RawCommit[] = [
  {
    hash: 'aaa111',
    authorName: 'Аня',
    authorEmail: 'anya@example.com',
    timestamp: 1_700_000_000,
    subject: 'первый',
    changes: [{ path: 'src/a.ts', kind: 'add', added: 4, deleted: 0, binary: false }],
  },
];

describe('describePack', () => {
  it('описывает репозиторий одной строкой', () => {
    const text = describePack(buildPack(commits, { repoName: 'demo', head: 'aaa111' }));
    expect(text).toContain('demo');
    expect(text).toContain('1 коммит');
    expect(text).toContain('1 файл');
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run tests/web/boot.test.ts`
Expected: FAIL — модуль `web/boot.js` не найден.

- [ ] **Step 3: Написать конфигурацию Vite и разметку**

`vite.config.ts`:

```ts
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  base: './',
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    target: 'es2022',
  },
  worker: { format: 'es' },
});
```

`web/index.html`:

```html
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>gource-reborn</title>
    <style>
      :root { color-scheme: dark; }
      html, body { margin: 0; height: 100%; background: #0b0d12; color: #c9d1d9;
        font: 13px/1.5 ui-sans-serif, system-ui, sans-serif; overflow: hidden; }
      #scene { display: block; width: 100vw; height: 100vh; }
      #status { position: fixed; left: 12px; bottom: 12px; padding: 6px 10px;
        background: #161b22cc; border: 1px solid #30363d; border-radius: 6px; }
      #status[hidden] { display: none; }
      .fatal { color: #ff7b72; max-width: 60ch; }
    </style>
  </head>
  <body>
    <canvas id="scene"></canvas>
    <div id="status">Читаю историю репозитория…</div>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

- [ ] **Step 4: Реализовать загрузку**

`web/boot.ts`:

```ts
import { decodePack, PackError } from '../src/pack/decode.js';
import type { Pack } from '../src/model/types.js';

/** Русское склонение для счётных подписей: 1 коммит, 2 коммита, 5 коммитов. */
function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${n} ${many}`;
  if (mod10 === 1) return `${n} ${one}`;
  if (mod10 >= 2 && mod10 <= 4) return `${n} ${few}`;
  return `${n} ${many}`;
}

export function describePack(pack: Pack): string {
  let files = 0;
  for (let i = 0; i < pack.pathIsDir.length; i++) if (pack.pathIsDir[i] === 0) files++;
  return (
    `${pack.meta.repoName} · ${plural(pack.meta.commitCount, 'коммит', 'коммита', 'коммитов')} · ` +
    `${plural(files, 'файл', 'файла', 'файлов')} · ` +
    `${plural(pack.authors.length, 'автор', 'автора', 'авторов')}`
  );
}

export async function loadPack(url = './api/pack'): Promise<Pack> {
  // Перехватываем только сам запрос: типичный сбой — страница осталась
  // открытой, а CLI остановили по Ctrl+C, и тогда fetch бросает свою
  // ошибку с английским текстом браузера. Ошибки декодирования уже несут
  // осмысленные русские сообщения, заворачивать их второй раз нельзя.
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new PackError(
      `Потеряна связь с локальным сервером — он, вероятно, уже остановлен. ` +
        `Перезапустите команду и откройте страницу заново. (${detail})`,
    );
  }
  if (!response.ok) {
    throw new PackError(`Сервер ответил ${response.status} на запрос данных.`);
  }
  return decodePack(new Uint8Array(await response.arrayBuffer()));
}

export function showFatal(message: string): void {
  const status = document.getElementById('status');
  if (!status) return;
  status.hidden = false;
  status.className = 'fatal';
  status.textContent = message;
}
```

- [ ] **Step 5: Написать точку входа**

`web/main.ts`:

```ts
import { describePack, loadPack, showFatal } from './boot.js';

async function start(): Promise<void> {
  const status = document.getElementById('status');
  try {
    const pack = await loadPack();
    if (status) status.textContent = describePack(pack);
  } catch (error) {
    showFatal(error instanceof Error ? error.message : 'Не удалось загрузить данные.');
  }
}

void start();
```

- [ ] **Step 6: Запустить тесты и сборку**

Run: `npx vitest run tests/web && npm run build:web && npm run typecheck`
Expected: PASS; Vite кладёт бандл в `dist/web/index.html`.

- [ ] **Step 7: Коммит**

```bash
git add -A
git commit -m "feat(web): page shell and pack loading"
```

---

### Task 10: Живые узлы и размеры на заданном коммите

**Files:**
- Create: `web/time/alive.ts`
- Test: `tests/web/alive.test.ts`

**Interfaces:**
- Consumes: `Pack` (Task 5), `ALIVE` (Task 4)
- Produces: `aliveAt(pack: Pack, commitIndex: number): Uint8Array` (длина `pathCount`, 1 — живой); `sizesAt(pack: Pack, commitIndex: number): Int32Array` (строк в файле; для директорий 0)

- [ ] **Step 1: Написать падающий тест**

`tests/web/alive.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { aliveAt, sizesAt } from '../../web/time/alive.js';
import { buildPack } from '../../src/model/build.js';
import type { RawCommit } from '../../src/git/types.js';

function commit(hash: string, ts: number, changes: RawCommit['changes']): RawCommit {
  return {
    hash,
    authorName: 'Аня',
    authorEmail: 'anya@example.com',
    timestamp: ts,
    subject: hash,
    changes,
  };
}

const pack = buildPack(
  [
    commit('c0', 100, [
      { path: 'src/a.ts', kind: 'add', added: 10, deleted: 0, binary: false },
      { path: 'README.md', kind: 'add', added: 2, deleted: 0, binary: false },
    ]),
    commit('c1', 200, [
      { path: 'src/a.ts', kind: 'modify', added: 5, deleted: 1, binary: false },
    ]),
    commit('c2', 300, [
      { path: 'src/a.ts', kind: 'delete', added: 0, deleted: 14, binary: false },
    ]),
    commit('c3', 400, [
      { path: 'src/a.ts', kind: 'add', added: 3, deleted: 0, binary: false },
    ]),
  ],
  { repoName: 'demo', head: 'c3' },
);

const id = (path: string) => pack.paths.indexOf(path);

describe('aliveAt', () => {
  it('оживляет файлы с их первого коммита', () => {
    const alive = aliveAt(pack, 0);
    expect(alive[id('src/a.ts')]).toBe(1);
    expect(alive[id('README.md')]).toBe(1);
  });

  it('хоронит файл в коммите удаления и воскрешает при повторном создании', () => {
    expect(aliveAt(pack, 1)[id('src/a.ts')]).toBe(1);
    expect(aliveAt(pack, 2)[id('src/a.ts')]).toBe(0);
    expect(aliveAt(pack, 3)[id('src/a.ts')]).toBe(1);
  });

  it('держит директорию живой, пока жив хоть один потомок', () => {
    expect(aliveAt(pack, 1)[id('src')]).toBe(1);
    expect(aliveAt(pack, 2)[id('src')]).toBe(0);
    expect(aliveAt(pack, 2)[0]).toBe(1); // корень жив, пока жив README.md
  });
});

describe('sizesAt', () => {
  it('возвращает размер файла на момент коммита', () => {
    expect(sizesAt(pack, 0)[id('src/a.ts')]).toBe(10);
    expect(sizesAt(pack, 1)[id('src/a.ts')]).toBe(14);
    expect(sizesAt(pack, 3)[id('src/a.ts')]).toBe(3);
  });

  it('не заглядывает в будущее', () => {
    expect(sizesAt(pack, 0)[id('src/a.ts')]).toBe(10);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run tests/web/alive.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Реализовать**

`web/time/alive.ts`:

```ts
import { ALIVE } from '../../src/model/history.js';
import type { Pack } from '../../src/model/types.js';

/**
 * Какие пути существуют на момент коммита `commitIndex` включительно.
 * Директория живёт, пока жив хотя бы один её потомок, поэтому от каждого
 * живого файла поднимаемся к корню с ранним выходом на уже помеченном узле.
 */
export function aliveAt(pack: Pack, commitIndex: number): Uint8Array {
  const { pathCount } = pack.meta;
  const alive = new Uint8Array(pathCount);

  for (let path = 0; path < pathCount; path++) {
    if (pack.pathIsDir[path] === 1) continue;
    const from = pack.lifetimeStart[path];
    const to = pack.lifetimeStart[path + 1];
    for (let k = from; k < to; k++) {
      const birth = pack.lifetimeBirth[k];
      if (birth > commitIndex) break; // интервалы идут по возрастанию
      const death = pack.lifetimeDeath[k];
      if (death === ALIVE || death > commitIndex) {
        alive[path] = 1;
        break;
      }
    }
    if (alive[path] === 0) continue;

    for (let node = pack.pathParent[path]; alive[node] === 0; node = pack.pathParent[node]) {
      alive[node] = 1;
      if (node === 0) break;
    }
  }

  return alive;
}

/** Размер каждого файла в строках на момент коммита; директории получают 0. */
export function sizesAt(pack: Pack, commitIndex: number): Int32Array {
  const sizes = new Int32Array(pack.meta.pathCount);

  for (let path = 0; path < pack.meta.pathCount; path++) {
    const from = pack.pathEventStart[path];
    const to = pack.pathEventStart[path + 1];
    if (from === to) continue;

    // Последнее событие пути, попавшее в [0, commitIndex] — двоичным поиском.
    let lo = from;
    let hi = to - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (pack.eventCommit[pack.pathEventIdx[mid]] <= commitIndex) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (found !== -1) sizes[path] = pack.pathEventLines[found];
  }
  return sizes;
}
```

- [ ] **Step 4: Запустить тесты**

Run: `npx vitest run tests/web && npm run typecheck`
Expected: PASS, 6 тестов.

- [ ] **Step 5: Коммит**

```bash
git add -A
git commit -m "feat(web): alive set and file sizes at a commit"
```

---

### Task 11: Граф симуляции и force-layout в воркере

**Files:**
- Create: `web/layout/protocol.ts`, `web/layout/graph.ts`, `web/layout/worker.ts`
- Test: `tests/web/graph.test.ts`

**Interfaces:**
- Consumes: `Pack` (Task 5), `aliveAt`/`sizesAt` (Task 10), `makeRng` (Task 7), `d3-force`
- Produces: `LayoutGraph { nodeIds: Uint32Array; linkSource: Uint32Array; linkTarget: Uint32Array }` (индексы в `nodeIds`); `buildLayoutGraph(alive: Uint8Array, parent: Uint32Array): LayoutGraph`; `radiusFor(lines: number, isDir: boolean): number`; типы сообщений `LayoutInit`, `LayoutPositions`

- [ ] **Step 1: Написать падающий тест**

`tests/web/graph.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildLayoutGraph, radiusFor } from '../../web/layout/graph.js';

describe('buildLayoutGraph', () => {
  it('берёт только живые узлы', () => {
    const alive = Uint8Array.from([1, 1, 0, 1]);
    const parent = Uint32Array.from([0, 0, 1, 1]);
    const graph = buildLayoutGraph(alive, parent);
    expect([...graph.nodeIds]).toEqual([0, 1, 3]);
  });

  it('строит рёбра родитель → потомок в локальных индексах', () => {
    const alive = Uint8Array.from([1, 1, 1]);
    const parent = Uint32Array.from([0, 0, 1]);
    const graph = buildLayoutGraph(alive, parent);
    expect([...graph.linkSource]).toEqual([0, 1]);
    expect([...graph.linkTarget]).toEqual([1, 2]);
  });

  it('не создаёт петлю у корня', () => {
    const graph = buildLayoutGraph(Uint8Array.from([1]), Uint32Array.from([0]));
    expect(graph.linkSource).toHaveLength(0);
  });

  it('пропускает ребро, если родитель мёртв', () => {
    const alive = Uint8Array.from([1, 0, 1]);
    const parent = Uint32Array.from([0, 0, 1]);
    const graph = buildLayoutGraph(alive, parent);
    expect(graph.linkSource).toHaveLength(0);
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
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run tests/web/graph.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Реализовать чистую часть**

`web/layout/graph.ts`:

```ts
export interface LayoutGraph {
  /** Идентификаторы путей, попавших в симуляцию. */
  nodeIds: Uint32Array;
  /** Рёбра в локальных индексах внутри nodeIds. */
  linkSource: Uint32Array;
  linkTarget: Uint32Array;
}

const DIR_RADIUS = 3;
const MIN_RADIUS = 2.5;
const MAX_RADIUS = 40;

export function radiusFor(lines: number, isDir: boolean): number {
  if (isDir) return DIR_RADIUS;
  return Math.min(MAX_RADIUS, MIN_RADIUS + Math.sqrt(Math.max(0, lines)) * 0.6);
}

/**
 * Сжимает живое подмножество путей в плотный граф для d3-force.
 * Локальные индексы нужны потому, что симуляция работает с массивом узлов,
 * а идентификаторы путей разрежены: половина дерева в любой момент мертва.
 */
export function buildLayoutGraph(alive: Uint8Array, parent: Uint32Array): LayoutGraph {
  const local = new Int32Array(alive.length).fill(-1);
  const nodeIds: number[] = [];
  for (let path = 0; path < alive.length; path++) {
    if (alive[path] === 1) {
      local[path] = nodeIds.length;
      nodeIds.push(path);
    }
  }

  const linkSource: number[] = [];
  const linkTarget: number[] = [];
  for (const path of nodeIds) {
    const parentId = parent[path];
    if (parentId === path) continue; // корень
    if (local[parentId] === -1) continue;
    linkSource.push(local[parentId]);
    linkTarget.push(local[path]);
  }

  return {
    nodeIds: Uint32Array.from(nodeIds),
    linkSource: Uint32Array.from(linkSource),
    linkTarget: Uint32Array.from(linkTarget),
  };
}
```

- [ ] **Step 4: Описать протокол воркера**

`web/layout/protocol.ts`:

```ts
/** Главный поток → воркер: полный набор узлов и рёбер для симуляции. */
export interface LayoutInit {
  type: 'init';
  nodeCount: number;
  linkSource: Uint32Array;
  linkTarget: Uint32Array;
  radius: Float32Array;
  /** Фиксированный seed: два запуска на одном репозитории дают похожую картинку. */
  seed: number;
}

/** Воркер → главный поток: пары x, y длиной nodeCount * 2. */
export interface LayoutPositions {
  type: 'positions';
  positions: Float32Array;
  /** Текущая «температура» симуляции; ниже 0.02 картинка практически замерла. */
  alpha: number;
}

export type ToWorker = LayoutInit;
export type FromWorker = LayoutPositions;
```

- [ ] **Step 5: Реализовать воркер**

`web/layout/worker.ts`:

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
  index: number;
  x: number;
  y: number;
  radius: number;
}

let simulation: Simulation<Node, undefined> | null = null;
let nodes: Node[] = [];
let lastPost = 0;

function post(alpha: number): void {
  const positions = new Float32Array(nodes.length * 2);
  for (let i = 0; i < nodes.length; i++) {
    positions[i * 2] = nodes[i]!.x;
    positions[i * 2 + 1] = nodes[i]!.y;
  }
  const message: FromWorker = { type: 'positions', positions, alpha };
  (self as unknown as Worker).postMessage(message, [positions.buffer]);
}

self.onmessage = (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  if (message.type !== 'init') return;

  const rng = makeRng(message.seed);
  nodes = Array.from({ length: message.nodeCount }, (_, index) => ({
    index,
    // Стартуем кольцом, а не точкой: из точки d3-force расталкивает узлы долго.
    x: Math.cos(rng() * Math.PI * 2) * 400 * Math.sqrt(rng()),
    y: Math.sin(rng() * Math.PI * 2) * 400 * Math.sqrt(rng()),
    radius: message.radius[index] ?? 3,
  }));

  // d3-force принимает числовые source/target и сам заменяет их на узлы по индексу.
  const links: SimulationLinkDatum<Node>[] = Array.from(
    { length: message.linkSource.length },
    (_, i) => ({ source: message.linkSource[i]!, target: message.linkTarget[i]! }),
  );

  simulation?.stop();
  simulation = forceSimulation(nodes)
    .force('charge', forceManyBody<Node>().strength((node) => -30 - node.radius * 4))
    .force(
      'link',
      forceLink<Node, SimulationLinkDatum<Node>>(links).distance(24).strength(0.7),
    )
    .force('center', forceCenter(0, 0))
    .alphaDecay(0.015)
    .on('tick', () => {
      // Ограничиваем поток сообщений: рендер всё равно не успевает чаще ~30 Гц.
      const now = performance.now();
      if (now - lastPost < 33) return;
      lastPost = now;
      post(simulation!.alpha());
    })
    .on('end', () => post(0));
};
```

- [ ] **Step 6: Запустить тесты и сборку**

Run: `npx vitest run tests/web/graph.test.ts && npm run build:web && npm run typecheck`
Expected: PASS, 6 тестов; Vite собирает воркер отдельным чанком.

- [ ] **Step 7: Коммит**

```bash
git add -A
git commit -m "feat(web): force layout graph and simulation worker"
```

---

### Task 12: Камера и отрисовка сцены

**Files:**
- Create: `web/render/camera.ts`, `web/render/scene.ts`
- Modify: `web/main.ts` (полная замена содержимого)
- Test: `tests/web/camera.test.ts`

**Interfaces:**
- Consumes: `LayoutGraph`, `radiusFor` (Task 11), `aliveAt`/`sizesAt` (Task 10), `Pack`
- Produces: `class Camera` с `scale`, `x`, `y`, методами `toScreen(wx, wy): [number, number]`, `toWorld(sx, sy): [number, number]`, `zoomAt(sx, sy, factor)`, `panBy(dx, dy)`, `fit(positions: Float32Array, width: number, height: number)`, `attach(canvas: HTMLCanvasElement): () => void`; `SceneInput { positions: Float32Array; radius: Float32Array; color: string[]; linkSource: Uint32Array; linkTarget: Uint32Array }`; `drawScene(ctx: CanvasRenderingContext2D, camera: Camera, input: SceneInput, width: number, height: number): void`; `colorForPath(path: string): string`

- [ ] **Step 1: Написать падающий тест**

`tests/web/camera.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Camera } from '../../web/render/camera.js';
import { colorForPath } from '../../web/render/scene.js';

describe('Camera', () => {
  it('переводит мир в экран и обратно без потерь', () => {
    const camera = new Camera();
    camera.scale = 2.5;
    camera.x = 100;
    camera.y = -40;
    const [sx, sy] = camera.toScreen(12, 34);
    const [wx, wy] = camera.toWorld(sx, sy);
    expect(wx).toBeCloseTo(12, 6);
    expect(wy).toBeCloseTo(34, 6);
  });

  it('удерживает точку под курсором при зуме', () => {
    const camera = new Camera();
    const before = camera.toWorld(300, 200);
    camera.zoomAt(300, 200, 1.7);
    const after = camera.toWorld(300, 200);
    expect(after[0]).toBeCloseTo(before[0], 6);
    expect(after[1]).toBeCloseTo(before[1], 6);
  });

  it('не даёт зуму уйти за пределы разумного', () => {
    const camera = new Camera();
    for (let i = 0; i < 200; i++) camera.zoomAt(0, 0, 2);
    expect(camera.scale).toBeLessThanOrEqual(40);
    for (let i = 0; i < 400; i++) camera.zoomAt(0, 0, 0.5);
    expect(camera.scale).toBeGreaterThanOrEqual(0.01);
  });

  it('вписывает облако точек в вид', () => {
    const camera = new Camera();
    camera.fit(Float32Array.from([-100, -100, 100, 100]), 800, 600);
    const [ax, ay] = camera.toScreen(-100, -100);
    const [bx, by] = camera.toScreen(100, 100);
    expect(ax).toBeGreaterThan(0);
    expect(ay).toBeGreaterThan(0);
    expect(bx).toBeLessThan(800);
    expect(by).toBeLessThan(600);
  });

  it('справляется с единственной точкой', () => {
    const camera = new Camera();
    camera.fit(Float32Array.from([5, 5]), 800, 600);
    expect(Number.isFinite(camera.scale)).toBe(true);
    expect(camera.scale).toBeGreaterThan(0);
  });
});

describe('colorForPath', () => {
  it('даёт одинаковый цвет одному расширению независимо от папки', () => {
    expect(colorForPath('src/a.ts')).toBe(colorForPath('lib/deep/b.ts'));
  });

  it('разводит распространённые расширения по разным цветам', () => {
    // Палитра конечна, отдельные коллизии допустимы — проверяем разброс, а не
    // неравенство конкретной пары, иначе тест держится на значении хэша.
    const extensions = ['ts', 'js', 'md', 'json', 'css', 'html', 'py', 'go', 'rs', 'yml'];
    const colors = new Set(extensions.map((ext) => colorForPath(`file.${ext}`)));
    expect(colors.size).toBeGreaterThanOrEqual(5);
  });

  it('не падает на файле без расширения', () => {
    expect(colorForPath('Makefile')).toMatch(/^#[0-9a-f]{6}$/);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run tests/web/camera.test.ts`
Expected: FAIL — модули не найдены.

- [ ] **Step 3: Реализовать камеру**

`web/render/camera.ts`:

```ts
const MIN_SCALE = 0.01;
const MAX_SCALE = 40;

/** Аффинное преобразование мира в экран: screen = world * scale + offset. */
export class Camera {
  scale = 1;
  x = 0;
  y = 0;

  toScreen(wx: number, wy: number): [number, number] {
    return [wx * this.scale + this.x, wy * this.scale + this.y];
  }

  toWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.x) / this.scale, (sy - this.y) / this.scale];
  }

  panBy(dx: number, dy: number): void {
    this.x += dx;
    this.y += dy;
  }

  /** Масштабирует так, чтобы точка мира под (sx, sy) осталась на месте. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.scale * factor));
    const applied = next / this.scale;
    this.x = sx - (sx - this.x) * applied;
    this.y = sy - (sy - this.y) * applied;
    this.scale = next;
  }

  /** Вписывает облако точек (пары x, y) в прямоугольник width × height. */
  fit(positions: Float32Array, width: number, height: number): void {
    if (positions.length < 2) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < positions.length; i += 2) {
      const px = positions[i]!;
      const py = positions[i + 1]!;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
    const spanX = Math.max(maxX - minX, 1);
    const spanY = Math.max(maxY - minY, 1);
    const padding = 0.85;
    this.scale = Math.min(
      MAX_SCALE,
      Math.max(MIN_SCALE, Math.min((width / spanX) * padding, (height / spanY) * padding)),
    );
    this.x = width / 2 - ((minX + maxX) / 2) * this.scale;
    this.y = height / 2 - ((minY + maxY) / 2) * this.scale;
  }

  /** Вешает колесо и перетаскивание. Возвращает функцию отписки. */
  attach(canvas: HTMLCanvasElement): () => void {
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      this.zoomAt(event.offsetX, event.offsetY, Math.exp(-event.deltaY * 0.002));
    };
    const onDown = (event: PointerEvent) => {
      dragging = true;
      lastX = event.offsetX;
      lastY = event.offsetY;
      canvas.setPointerCapture(event.pointerId);
    };
    const onMove = (event: PointerEvent) => {
      if (!dragging) return;
      this.panBy(event.offsetX - lastX, event.offsetY - lastY);
      lastX = event.offsetX;
      lastY = event.offsetY;
    };
    const onUp = (event: PointerEvent) => {
      dragging = false;
      canvas.releasePointerCapture(event.pointerId);
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    return () => {
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
    };
  }
}
```

- [ ] **Step 4: Реализовать отрисовку**

`web/render/scene.ts`:

```ts
import type { Camera } from './camera.js';

export interface SceneInput {
  /** Пары x, y в мировых координатах. */
  positions: Float32Array;
  radius: Float32Array;
  color: string[];
  linkSource: Uint32Array;
  linkTarget: Uint32Array;
}

const DIR_COLOR = '#39414d';
const PALETTE = [
  '#7aa2f7', '#9ece6a', '#e0af68', '#bb9af7', '#7dcfff',
  '#f7768e', '#73daca', '#ff9e64', '#c0caf5', '#b4f9f8',
];

/** Устойчивый цвет по расширению файла: одно расширение — один цвет. */
export function colorForPath(path: string): string {
  const slash = path.lastIndexOf('/');
  const name = slash === -1 ? path : path.slice(slash + 1);
  const dot = name.lastIndexOf('.');
  const ext = dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
  if (ext === '') return DIR_COLOR;
  let hash = 2166136261;
  for (let i = 0; i < ext.length; i++) {
    hash = Math.imul(hash ^ ext.charCodeAt(i), 16777619);
  }
  return PALETTE[(hash >>> 0) % PALETTE.length]!;
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

  const count = input.radius.length;
  for (let i = 0; i < count; i++) {
    const [sx, sy] = camera.toScreen(input.positions[i * 2]!, input.positions[i * 2 + 1]!);
    const r = input.radius[i]! * camera.scale;
    // Отсечение: за границами вида рисовать нечего, а узлов десятки тысяч.
    if (sx + r < 0 || sy + r < 0 || sx - r > width || sy - r > height) continue;
    ctx.fillStyle = input.color[i]!;
    ctx.beginPath();
    ctx.arc(sx, sy, Math.max(0.5, r), 0, Math.PI * 2);
    ctx.fill();
  }
}
```

- [ ] **Step 5: Собрать всё на странице**

`web/main.ts` — заменить содержимое целиком:

```ts
import { describePack, loadPack, showFatal } from './boot.js';
import { aliveAt, sizesAt } from './time/alive.js';
import { buildLayoutGraph, radiusFor } from './layout/graph.js';
import type { FromWorker, LayoutInit } from './layout/protocol.js';
import { Camera } from './render/camera.js';
import { colorForPath, drawScene, type SceneInput } from './render/scene.js';

async function start(): Promise<void> {
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const status = document.getElementById('status');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    showFatal('Браузер не дал контекст canvas 2D.');
    return;
  }

  const pack = await loadPack();
  if (status) status.textContent = describePack(pack);

  const head = Math.max(0, pack.meta.commitCount - 1);
  const alive = aliveAt(pack, head);
  const sizes = sizesAt(pack, head);
  const graph = buildLayoutGraph(alive, pack.pathParent);

  const radius = new Float32Array(graph.nodeIds.length);
  const color: string[] = [];
  for (let i = 0; i < graph.nodeIds.length; i++) {
    const path = graph.nodeIds[i]!;
    const isDir = pack.pathIsDir[path] === 1;
    radius[i] = radiusFor(sizes[path]!, isDir);
    color.push(isDir ? '#39414d' : colorForPath(pack.paths[path]!));
  }

  const scene: SceneInput = {
    positions: new Float32Array(graph.nodeIds.length * 2),
    radius,
    color,
    linkSource: graph.linkSource,
    linkTarget: graph.linkTarget,
  };

  const camera = new Camera();
  camera.attach(canvas);
  let fitted = false;

  const worker = new Worker(new URL('./layout/worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<FromWorker>) => {
    if (event.data.type !== 'positions') return;
    scene.positions = event.data.positions;
    if (!fitted && event.data.alpha < 0.3) {
      camera.fit(scene.positions, canvas.clientWidth, canvas.clientHeight);
      fitted = true;
    }
  };

  const init: LayoutInit = {
    type: 'init',
    nodeCount: graph.nodeIds.length,
    linkSource: graph.linkSource,
    linkTarget: graph.linkTarget,
    radius,
    seed: 20260817,
  };
  worker.postMessage(init);

  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  window.addEventListener('resize', resize);
  resize();

  const frame = () => {
    drawScene(ctx, camera, scene, canvas.clientWidth, canvas.clientHeight);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  canvas.dataset.ready = 'true';
}

start().catch((error: unknown) => {
  showFatal(error instanceof Error ? error.message : 'Не удалось построить визуализацию.');
});
```

- [ ] **Step 6: Запустить тесты, типизацию и сборку**

Run: `npx vitest run && npm run typecheck && npm run build:web`
Expected: PASS, все тесты зелёные, бандл собран.

- [ ] **Step 7: Коммит**

```bash
git add -A
git commit -m "feat(web): camera, canvas scene, and first rendered frame"
```

---

### Task 13: Запуск браузера, сборка команды целиком и E2E

**Files:**
- Create: `src/cli/open-browser.ts`, `playwright.config.ts`
- Modify: `src/cli/main.ts` (добавить запуск сервера в `run`)
- Modify: `package.json` (скрипт `test:e2e`)
- Test: `tests/e2e/first-frame.spec.ts`

**Interfaces:**
- Consumes: `startServer` (Task 8), `collectPack`/`formatStats` (Task 6), `encodePack` (Task 7)
- Produces: `openBrowser(url: string): void`; обновлённый `run(argv: string[]): Promise<number>`, который поднимает сервер и не завершается, пока его не остановят

- [ ] **Step 1: Реализовать открытие браузера**

`src/cli/open-browser.ts`:

```ts
import { spawn } from 'node:child_process';

/**
 * Открывает URL в браузере по умолчанию. Молча ничего не делает при неудаче:
 * пользователь всё равно видит адрес в терминале, падать из-за этого нельзя.
 */
export function openBrowser(url: string): void {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(command, args as string[], { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // пусто: адрес уже напечатан
  }
}
```

- [ ] **Step 2: Дописать запуск сервера в CLI**

`src/cli/main.ts` — заменить функцию `run` целиком и добавить импорты:

```ts
import { fileURLToPath } from 'node:url';
import { dirname, join, sep } from 'node:path';
import { startServer } from '../server/serve.js';
import { encodePack } from '../pack/encode.js';
import { openBrowser } from './open-browser.js';
```

```ts
/**
 * Каталог собранного web-бандла. В опубликованном пакете этот файл лежит в
 * dist/node/cli, то есть бандл — на два уровня выше в dist/web. При запуске из
 * исходников через tsx файл лежит в src/cli, и путь считается от корня проекта.
 * В обоих случаях бандл должен быть собран: `npm run build:web`.
 */
function resolveWebRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return here.includes(`${sep}dist${sep}`)
    ? join(here, '..', '..', 'web')
    : join(here, '..', '..', 'dist', 'web');
}

export async function run(argv: string[]): Promise<number> {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  try {
    const packPromise = collectPack(options.repoPath, (n) => {
      process.stderr.write(`\rпрочитано коммитов: ${n}`);
    });

    if (options.stats) {
      const pack = await packPromise;
      process.stderr.write('\r\x1b[K');
      process.stdout.write(`${formatStats(pack)}\n`);
      return 0;
    }

    const server = await startServer({
      webRoot: resolveWebRoot(),
      port: options.port,
      getPack: async () => encodePack(await packPromise),
    });

    const pack = await packPromise;
    process.stderr.write('\r\x1b[K');
    process.stdout.write(`${formatStats(pack)}\n\n${server.url}\nОстановить: Ctrl+C\n`);
    if (options.open) openBrowser(server.url);

    await new Promise<void>((done) => {
      const stop = () => {
        void server.close().then(done);
      };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
    });
    return 0;
  } catch (error) {
    if (error instanceof RepoError) {
      process.stderr.write(`\r\x1b[K${error.message}\n`);
      return 1;
    }
    throw error;
  }
}
```

- [ ] **Step 3: Установить Playwright и написать конфигурацию**

```bash
npm i -D @playwright/test
npx playwright install chromium
```

`playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  use: { headless: true },
  reporter: 'list',
});
```

Добавить в `scripts` в `package.json`:

```json
"test:e2e": "playwright test"
```

- [ ] **Step 4: Написать падающий E2E-тест**

`tests/e2e/first-frame.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { makeRepo, cleanupRepos } from '../helpers/tmp-repo.js';

let cli: ChildProcess | null = null;

test.afterAll(async () => {
  cli?.kill('SIGTERM');
  await cleanupRepos();
});

test('показывает дерево репозитория в браузере', async ({ page }) => {
  const repo = await makeRepo([
    { message: 'первый', write: { 'src/a.ts': 'a\nb\nc\n', 'README.md': 'hi\n' } },
    { message: 'второй', write: { 'src/deep/b.ts': 'x\n', 'docs/c.md': 'y\n' } },
    { message: 'третий', remove: ['README.md'] },
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
  await expect(page.locator('#status')).toContainText('3 коммита');
  await page.waitForSelector('canvas[data-ready="true"]');

  // Ждём, пока симуляция расставит узлы, и проверяем, что на холсте есть пиксели.
  await page.waitForTimeout(3000);
  const painted = await page.evaluate(() => {
    const canvas = document.getElementById('scene') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let opaque = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i]! > 0) opaque++;
    return opaque;
  });
  expect(painted).toBeGreaterThan(500);
});
```

- [ ] **Step 5: Собрать и запустить E2E, убедиться в падении до сборки**

Run: `npx playwright test`
Expected: FAIL — `dist/node/cli/main.js` ещё не собран.

- [ ] **Step 6: Собрать проект и прогнать E2E**

Run: `npm run build && npx playwright test`
Expected: PASS — страница показывает «3 коммита», canvas закрашен.

- [ ] **Step 7: Проверить вручную на настоящем репозитории**

Run: `node dist/node/cli/main.js .`
Expected: открывается вкладка, видно дерево файлов этого проекта; колесо мыши масштабирует, перетаскивание двигает сцену. Остановить `Ctrl+C`.

- [ ] **Step 8: Прогнать всё разом**

Run: `npm test && npm run typecheck && npx playwright test`
Expected: PASS во всех трёх.

- [ ] **Step 9: Коммит**

```bash
git add -A
git commit -m "feat(cli): serve visualization and open browser"
```

---

## Что остаётся следующим планам

- Срез 3 «Время»: инкрементальный `step`/`seek`, diff узлов в воркер, транспорт и слайдер, property-тест движка времени против эталонной реализации.
- Срез 4 «Авторы»: лучи, вспышки, значки контрибьюторов.
- Срез 5 «Взаимодействие»: инспектор, фильтры-гашение, поиск, видимость поддеревьев.
- Срез 6 «Упаковка»: `--export`, полный набор сообщений об ошибках, перф-бюджеты на синтетическом репозитории в 50k коммитов.
