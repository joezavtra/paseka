// @vitest-environment happy-dom
//
// Единственный тестовый файл панели транспорта, которому нужен DOM: только
// здесь монтируется `mountTransport`. Остальные тесты проекта — в среде
// `node` (см. vitest.config.ts), поэтому окружение переключено докблоком
// только для этого файла, а не глобально.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mountTransport, type TransportOptions } from '../../web/ui/transport.js';

// happy-dom создаёт один глобальный `window` на весь файл, а не на каждый
// тест: не размонтированная панель из предыдущего теста продолжает слушать
// resize и keydown и искажает следующий тест. Поэтому каждый mount()
// регистрируется здесь и обязательно размонтируется в afterEach.
let mountedHandles: Array<{ unmount(): void }> = [];

afterEach(() => {
  for (const handles of mountedHandles) handles.unmount();
  mountedHandles = [];
  document.body.replaceChildren();
});

function makeOptions(overrides: Partial<TransportOptions> = {}): TransportOptions & {
  toggleCount: number;
  seeks: number[];
  speeds: number[];
} {
  const seeks: number[] = [];
  const speeds: number[] = [];
  const state = {
    toggleCount: 0,
    seeks,
    speeds,
    commitCount: 5,
    commitEventStart: Uint32Array.from([0, 1, 2, 3, 4, 5]),
    onSeek: (index: number) => seeks.push(index),
    onTogglePlay: () => {
      state.toggleCount++;
    },
    onSpeedChange: (value: number) => speeds.push(value),
    ...overrides,
  };
  return state;
}

function mount(options = makeOptions()) {
  const root = document.createElement('div');
  document.body.append(root);
  const handles = mountTransport(root, options);
  mountedHandles.push(handles);
  const slider = root.querySelector('input[type="range"]') as HTMLInputElement;
  const label = root.querySelector('#cursor-label') as HTMLSpanElement;
  const button = root.querySelector('button') as HTMLButtonElement;
  const select = root.querySelector('select') as HTMLSelectElement;
  return { root, options, handles, slider, label, button, select };
}

describe('mountTransport — слайдер', () => {
  it('границы и шаг слайдера учитывают положение до начала истории', () => {
    const { slider } = mount(makeOptions({ commitCount: 5 }));
    expect(slider.min).toBe('-1');
    expect(slider.max).toBe('4');
    expect(slider.step).toBe('1');
    expect(slider.value).toBe('4');
  });

  it('при пустой истории слайдер стоит в положении "до начала истории"', () => {
    const { slider } = mount(
      makeOptions({ commitCount: 0, commitEventStart: Uint32Array.from([0]) }),
    );
    expect(slider.min).toBe('-1');
    expect(slider.max).toBe('-1');
    expect(slider.value).toBe('-1');
  });

  it('setCursor двигает слайдер и подпись синхронно, не сбивая друг друга', () => {
    const { handles, slider, label } = mount();
    handles.setCursor(2, 'метка A');
    expect(slider.value).toBe('2');
    expect(label.textContent).toBe('метка A');

    handles.setCursor(-1, 'до начала истории');
    expect(slider.value).toBe('-1');
    expect(label.textContent).toBe('до начала истории');

    handles.setCursor(0, 'метка B');
    expect(slider.value).toBe('0');
    expect(label.textContent).toBe('метка B');
  });
});

describe('mountTransport — горячая клавиша пробел', () => {
  it('срабатывает в обычном случае, когда фокус не в элементе управления', () => {
    const { options } = mount();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'Space', bubbles: true, cancelable: true }),
    );
    expect(options.toggleCount).toBe(1);
  });

  it('не срабатывает при фокусе в списке выбора скорости', () => {
    const { options, select } = mount();
    select.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'Space', bubbles: true, cancelable: true }),
    );
    expect(options.toggleCount).toBe(0);
  });

  it('не срабатывает при фокусе в постороннем поле ввода', () => {
    const { options } = mount();
    const input = document.createElement('input');
    document.body.append(input);
    input.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'Space', bubbles: true, cancelable: true }),
    );
    expect(options.toggleCount).toBe(0);
  });

  it('не мешает клавиатурной работе со слайдером', () => {
    const { options, slider } = mount();
    slider.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'Space', bubbles: true, cancelable: true }),
    );
    // Пробел на самом слайдере — тоже зарезервированный элемент (INPUT):
    // глобальный тоггл воспроизведения не должен перехватывать его у слайдера.
    expect(options.toggleCount).toBe(0);
  });
});

describe('mountTransport — доступное имя кнопки воспроизведения', () => {
  it('задано при монтировании и меняется вместе с состоянием', () => {
    const { handles, button } = mount();
    expect(button.getAttribute('aria-label')).toBe('Воспроизвести (пробел)');

    handles.setPlaying(true);
    expect(button.textContent).toBe('❚❚');
    expect(button.getAttribute('aria-label')).toBe('Пауза (пробел)');
    expect(button.title).toBe('Пауза (пробел)');

    handles.setPlaying(false);
    expect(button.getAttribute('aria-label')).toBe('Воспроизвести (пробел)');
  });
});

describe('mountTransport — unmount', () => {
  it('снимает обработчик клавиатуры: пробел после размонтирования не переключает воспроизведение', () => {
    const { options, handles } = mount();
    handles.unmount();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'Space', bubbles: true, cancelable: true }),
    );
    expect(options.toggleCount).toBe(0);
  });

  it('снимает обработчик resize: перерисовки гистограммы после размонтирования не происходит', () => {
    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');
    const { handles } = mount();
    const callsWhileMounted = getContextSpy.mock.calls.length;
    expect(callsWhileMounted).toBeGreaterThan(0);

    handles.unmount();
    window.dispatchEvent(new Event('resize'));
    expect(getContextSpy.mock.calls.length).toBe(callsWhileMounted);
    getContextSpy.mockRestore();
  });

  it('очищает содержимое корневого элемента', () => {
    const { root, handles } = mount();
    expect(root.children.length).toBeGreaterThan(0);
    handles.unmount();
    expect(root.children.length).toBe(0);
  });
});
