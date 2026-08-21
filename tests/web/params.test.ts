import { describe, it, expect } from 'vitest';
import {
  DEFAULT_LAYOUT_PARAMS,
  LAYOUT_PARAM_SPECS,
  decodeParams,
  encodeParams,
  sanitizeParams,
  specFor,
  type LayoutParams,
} from '../../web/layout/params.js';

describe('описания параметров', () => {
  it('описан каждый параметр и ничего сверх того', () => {
    // Панель строится из списка описаний: параметр без описания не получит
    // ползунка и станет недоступен молча, лишнее описание — упадёт на specFor.
    const described = LAYOUT_PARAM_SPECS.map((spec) => spec.key).sort();
    const declared = (Object.keys(DEFAULT_LAYOUT_PARAMS) as (keyof LayoutParams)[]).sort();
    expect(described).toEqual(declared);
  });

  it('умолчание каждого параметра лежит внутри его границ', () => {
    for (const spec of LAYOUT_PARAM_SPECS) {
      expect(DEFAULT_LAYOUT_PARAMS[spec.key], spec.key).toBeGreaterThanOrEqual(spec.min);
      expect(DEFAULT_LAYOUT_PARAMS[spec.key], spec.key).toBeLessThanOrEqual(spec.max);
    }
  });

  it('границы и шаг у каждого параметра осмысленны', () => {
    for (const spec of LAYOUT_PARAM_SPECS) {
      expect(spec.min, spec.key).toBeLessThan(spec.max);
      expect(spec.step, spec.key).toBeGreaterThan(0);
      expect(spec.hint.length, spec.key).toBeGreaterThan(10);
    }
  });

  it('specFor находит описание и громко падает на неизвестном ключе', () => {
    expect(specFor('leafCharge').label.length).toBeGreaterThan(0);
    expect(() => specFor('нет такого' as keyof LayoutParams)).toThrow();
  });
});

describe('sanitizeParams', () => {
  it('зажимает значения в границы ползунка', () => {
    const spec = specFor('collideStrength');
    expect(sanitizeParams({ collideStrength: 99 }).collideStrength).toBe(spec.max);
    expect(sanitizeParams({ collideStrength: -99 }).collideStrength).toBe(spec.min);
  });

  it('негодное число заменяет умолчанием, а не пропускает дальше', () => {
    // NaN в силе — это молча застывшая раскладка без единого следа в консоли.
    for (const bad of [NaN, Infinity, -Infinity, '10', null, undefined, {}]) {
      expect(sanitizeParams({ alphaDecay: bad }).alphaDecay).toBe(DEFAULT_LAYOUT_PARAMS.alphaDecay);
    }
  });

  it('чужие ключи не попадают в настройки', () => {
    const result = sanitizeParams({ leafCharge: -5, чужое: 1 }) as unknown as Record<string, unknown>;
    expect(result['чужое']).toBeUndefined();
    expect(result['leafCharge']).toBe(-5);
  });

  it('не объект даёт умолчания целиком', () => {
    expect(sanitizeParams(null)).toEqual(DEFAULT_LAYOUT_PARAMS);
    expect(sanitizeParams('строка')).toEqual(DEFAULT_LAYOUT_PARAMS);
    expect(sanitizeParams(42)).toEqual(DEFAULT_LAYOUT_PARAMS);
  });

  it('не меняет исходный объект и не возвращает его же', () => {
    const source = { ...DEFAULT_LAYOUT_PARAMS, leafCharge: -5 };
    const result = sanitizeParams(source);
    result.leafCharge = -50;
    expect(source.leafCharge).toBe(-5);
  });
});

describe('хранение настроек', () => {
  it('пережитая перезагрузка возвращает те же значения', () => {
    const params: LayoutParams = { ...DEFAULT_LAYOUT_PARAMS, leafCharge: -20, linkMin: 25 };
    expect(decodeParams(encodeParams(params))).toEqual(params);
  });

  it('пустое хранилище даёт умолчания', () => {
    expect(decodeParams(null)).toEqual(DEFAULT_LAYOUT_PARAMS);
  });

  it('испорченное содержимое даёт умолчания, а не падение', () => {
    for (const junk of ['', '{', 'null', '[1,2]', '"строка"', '{"leafCharge":"много"}']) {
      expect(decodeParams(junk)).toEqual(DEFAULT_LAYOUT_PARAMS);
    }
  });

  it('значения из хранилища зажимаются: файл могли править руками', () => {
    expect(decodeParams('{"collideStrength":1000}').collideStrength).toBe(
      specFor('collideStrength').max,
    );
  });
});
