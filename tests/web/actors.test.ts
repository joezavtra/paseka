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

  it('не швыряет вернувшегося автора остаточным импульсом', () => {
    const field = new ActorField(2);
    field.update(1 / 60, [at(0, 0, 0)]);
    // Разгоняем автора к далёкой цели, чтобы накопить заметную скорость.
    run(field, [at(0, 1000, 0)], 60);
    const x = field.positions[0]!;
    const y = field.positions[1]!;
    // Гасим на несколько кадров: автор пропал из целей, скорость не должна копиться.
    run(field, [], 10);
    // Возвращаем ровно в текущую позицию — сила пружины нулевая.
    field.update(1 / 60, [at(0, x, y)]);
    const jump = Math.hypot(field.positions[0]! - x, field.positions[1]! - y);
    expect(jump).toBeLessThan(1);
  });

  it('после сброса ставит автора сразу в новую цель, как впервые появившегося', () => {
    const field = new ActorField(4);
    field.update(1 / 60, [at(1, -300, -300)]);

    field.reset();
    field.update(1 / 60, [at(1, 200, 100)]);

    // Без сброса значок полз бы к новой цели пружиной — дольше, чем живёт луч.
    expect(field.positions[2]).toBeCloseTo(200, 3);
    expect(field.positions[3]).toBeCloseTo(100, 3);
    expect(field.active[1]).toBe(1);
  });

  it('сброс забывает и позиции, и активность', () => {
    const field = new ActorField(4);
    field.update(1 / 60, [at(0, 50, 60), at(1, -50, -60)]);

    field.reset();

    expect([...field.positions]).toEqual(new Array(8).fill(0));
    expect([...field.active]).toEqual([0, 0, 0, 0]);
  });

  it('после сброса вернувшийся автор не выпрыгивает остаточной скоростью', () => {
    const field = new ActorField(2);
    field.update(1 / 60, [at(0, 0, 0)]);
    // Разгоняем автора к далёкой цели, чтобы накопить заметную скорость.
    run(field, [at(0, 1000, 0)], 60);

    field.reset();
    field.update(1 / 60, [at(0, 10, 10)]);
    field.update(1 / 60, [at(0, 10, 10)]);

    expect(field.positions[0]).toBeCloseTo(10, 3);
    expect(field.positions[1]).toBeCloseTo(10, 3);
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
