import type { Pack } from '../../src/model/types.js';
import { bucketActivity, bucketCountForWidth, drawHistogram } from './histogram.js';

export interface TransportOptions {
  commitCount: number;
  /**
   * CSR-смещения событий по коммитам (`Pack.commitEventStart`): из них
   * гистограмма считает объём изменений в диапазоне индексов корзины.
   * Времён коммитов здесь нет намеренно — дорожка живёт в оси слайдера,
   * то есть в индексах, а не в датах.
   */
  commitEventStart: Uint32Array;
  onSeek(index: number): void;
  onTogglePlay(): void;
  onSpeedChange(speed: number): void;
}

export interface TransportHandles {
  setCursor(index: number, label: string): void;
  setPlaying(playing: boolean): void;
  /** Снимает глобальные обработчики (resize, keydown) и очищает корневой элемент. */
  unmount(): void;
}

const SPEEDS = [0.5, 1, 2, 4, 8];

/** Подпись под курсором: дата, короткий хэш и тема коммита. */
export function formatCommitLabel(pack: Pack, index: number): string {
  if (index < 0) return 'до начала истории';
  const clamped = Math.min(index, pack.meta.commitCount - 1);
  if (clamped < 0) return 'до начала истории';
  const date = new Date(pack.commitTs[clamped]! * 1000).toISOString().slice(0, 10);
  const subject = pack.commitSubject[clamped] ?? '';
  const hash = (pack.commitHash[clamped] ?? '').slice(0, 7);
  return subject.length > 0 ? `${date} · ${hash} · ${subject}` : `${date} · ${hash}`;
}

/**
 * Есть ли у пробела на этом элементе собственное поведение (открыть список,
 * вставить символ, переключиться в редактируемой области) — тогда глобальную
 * горячую клавишу воспроизведения нужно пропустить и отдать пробел элементу.
 */
function ownsSpaceKey(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return true;
  return target.isContentEditable;
}

export function mountTransport(root: HTMLElement, options: TransportOptions): TransportHandles {
  root.hidden = false;
  root.replaceChildren();

  const playLabel = (playing: boolean): string => (playing ? 'Пауза (пробел)' : 'Воспроизвести (пробел)');

  const playButton = document.createElement('button');
  playButton.type = 'button';
  playButton.textContent = '▶';
  playButton.title = playLabel(false);
  // Текст кнопки — юникодный значок, скринридер не должен озвучивать его как
  // текст: явное доступное имя держим в паре с заголовком и обновляем вместе.
  playButton.setAttribute('aria-label', playLabel(false));
  playButton.addEventListener('click', () => options.onTogglePlay());

  const speed = document.createElement('select');
  speed.title = 'Скорость: коммитов в секунду';
  speed.setAttribute('aria-label', 'Скорость: коммитов в секунду');
  for (const value of SPEEDS) {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = `${value}×`;
    if (value === 2) option.selected = true;
    speed.append(option);
  }
  speed.addEventListener('change', () => options.onSpeedChange(Number(speed.value)));

  const track = document.createElement('div');
  track.id = 'track';
  const histogram = document.createElement('canvas');
  histogram.id = 'histogram';
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '-1';
  slider.max = String(Math.max(-1, options.commitCount - 1));
  slider.step = '1';
  slider.value = String(Math.max(-1, options.commitCount - 1));
  slider.title = 'Перемотка по коммитам';
  slider.setAttribute('aria-label', 'Перемотка по коммитам');
  slider.addEventListener('input', () => options.onSeek(Number(slider.value)));
  track.append(histogram, slider);

  const label = document.createElement('span');
  label.id = 'cursor-label';

  root.append(playButton, speed, track, label);

  // Гистограмма рисуется после вставки в документ: до этого у канвы нет размера.
  // Число корзин пересчитывается на каждую перерисовку, потому что зависит от
  // фактической ширины дорожки, а она меняется вместе с шириной окна.
  const redraw = (): void =>
    drawHistogram(
      histogram,
      bucketActivity(options.commitEventStart, bucketCountForWidth(histogram.clientWidth)),
    );
  redraw();
  window.addEventListener('resize', redraw);

  const handleKeydown = (event: KeyboardEvent): void => {
    if (event.code !== 'Space') return;
    if (ownsSpaceKey(event.target)) return;
    event.preventDefault();
    options.onTogglePlay();
  };
  document.addEventListener('keydown', handleKeydown);

  return {
    setCursor(index: number, text: string): void {
      slider.value = String(index);
      label.textContent = text;
    },
    setPlaying(playing: boolean): void {
      playButton.textContent = playing ? '❚❚' : '▶';
      const title = playLabel(playing);
      playButton.title = title;
      playButton.setAttribute('aria-label', title);
    },
    unmount(): void {
      window.removeEventListener('resize', redraw);
      document.removeEventListener('keydown', handleKeydown);
      root.replaceChildren();
    },
  };
}
