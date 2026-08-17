import { describe, it, expect } from 'vitest';
import { matchesGlob } from '../../web/state/glob.js';

describe('matchesGlob', () => {
  it('пустой образец подходит всему', () => {
    expect(matchesGlob('src/a.ts', '')).toBe(true);
    expect(matchesGlob('', '   ')).toBe(true);
  });

  it('без подстановок ищет подстроку без учёта регистра', () => {
    expect(matchesGlob('src/Utils.ts', 'utils')).toBe(true);
    expect(matchesGlob('src/utils.ts', 'SRC/')).toBe(true);
    expect(matchesGlob('src/utils.ts', 'docs')).toBe(false);
  });

  it('звёздочка заменяет любую последовательность, включая слэши', () => {
    expect(matchesGlob('src/deep/a.ts', 'src/*.ts')).toBe(true);
    expect(matchesGlob('src/deep/a.ts', '*.md')).toBe(false);
  });

  it('вопрос заменяет ровно один символ', () => {
    expect(matchesGlob('a.ts', '?.ts')).toBe(true);
    expect(matchesGlob('ab.ts', '?.ts')).toBe(false);
  });

  it('образец с подстановкой якорится целиком', () => {
    expect(matchesGlob('src/a.ts', 'src/*')).toBe(true);
    expect(matchesGlob('lib/src/a.ts', 'src/*')).toBe(false);
  });

  it('не путается в служебных символах регулярных выражений', () => {
    expect(matchesGlob('a+b(c).ts', 'a+b(c).ts')).toBe(true);
    expect(matchesGlob('axb.ts', 'a.b.ts')).toBe(false);
  });

  it('переживает мусорный образец', () => {
    expect(matchesGlob('a.ts', '[')).toBe(false);
    expect(matchesGlob('[', '[')).toBe(true);
  });

  it('патологический образец с несколькими звёздочками не проседает по времени', () => {
    const path = 'a'.repeat(40);
    const pattern = `${'a*'.repeat(10)}b`; // в пути нет "b" — совпадения не будет
    const start = performance.now();
    const result = matchesGlob(path, pattern);
    const elapsed = performance.now() - start;
    expect(result).toBe(false);
    expect(elapsed).toBeLessThan(500);
  });

  it('очень длинный образец с подстановкой не бросает исключение', () => {
    const pattern = `${'a'.repeat(50000)}*`;
    expect(() => matchesGlob('что угодно', pattern)).not.toThrow();
  });

  it('образец из одних звёздочек подходит всему, включая пустую строку', () => {
    expect(matchesGlob('', '***')).toBe(true);
    expect(matchesGlob('src/deep/a.ts', '***')).toBe(true);
  });

  it('подстановка вместе со служебными символами сопоставляется буквально', () => {
    expect(matchesGlob('a(b)c.ts', 'a(*)c.ts')).toBe(true);
    expect(matchesGlob('a[b]c.ts', 'a(*)c.ts')).toBe(false);
  });

  it('не-латиница разного регистра совпадает в обеих ветках', () => {
    expect(matchesGlob('Файл/Утилиты.ts', 'утилиты')).toBe(true);
    expect(matchesGlob('Файл/Утилиты.ts', 'ФАЙЛ/*.ts')).toBe(true);
  });
});
