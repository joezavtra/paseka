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
    expect(delta.touched.length).toBe(0);
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
  // Пяти сидов мало для уверенности — гоняем полсотни разных историй.
  it('пошаговый проход совпадает с полным пересчётом на каждом коммите', () => {
    const seeds = [1, 7, 42, 1337, 20260817, ...Array.from({ length: 45 }, (_, i) => 1000 + i)];
    for (const seed of seeds) {
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

  // Раньше этот тест был зафиксирован на одном сиде (99, 30 коммитов) и проходил
  // по удаче: разница шага копила промежуточные мелькания живости внутри
  // коммита, а не итог, поэтому один и тот же путь мог оказаться сразу в
  // added и removed. Гоняем много сидов и историй подлиннее, чтобы страховка
  // не зависела от жребия.
  it('накопленные разницы шагов воспроизводят живое множество', () => {
    const lengths = [30, 40, 55];
    for (const count of lengths) {
      for (let seed = 1; seed <= 40; seed++) {
        const pack = buildPack(randomCommits(seed, count), { repoName: 'd', head: 'h' });
        const engine = new TimeEngine(pack);
        const mask = new Uint8Array(pack.meta.pathCount);

        for (let t = 0; t < pack.meta.commitCount; t++) {
          const delta = engine.step();
          const addedSeen = new Set<number>();
          const removedSeen = new Set<number>();
          for (const p of delta.added) {
            expect(addedSeen.has(p), `повтор ${p} внутри added: сид ${seed}, длина ${count}, коммит ${t}`).toBe(
              false,
            );
            addedSeen.add(p);
            expect(
              mask[p],
              `повторное добавление ${p}: сид ${seed}, длина ${count}, коммит ${t}`,
            ).toBe(0);
            mask[p] = 1;
          }
          for (const p of delta.removed) {
            expect(
              removedSeen.has(p),
              `повтор ${p} внутри removed: сид ${seed}, длина ${count}, коммит ${t}`,
            ).toBe(false);
            removedSeen.add(p);
            expect(
              addedSeen.has(p),
              `путь ${p} одновременно в added и removed: сид ${seed}, длина ${count}, коммит ${t}`,
            ).toBe(false);
            expect(mask[p], `удаление неживого ${p}: сид ${seed}, длина ${count}, коммит ${t}`).toBe(1);
            mask[p] = 0;
          }
          expect(Array.from(mask), `сид ${seed}, длина ${count}, коммит ${t}`).toEqual(
            Array.from(engine.alive),
          );
        }
      }
    }
  });

  // Минимальный сценарий Critical-дефекта: история без --renames, поэтому
  // переименование файла внутри директории приходит как удаление плюс
  // создание в одном коммите. Каталог не должен мигнуть — он был жив и
  // остался жив, поэтому не имеет права попасть ни в added, ни в removed.
  it('переименование внутри директории не мигает в разнице каталога', () => {
    const pack = buildPack(
      [
        {
          hash: 'h0',
          authorName: 'A',
          authorEmail: 'a@e.com',
          timestamp: 1,
          subject: 'c0',
          changes: [{ path: 'src/deep/c.ts', kind: 'add', added: 3, deleted: 0, binary: false }],
        },
        {
          hash: 'h1',
          authorName: 'A',
          authorEmail: 'a@e.com',
          timestamp: 2,
          subject: 'c1',
          changes: [
            { path: 'src/deep/c.ts', kind: 'delete', added: 0, deleted: 3, binary: false },
            { path: 'src/deep/d.ts', kind: 'add', added: 3, deleted: 0, binary: false },
          ],
        },
      ],
      { repoName: 'd', head: 'h' },
    );

    const engine = new TimeEngine(pack);
    engine.step(); // c0: создание src/deep/c.ts
    const delta = engine.step(); // c1: переименование c.ts -> d.ts

    const dir = pack.paths.indexOf('src/deep');
    const parent = pack.paths.indexOf('src');
    const root = pack.paths.indexOf('');
    const cFile = pack.paths.indexOf('src/deep/c.ts');
    const dFile = pack.paths.indexOf('src/deep/d.ts');

    for (const stable of [dir, parent, root]) {
      expect([...delta.added], `путь ${stable} не должен быть в added`).not.toContain(stable);
      expect([...delta.removed], `путь ${stable} не должен быть в removed`).not.toContain(stable);
    }
    expect([...delta.added]).toEqual([dFile]);
    expect([...delta.removed]).toEqual([cFile]);
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

describe('TimeEngine.commits', () => {
  const change = (path: string, kind: 'add' | 'modify' | 'delete') => ({
    path,
    kind,
    added: kind === 'delete' ? 0 : 3,
    deleted: 0,
    binary: false,
  });
  const commit = (index: number, changes: RawCommit['changes']): RawCommit => ({
    hash: `h${index}`,
    authorName: 'A',
    authorEmail: 'a@e.com',
    timestamp: 1_700_000_000 + index * 60,
    subject: `c${index}`,
    changes,
  });

  /** История: a.ts правят трижды, b.ts заводят и удаляют, c.ts тронут однажды. */
  const pack = buildPack(
    [
      commit(0, [change('src/a.ts', 'add'), change('src/b.ts', 'add')]),
      commit(1, [change('src/a.ts', 'modify')]),
      commit(2, [change('src/a.ts', 'modify'), change('src/b.ts', 'delete')]),
      commit(3, [change('src/c.ts', 'add')]),
    ],
    { repoName: 'demo', head: 'h3' },
  );
  const id = (path: string): number => {
    const index = pack.paths.indexOf(path);
    if (index < 0) throw new Error(`нет пути ${path}`);
    return index;
  };

  it('до начала истории вес нулевой у всех', () => {
    const engine = new TimeEngine(pack);
    engine.seek(BEFORE_HISTORY);
    expect([...engine.commits]).toEqual(Array.from(engine.commits, () => 0));
  });

  it('считает коммиты, задевшие путь, на любом курсоре', () => {
    const engine = new TimeEngine(pack);
    engine.seek(0);
    expect(engine.commits[id('src/a.ts')]).toBe(1);
    engine.seek(2);
    expect(engine.commits[id('src/a.ts')]).toBe(3);
    // Удалённый файл сохраняет вес: он показывает, сколько работы в него вложили.
    expect(engine.commits[id('src/b.ts')]).toBe(2);
    // Ещё не родившийся — ноль.
    expect(engine.commits[id('src/c.ts')]).toBe(0);
  });

  it('шаг наращивает вес так же, как полный пересчёт', () => {
    const stepped = new TimeEngine(pack);
    stepped.seek(BEFORE_HISTORY);
    for (let i = 0; i <= 3; i++) stepped.step();

    const recomputed = new TimeEngine(pack);
    recomputed.seek(3);

    expect([...stepped.commits]).toEqual([...recomputed.commits]);
  });

  it('у каталогов вес нулевой: события бывают только у файлов', () => {
    const engine = new TimeEngine(pack);
    engine.seek(3);
    expect(engine.commits[id('src')]).toBe(0);
    expect(engine.commits[0]).toBe(0);
  });

  it('синтетическое удаление не добавляет веса тому же коммиту', () => {
    // Сверка с деревом HEAD дописывает удаление файла, которого нет в рабочем
    // дереве, тем же последним коммитом. У пути тогда два события в одном
    // коммите, и вес обязан вырасти на единицу, а не на две: автор сделал одну
    // правку, а вторая запись — служебная.
    const withSynthetic = buildPack(
      [
        commit(0, [change('src/a.ts', 'add'), change('src/gone.ts', 'add')]),
        commit(1, [change('src/a.ts', 'modify'), change('src/gone.ts', 'modify')]),
      ],
      { repoName: 'demo', head: 'h1', headFiles: new Set(['src/a.ts']) },
    );
    const gone = withSynthetic.paths.indexOf('src/gone.ts');
    expect(gone).toBeGreaterThan(0);

    // Предпосылка теста: у пути действительно два события в последнем коммите.
    let inLastCommit = 0;
    for (let k = withSynthetic.pathEventStart[gone]; k < withSynthetic.pathEventStart[gone + 1]; k++) {
      if (withSynthetic.eventCommit[withSynthetic.pathEventIdx[k]] === 1) inLastCommit++;
    }
    expect(inLastCommit).toBe(2);

    const recomputed = new TimeEngine(withSynthetic);
    recomputed.seek(1);
    expect(recomputed.commits[gone]).toBe(2);

    const stepped = new TimeEngine(withSynthetic);
    stepped.seek(BEFORE_HISTORY);
    stepped.step();
    stepped.step();
    expect(stepped.commits[gone]).toBe(2);
  });

  it('на случайной истории шаг и пересчёт сходятся на каждом коммите', () => {
    const random = buildPack(randomCommits(7, 25), { repoName: 'r', head: 'h' });
    const stepped = new TimeEngine(random);
    stepped.seek(BEFORE_HISTORY);
    for (let cursor = 0; cursor < random.meta.commitCount; cursor++) {
      stepped.step();
      const recomputed = new TimeEngine(random);
      recomputed.seek(cursor);
      expect([...stepped.commits], `курсор ${cursor}`).toEqual([...recomputed.commits]);
    }
  });
});
