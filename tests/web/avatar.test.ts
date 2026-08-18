import { describe, it, expect, vi } from 'vitest';
import {
  AVATAR_LIGHTNESS,
  avatarColor,
  avatarStyle,
  computeSafeHues,
  HUE_MARGIN,
  initialsFor,
} from '../../web/render/avatar.js';
import { PALETTE, SCENE_BACKGROUND } from '../../web/render/palette.js';

/**
 * Независимая от реализации проверка оттенка: пересчитываем HSL из hex сами,
 * а не переиспользуем внутренние функции avatar.ts — иначе тест проверял бы
 * только то, что реализация согласна сама с собой.
 */
function hexToHue(hex: string): number | null {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return null;
  const d = max - min;
  const h =
    max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

function hslToHex(h: number, s: number, l: number): string {
  const sf = s / 100;
  const lf = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sf * Math.min(lf, 1 - lf);
  const f = (n: number) => lf - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (v: number) =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

function hueOfColor(color: string): number {
  const match = color.match(/^hsl\((\d+(?:\.\d+)?)/);
  if (!match) throw new Error(`не hsl(...): ${color}`);
  return Number(match[1]);
}

function hueDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return Math.min(diff, 360 - diff);
}

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

  it('оттенок значка держит отступ HUE_MARGIN от каждого оттенка палитры узлов', () => {
    // Само свойство, ради которого заведён SAFE_HUES: не «код это гарантирует»,
    // а прямая проверка на выборке почт против настоящей PALETTE.
    const paletteHues = PALETTE.map(hexToHue).filter((h): h is number => h !== null);
    const emails = Array.from({ length: 40 }, (_, i) => `dev${i}@example.com`);
    for (const email of emails) {
      const hue = hueOfColor(avatarColor(email));
      for (const paletteHue of paletteHues) {
        expect(hueDistance(hue, paletteHue)).toBeGreaterThanOrEqual(HUE_MARGIN);
      }
    }
  });
});

describe('computeSafeHues: вырожденный случай плотной палитры', () => {
  // Палитра с образцом через каждые 10° по всему кругу: до любого градуса не
  // дальше 5°, поэтому отступ в 20° не выдержать нигде — ровно вырожденный
  // случай, который обязан быть замечен, а не тихо испорчен.
  const densePalette = Array.from({ length: 36 }, (_, i) => hslToHex(i * 10, 70, 60));

  it('не схлопывается в пустоту и не даёт NaN — откатывается к полному кругу', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const safe = computeSafeHues(densePalette, HUE_MARGIN);
    warn.mockRestore();

    expect(safe.length).toBe(360);
    expect(safe.every((h) => Number.isFinite(h))).toBe(true);
  });

  it('громко предупреждает о переходе на вырожденный откат', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    computeSafeHues(densePalette, HUE_MARGIN);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('на просторной палитре откат не срабатывает и предупреждения нет', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const safe = computeSafeHues(PALETTE, HUE_MARGIN);
    warn.mockRestore();

    expect(safe.length).toBeGreaterThan(0);
    expect(safe.length).toBeLessThan(360);
    expect(warn).not.toHaveBeenCalled();
  });
});

// Цвет фона берётся из кода (SCENE_BACKGROUND, web/render/palette.ts), а не
// повторяется здесь своей копией: значок лежит на этом фоне, и контраст к нему
// — то, что определяет читаемость, а не светлота сама по себе. Со своей копией
// проверка молчала бы ровно в том случае, ради которого она и написана: фон
// сцены поменяли, а инициалы на нём перестали читаться. Сам пересчёт по WCAG
// ниже остаётся независимым от реализации.

/** sRGB-компонента 0..1 → линейная, шаг относительной яркости по WCAG. */
function srgbToLinear(c: number): number {
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Относительная яркость по WCAG для #rrggbb. */
function relativeLuminanceHex(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const [rl, gl, bl] = [r, g, b].map(srgbToLinear);
  return 0.2126 * rl! + 0.7152 * gl! + 0.0722 * bl!;
}

/** Относительная яркость по WCAG для hsl(h s% l%), h в градусах, s/l в процентах. */
function relativeLuminanceHsl(h: number, s: number, l: number): number {
  const sf = s / 100;
  const lf = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sf * Math.min(lf, 1 - lf);
  const f = (n: number) => lf - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return relativeLuminanceHex(
    `#${[f(0), f(8), f(4)]
      .map((v) =>
        Math.round(v * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')}`,
  );
}

/** Коэффициент контрастности по WCAG: (L_светлее + 0.05) / (L_темнее + 0.05). */
function contrastRatio(l1: number, l2: number): number {
  const [lighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

describe('вторая ось цвета значка', () => {
  const hues = computeSafeHues(PALETTE, HUE_MARGIN);
  const corpus = Array.from({ length: 300 }, (_, i) => `user${i}@example.com`);

  it('уровни светлоты различимы глазом', () => {
    // Уровни, отличающиеся на пару процентов, дали бы формально разные цвета
    // и ровно ту же путаницу: ось есть, толку нет. Сам порог не магическое
    // число 8 — важно, что соседи ощутимо разные; настоящая граница снизу это
    // контраст с фоном сцены, и её проверяет отдельный тест ниже.
    const sorted = [...AVATAR_LIGHTNESS].sort((a, b) => a - b);
    expect(sorted.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]! - sorted[i - 1]!).toBeGreaterThanOrEqual(6);
    }
  });

  it('значок держит WCAG AA с запасом на любом безопасном оттенке', () => {
    // Инициалы внутри значка тёмные, поэтому контраст, который важен на
    // самом деле, — это заливка значка hsl(hue 70% lightness%) против фона
    // сцены, а не сама по себе светлота. Порог светлоты 45 форматально
    // проходил бы тест на разброс, но на реальной палитре узлов давал
    // 3.02:1 — заведомо нечитаемые инициалы; здесь считаем то, что важно,
    // напрямую и независимо от того, как это делает реализация.
    const bgLuminance = relativeLuminanceHex(SCENE_BACKGROUND);
    for (const lightness of AVATAR_LIGHTNESS) {
      for (const hue of hues) {
        const ratio = contrastRatio(relativeLuminanceHsl(hue, 70, lightness), bgLuminance);
        expect(ratio).toBeGreaterThanOrEqual(5);
      }
    }
  });

  it('различает больше авторов, чем один только оттенок', () => {
    const twoAxis = new Set(
      corpus.map((email) => {
        const style = avatarStyle(email, hues, AVATAR_LIGHTNESS);
        return `${style.hue}/${style.lightness}`;
      }),
    );
    const oneAxis = new Set(
      corpus.map((email) => `${avatarStyle(email, hues, [66]).hue}/66`),
    );
    expect(twoAxis.size).toBeGreaterThan(oneAxis.size);
  });

  it('оттенок остаётся безопасным относительно палитры узлов', () => {
    for (const email of corpus) {
      expect(hues).toContain(avatarStyle(email, hues, AVATAR_LIGHTNESS).hue);
    }
  });

  it('цвет по-прежнему выводится только из почты и не зависит от регистра', () => {
    expect(avatarColor(' Anya@E.com ')).toBe(avatarColor('anya@e.com'));
    expect(avatarColor('anya@e.com')).toMatch(/^hsl\(\d+ 70% \d+%\)$/);
  });
});
