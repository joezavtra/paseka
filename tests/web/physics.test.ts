// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { decimalsFor, mountPhysics, type PhysicsHandles } from '../../web/ui/physics.js';
import {
  DEFAULT_LAYOUT_PARAMS,
  LAYOUT_PARAM_SPECS,
  specFor,
  type LayoutParams,
} from '../../web/layout/params.js';

/**
 * Панели сносим после каждого теста: они вешают обработчики на свои элементы,
 * а корневой узел живёт в общем документе файла (тот же приём, что в
 * tests/web/sidebar.test.ts).
 */
const mounted: PhysicsHandles[] = [];
afterEach(() => {
  while (mounted.length > 0) mounted.pop()!.unmount();
});

function mount(options: Parameters<typeof mountPhysics>[1]): {
  root: HTMLElement;
  handles: PhysicsHandles;
} {
  const root = document.createElement('section');
  const handles = mountPhysics(root, options);
  mounted.push(handles);
  return { root, handles };
}

const sliderFor = (root: HTMLElement, key: keyof LayoutParams): HTMLInputElement => {
  const slider = root.querySelector<HTMLInputElement>(`input[data-param="${key}"]`);
  if (!slider) throw new Error(`нет ползунка ${key}`);
  return slider;
};

const readoutFor = (root: HTMLElement, key: keyof LayoutParams): string =>
  root.querySelector(`[data-value="${key}"]`)?.textContent ?? '';

describe('decimalsFor', () => {
  it('число знаков берётся из шага, а не задаётся вручную', () => {
    expect(decimalsFor(1)).toBe(0);
    expect(decimalsFor(0.5)).toBe(1);
    expect(decimalsFor(0.05)).toBe(2);
    expect(decimalsFor(0.001)).toBe(3);
  });

  it('негодный шаг не роняет показ значения', () => {
    expect(decimalsFor(0)).toBe(0);
    expect(decimalsFor(NaN)).toBe(0);
  });
});

describe('панель физики', () => {
  it('показывает ползунок на каждый параметр', () => {
    const { root } = mount({ onChange: () => {} });
    for (const spec of LAYOUT_PARAM_SPECS) {
      const slider = sliderFor(root, spec.key);
      expect(slider.min, spec.key).toBe(String(spec.min));
      expect(slider.max, spec.key).toBe(String(spec.max));
      expect(slider.value, spec.key).toBe(String(DEFAULT_LAYOUT_PARAMS[spec.key]));
    }
  });

  it('открывается со значениями из хранилища, а не с умолчаниями', () => {
    const initial: LayoutParams = { ...DEFAULT_LAYOUT_PARAMS, leafCharge: -33, linkMin: 21 };
    const { root, handles } = mount({ initial, onChange: () => {} });
    expect(sliderFor(root, 'leafCharge').value).toBe('-33');
    expect(handles.params().linkMin).toBe(21);
  });

  it('негодные значения из хранилища зажимаются до монтирования', () => {
    const { root } = mount({
      initial: { ...DEFAULT_LAYOUT_PARAMS, collideStrength: 99 },
      onChange: () => {},
    });
    expect(sliderFor(root, 'collideStrength').value).toBe(String(specFor('collideStrength').max));
  });

  it('движение ползунка отдаёт наружу все настройки целиком', () => {
    const seen: LayoutParams[] = [];
    const { root } = mount({ onChange: (params) => seen.push(params) });

    const slider = sliderFor(root, 'leafCharge');
    slider.value = '-25';
    slider.dispatchEvent(new Event('input', { bubbles: true }));

    expect(seen).toHaveLength(1);
    expect(seen[0]!.leafCharge).toBe(-25);
    // Остальные параметры приходят вместе с изменённым: воркеру нужен полный
    // набор, а не разница.
    expect(seen[0]!.linkMin).toBe(DEFAULT_LAYOUT_PARAMS.linkMin);
  });

  it('показ значения обновляется вместе с ползунком и уважает шаг', () => {
    const { root } = mount({ onChange: () => {} });
    expect(readoutFor(root, 'alphaDecay')).toBe(DEFAULT_LAYOUT_PARAMS.alphaDecay.toFixed(3));

    const slider = sliderFor(root, 'alphaDecay');
    slider.value = '0.042';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    expect(readoutFor(root, 'alphaDecay')).toBe('0.042');
  });

  it('сброс возвращает замеренные умолчания и сообщает о них наружу', () => {
    const seen: LayoutParams[] = [];
    const { root, handles } = mount({
      initial: { ...DEFAULT_LAYOUT_PARAMS, leafCharge: -50 },
      onChange: (params) => seen.push(params),
    });

    root.querySelector<HTMLButtonElement>('.physics-reset')!.click();

    expect(handles.params()).toEqual(DEFAULT_LAYOUT_PARAMS);
    expect(sliderFor(root, 'leafCharge').value).toBe(String(DEFAULT_LAYOUT_PARAMS.leafCharge));
    expect(seen.at(-1)).toEqual(DEFAULT_LAYOUT_PARAMS);
  });

  it('сворачивается и разворачивается, сообщая об этом наружу', () => {
    const toggles: boolean[] = [];
    const { root, handles } = mount({ onChange: () => {}, onToggle: (open) => toggles.push(open) });
    const body = root.querySelector<HTMLElement>('.physics-body')!;
    const button = root.querySelector<HTMLButtonElement>('.physics-header button')!;

    expect(handles.isOpen()).toBe(true);
    expect(body.hidden).toBe(false);

    button.click();
    expect(handles.isOpen()).toBe(false);
    expect(body.hidden).toBe(true);
    expect(toggles).toEqual([false]);

    button.click();
    expect(toggles).toEqual([false, true]);
  });

  it('кнопка сворачивания читается скринридером и не врёт после нажатия', () => {
    const { root } = mount({ onChange: () => {} });
    const button = root.querySelector<HTMLButtonElement>('.physics-header button')!;
    const first = button.getAttribute('aria-label') ?? '';
    expect(first).toMatch(/[А-Яа-я]/);
    expect(button.getAttribute('aria-expanded')).toBe('true');

    button.click();
    expect(button.getAttribute('aria-label')).not.toBe(first);
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('можно открыть свёрнутой: состояние приходит снаружи', () => {
    const { root, handles } = mount({ onChange: () => {}, initialOpen: false });
    expect(handles.isOpen()).toBe(false);
    expect(root.querySelector<HTMLElement>('.physics-body')!.hidden).toBe(true);
  });

  it('каждый ползунок связан со своей подписью', () => {
    const { root } = mount({ onChange: () => {} });
    for (const spec of LAYOUT_PARAM_SPECS) {
      const slider = sliderFor(root, spec.key);
      const label = root.querySelector<HTMLLabelElement>(`label[for="${slider.id}"]`);
      expect(label?.textContent, spec.key).toBe(spec.label);
    }
  });

  it('две панели в одном документе не делят идентификаторы', () => {
    const first = mount({ onChange: () => {} });
    const second = mount({ onChange: () => {} });
    expect(sliderFor(first.root, 'leafCharge').id).not.toBe(sliderFor(second.root, 'leafCharge').id);
  });
});
