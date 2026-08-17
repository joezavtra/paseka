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
