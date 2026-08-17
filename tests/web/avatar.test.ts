import { describe, it, expect } from 'vitest';
import { avatarColor, initialsFor } from '../../web/render/avatar.js';

describe('initialsFor', () => {
  it('берёт по букве от имени и фамилии', () => {
    expect(initialsFor('Аня Петрова', 'a@e.com')).toBe('АП');
    expect(initialsFor('Ada Lovelace', 'a@e.com')).toBe('AL');
  });

  it('из одного слова берёт одну букву', () => {
    expect(initialsFor('Аня', 'a@e.com')).toBe('А');
  });

  it('не считает третье слово', () => {
    expect(initialsFor('Жан Батист Гренуй', 'a@e.com')).toBe('ЖБ');
  });

  it('переживает лишние пробелы и знаки', () => {
    expect(initialsFor('  анна-мария  ковач ', 'a@e.com')).toBe('АК');
  });

  it('падает на почту, если имени нет', () => {
    expect(initialsFor('', 'zoe@example.com')).toBe('Z');
    expect(initialsFor('   ', 'zoe@example.com')).toBe('Z');
  });

  it('даёт хоть что-то, когда нет ни имени, ни почты', () => {
    expect(initialsFor('', '')).toBe('?');
  });

  it('не ломается на имени из одних знаков', () => {
    expect(initialsFor('<>', 'q@e.com')).toBe('Q');
  });
});

describe('avatarColor', () => {
  it('устойчив: одна почта — один цвет', () => {
    expect(avatarColor('anya@example.com')).toBe(avatarColor('anya@example.com'));
  });

  it('не зависит от регистра и пробелов — как дедупликация авторов', () => {
    expect(avatarColor(' Anya@Example.COM ')).toBe(avatarColor('anya@example.com'));
  });

  it('разводит разные почты по разным цветам', () => {
    const emails = Array.from({ length: 24 }, (_, i) => `dev${i}@example.com`);
    const colors = new Set(emails.map(avatarColor));
    expect(colors.size).toBeGreaterThanOrEqual(18);
  });

  it('возвращает цвет, пригодный для кисти canvas', () => {
    expect(avatarColor('a@e.com')).toMatch(/^hsl\(/);
  });

  it('не падает на пустой почте', () => {
    expect(avatarColor('')).toMatch(/^hsl\(/);
  });
});
