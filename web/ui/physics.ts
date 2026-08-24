import {
  DEFAULT_LAYOUT_PARAMS,
  LAYOUT_PARAM_SPECS,
  sanitizeParams,
  type LayoutParams,
} from '../layout/params.js';

export interface PhysicsOptions {
  /** Настройки, с которыми панель открывается: из хранилища либо умолчания. */
  initial?: LayoutParams;
  /** Раскрыта ли панель при монтировании. */
  initialOpen?: boolean;
  /** Зовётся на каждое движение ползунка и на сброс. */
  onChange(params: LayoutParams): void;
  /** Зовётся при сворачивании и разворачивании: точка входа пересчитывает полосу камеры. */
  onToggle?(open: boolean): void;
}

export interface PhysicsHandles {
  unmount(): void;
  /** Текущие настройки панели. */
  params(): LayoutParams;
  /** Раскрыта ли панель сейчас. */
  isOpen(): boolean;
}

/** Счётчик установок — источник уникальных id для связи подписи с ползунком. */
let physicsInstanceCounter = 0;

/**
 * Сколько знаков показывать у величины: шаг 1 — целое, шаг 0.001 — три знака.
 * Считается из шага, а не задаётся вручную: иначе список параметров и список
 * форматов разъезжались бы при каждой правке.
 */
export function decimalsFor(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  const text = String(step);
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
}

/**
 * Панель настроек силовой раскладки: по ползунку на параметр, значение рядом,
 * кнопка сброса.
 *
 * Панель ничего не считает и ничего не помнит про физику — она только собирает
 * значения и отдаёт их наружу целиком. Правило «у каждого факта один держатель»
 * тут значит вот что: настройки живут в точке входа, панель показывает их
 * копию, а воркер получает их сообщением и сам же отбивает негодные.
 */
export function mountPhysics(root: HTMLElement, options: PhysicsOptions): PhysicsHandles {
  root.hidden = false;
  root.replaceChildren();
  const instanceId = physicsInstanceCounter++;

  let current = sanitizeParams(options.initial ?? DEFAULT_LAYOUT_PARAMS);
  let open = options.initialOpen ?? true;

  const header = document.createElement('div');
  header.className = 'physics-header';

  const title = document.createElement('h2');
  title.textContent = 'Физика';
  title.id = `physics-title-${instanceId}`;

  const toggle = document.createElement('button');
  toggle.type = 'button';
  const toggleLabel = (): string => (open ? 'Свернуть настройки физики' : 'Развернуть настройки физики');

  const body = document.createElement('div');
  body.className = 'physics-body';

  function syncOpen(): void {
    body.hidden = !open;
    toggle.textContent = open ? '−' : '+';
    // Значок — символ, а не слово: скринридеру нужно явное имя, и оно обязано
    // меняться вместе с состоянием, иначе кнопка будет врать после первого же
    // нажатия (этот дефект в проекте уже случался).
    toggle.setAttribute('aria-label', toggleLabel());
    toggle.title = toggleLabel();
    toggle.setAttribute('aria-expanded', String(open));
  }

  toggle.addEventListener('click', () => {
    open = !open;
    syncOpen();
    options.onToggle?.(open);
  });

  header.append(title, toggle);

  /** Показ значения рядом с ползунком; обновляется на каждое движение. */
  const readouts = new Map<keyof LayoutParams, HTMLElement>();
  const sliders = new Map<keyof LayoutParams, HTMLInputElement>();

  for (const spec of LAYOUT_PARAM_SPECS) {
    const row = document.createElement('div');
    row.className = 'physics-row';

    const label = document.createElement('label');
    label.textContent = spec.label;
    label.htmlFor = `physics-${instanceId}-${spec.key}`;
    label.title = spec.hint;

    const value = document.createElement('span');
    value.className = 'physics-value';
    value.dataset.value = spec.key;

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.id = label.htmlFor;
    slider.min = String(spec.min);
    slider.max = String(spec.max);
    slider.step = String(spec.step);
    slider.value = String(current[spec.key]);
    slider.title = spec.hint;
    slider.dataset.param = spec.key;
    slider.addEventListener('input', () => {
      current = sanitizeParams({ ...current, [spec.key]: Number(slider.value) });
      syncReadout(spec.key);
      options.onChange({ ...current });
    });

    row.append(label, value, slider);
    body.append(row);
    readouts.set(spec.key, value);
    sliders.set(spec.key, slider);
  }

  function syncReadout(key: keyof LayoutParams): void {
    const spec = LAYOUT_PARAM_SPECS.find((candidate) => candidate.key === key);
    const readout = readouts.get(key);
    if (!spec || !readout) return;
    readout.textContent = current[key].toFixed(decimalsFor(spec.step));
  }

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'physics-reset';
  reset.textContent = 'Вернуть по умолчанию';
  reset.title = 'Вернуть значения, с которыми инструмент открывается на новом репозитории.';
  reset.addEventListener('click', () => {
    current = { ...DEFAULT_LAYOUT_PARAMS };
    for (const spec of LAYOUT_PARAM_SPECS) {
      sliders.get(spec.key)!.value = String(current[spec.key]);
      syncReadout(spec.key);
    }
    options.onChange({ ...current });
  });
  body.append(reset);

  for (const spec of LAYOUT_PARAM_SPECS) syncReadout(spec.key);
  syncOpen();
  root.append(header, body);

  return {
    unmount(): void {
      root.replaceChildren();
      root.hidden = true;
    },
    params: () => ({ ...current }),
    isOpen: () => open,
  };
}
