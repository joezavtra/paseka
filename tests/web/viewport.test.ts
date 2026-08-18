import { describe, it, expect } from 'vitest';
import { freeViewBox } from '../../web/ui/viewport.js';

const NO_STRIPS = { left: 0, right: 0, bottom: 0 };

describe('freeViewBox', () => {
  it('без панелей отдаёт весь холст', () => {
    expect(freeViewBox(1000, 800, NO_STRIPS)).toEqual({ left: 0, width: 1000, height: 800 });
  });

  it('правая полоса сужает вид, не сдвигая его левый край', () => {
    // Карточка узла стоит справа: вписывание центрирует облако в
    // [left, left + width], поэтому достаточно вычесть ширину полосы. Если бы
    // её забыли вычесть (а до этой правки её не проверял ни один тест —
    // левая полоса имеет сквозной, правая не имела ничего), дерево вписывалось
    // бы во всё окно и уходило бы под карточку.
    const box = freeViewBox(1000, 800, { ...NO_STRIPS, right: 300 });
    expect(box).toEqual({ left: 0, width: 700, height: 800 });
  });

  it('левая полоса и сужает вид, и сдвигает его начало', () => {
    // Отсчёт идёт от левого края: одной ширины мало, иначе облако
    // центрировалось бы поверх панели фильтров.
    const box = freeViewBox(1000, 800, { ...NO_STRIPS, left: 240 });
    expect(box).toEqual({ left: 240, width: 760, height: 800 });
  });

  it('обе боковые полосы вычитаются одновременно', () => {
    const box = freeViewBox(1000, 800, { left: 240, right: 300, bottom: 0 });
    expect(box).toEqual({ left: 240, width: 460, height: 800 });
  });

  it('нижняя полоса убавляет только высоту', () => {
    const box = freeViewBox(1000, 800, { ...NO_STRIPS, bottom: 120 });
    expect(box).toEqual({ left: 0, width: 1000, height: 680 });
  });

  it('на узком окне не отдаёт нулевой или отрицательный прямоугольник', () => {
    // Панели не помещаются в окно целиком — вписыванию всё равно нужен
    // прямоугольник, в который можно делить.
    const box = freeViewBox(400, 100, { left: 240, right: 300, bottom: 200 });
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
  });

  it('отрицательную полосу считает отсутствующей, а не расширяющей вид', () => {
    // getBoundingClientRect() скрытой или не поместившейся панели умеет
    // возвращать что угодно; отрицательная полоса не должна превращаться в
    // прибавку к ширине.
    const box = freeViewBox(1000, 800, { left: -50, right: -80, bottom: -10 });
    expect(box).toEqual({ left: 0, width: 1000, height: 800 });
  });
});
