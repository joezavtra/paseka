import type { Pack } from '../../src/model/types.js';
import { bucketCommits, drawHistogram } from './histogram.js';

export interface TransportOptions {
  commitCount: number;
  commitTs: Uint32Array;
  onSeek(index: number): void;
  onTogglePlay(): void;
  onSpeedChange(speed: number): void;
}

export interface TransportHandles {
  setCursor(index: number, label: string): void;
  setPlaying(playing: boolean): void;
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

export function mountTransport(root: HTMLElement, options: TransportOptions): TransportHandles {
  root.hidden = false;
  root.replaceChildren();

  const playButton = document.createElement('button');
  playButton.type = 'button';
  playButton.textContent = '▶';
  playButton.title = 'Воспроизвести (пробел)';
  playButton.addEventListener('click', () => options.onTogglePlay());

  const speed = document.createElement('select');
  speed.title = 'Скорость: коммитов в секунду';
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
  slider.addEventListener('input', () => options.onSeek(Number(slider.value)));
  track.append(histogram, slider);

  const label = document.createElement('span');
  label.id = 'cursor-label';

  root.append(playButton, speed, track, label);

  // Гистограмма рисуется после вставки в документ: до этого у канвы нет размера.
  const redraw = () => drawHistogram(histogram, bucketCommits(options.commitTs, 120));
  redraw();
  window.addEventListener('resize', redraw);

  document.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.code !== 'Space') return;
    if (event.target instanceof HTMLElement && event.target.tagName === 'INPUT') return;
    event.preventDefault();
    options.onTogglePlay();
  });

  return {
    setCursor(index: number, text: string): void {
      slider.value = String(index);
      label.textContent = text;
    },
    setPlaying(playing: boolean): void {
      playButton.textContent = playing ? '❚❚' : '▶';
      playButton.title = playing ? 'Пауза (пробел)' : 'Воспроизвести (пробел)';
    },
  };
}
