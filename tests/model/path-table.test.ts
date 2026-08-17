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
