import { describe, it, expect } from 'vitest';
import { buildPack } from '../../src/model/build.js';
import { TimeEngine } from '../../web/time/engine.js';
import { basenameOf, describeNode } from '../../web/state/node-info.js';

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

describe('basenameOf', () => {
  it('отдаёт имя без пути', () => {
    expect(basenameOf(pack, id('src/a.ts'))).toBe('a.ts');
    expect(basenameOf(pack, id('src'))).toBe('src');
  });

  it('у корня отдаёт имя репозитория', () => {
    expect(basenameOf(pack, 0)).toBe('demo');
  });
});

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

  it('без options.represented поле represented отсутствует', () => {
    expect(info('src', 2).represented).toBeUndefined();
  });

  it('represented — это то же число, что передали в options, а не пересчитанное', () => {
    // describeNode не имеет доступа к спецификации видимости — значение
    // приходит извне и должно перенестись как есть, даже если оно не бьётся
    // с files (та же ситуация, что и у свёрнутой папки со скрытым поддеревом).
    expect(info('src', 2, { represented: 1 }).represented).toBe(1);
    expect(info('src', 2, { represented: 0 }).represented).toBe(0);
  });
});

/**
 * Отдельный пакет на воскрешение: файл создан, удалён, создан заново.
 * Реализация опирается на ранний выход из цикла событий пути (`break` при
 * `commit > cursor`), законный только потому, что события пути идут по
 * возрастанию коммита (buildPathHistory). Если выход сломать или заменить
 * чем-то «более полным», события из будущего просочатся в прошлое — и этот
 * тест это поймает: на курсоре между смертью и воскрешением утечка сразу
 * увеличит commits и lastCommit.
 */
const resurrectionPack = buildPack(
  [
    {
      hash: 'r0',
      authorName: 'Аня',
      authorEmail: 'anya@e.com',
      timestamp: 1000,
      subject: 'рождение',
      changes: [add('src/r.ts', 5)],
    },
    {
      hash: 'r1',
      authorName: 'Бо',
      authorEmail: 'bo@e.com',
      timestamp: 2000,
      subject: 'смерть',
      changes: [remove('src/r.ts')],
    },
    {
      hash: 'r2',
      authorName: 'Аня',
      authorEmail: 'anya@e.com',
      timestamp: 3000,
      subject: 'воскрешение',
      changes: [add('src/r.ts', 8)],
    },
  ],
  { repoName: 'resurrection', head: 'r2' },
);

const resurrectionId = (path: string): number => {
  const index = resurrectionPack.paths.indexOf(path);
  if (index < 0) throw new Error(`нет пути ${path}`);
  return index;
};

const resurrectionInfo = (path: string, cursor: number, options = {}) => {
  const engine = new TimeEngine(resurrectionPack);
  engine.seek(cursor);
  return describeNode(
    resurrectionPack,
    resurrectionId(path),
    cursor,
    engine.alive,
    engine.sizes,
    options,
  );
};

describe('describeNode: воскрешённый путь', () => {
  it('после воскрешения хранит рождение первым, а не последним', () => {
    const revived = resurrectionInfo('src/r.ts', 2);
    expect(revived.alive).toBe(true);
    expect(revived.lines).toBe(8);
    expect(revived.birthCommit).toBe(0); // первое рождение (r0), не воскрешение
    expect(revived.lastCommit).toBe(2); // коммит воскрешения (r2)
    expect(revived.commits).toBe(3); // r0, r1 и r2 — все три задели путь
  });

  it('между смертью и воскрешением мёртв, но история на месте', () => {
    const between = resurrectionInfo('src/r.ts', 1);
    expect(between.alive).toBe(false);
    expect(between.lines).toBe(0);
    expect(between.birthCommit).toBe(0);
    expect(between.commits).toBe(2); // r0 и r1, r2 из будущего не виден
  });
});
