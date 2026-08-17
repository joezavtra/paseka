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
