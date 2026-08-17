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
