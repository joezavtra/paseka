/** Ограничение на один кадр: свёрнутая вкладка не должна прокрутить всю историю. */
const MAX_STEP_SECONDS = 1;

/**
 * Воспроизведение по коммитам, а не по календарным датам: иначе полугодовой
 * перерыв в истории превращается в полминуты мёртвого экрана.
 */
export class Playback {
  /** Коммитов в секунду. */
  speed = 2;

  private running = false;
  private carry = 0;

  /** Колбэк делает один шаг и возвращает false, когда история кончилась. */
  constructor(private readonly onStep: () => boolean) {}

  get playing(): boolean {
    return this.running;
  }

  play(): void {
    this.running = true;
  }

  pause(): void {
    this.running = false;
    this.carry = 0;
  }

  toggle(): void {
    if (this.running) this.pause();
    else this.play();
  }

  /** Забывает накопленный дробный остаток — нужно после перемотки слайдером. */
  reset(): void {
    this.carry = 0;
  }

  /** Продвигает воспроизведение на прошедшее время; возвращает число шагов. */
  advance(dtSeconds: number): number {
    if (!this.running) return 0;

    this.carry += Math.min(Math.max(dtSeconds, 0), MAX_STEP_SECONDS) * this.speed;
    let steps = 0;
    while (this.carry >= 1) {
      this.carry -= 1;
      steps++;
      if (!this.onStep()) {
        this.pause();
        break;
      }
    }
    return steps;
  }
}
