import { describe, it, expect } from 'vitest';
import { Playback } from '../../web/time/playback.js';

describe('Playback', () => {
  it('на паузе не делает шагов', () => {
    let steps = 0;
    const playback = new Playback(() => {
      steps++;
      return true;
    });
    expect(playback.playing).toBe(false);
    expect(playback.advance(10)).toBe(0);
    expect(steps).toBe(0);
  });

  it('делает шаги по скорости в коммитах за секунду', () => {
    let steps = 0;
    const playback = new Playback(() => {
      steps++;
      return true;
    });
    playback.speed = 4;
    playback.play();
    expect(playback.advance(1)).toBe(4);
    expect(steps).toBe(4);
  });

  it('копит дробный остаток между кадрами', () => {
    const playback = new Playback(() => true);
    playback.speed = 2;
    playback.play();
    // Четыре кадра по четверти секунды при скорости два — ровно два шага.
    expect(playback.advance(0.25)).toBe(0);
    expect(playback.advance(0.25)).toBe(1);
    expect(playback.advance(0.25)).toBe(0);
    expect(playback.advance(0.25)).toBe(1);
  });

  it('останавливается, когда история кончилась', () => {
    let remaining = 3;
    const playback = new Playback(() => {
      remaining--;
      return remaining > 0;
    });
    playback.speed = 100;
    playback.play();
    expect(playback.advance(1)).toBe(3);
    expect(playback.playing).toBe(false);
  });

  it('не копит время, пока стоит на паузе', () => {
    const playback = new Playback(() => true);
    playback.speed = 10;
    expect(playback.advance(5)).toBe(0);
    playback.play();
    expect(playback.advance(0.1)).toBe(1);
  });

  it('сбрасывает накопитель по reset', () => {
    const playback = new Playback(() => true);
    playback.speed = 2;
    playback.play();
    playback.advance(0.4);
    playback.reset();
    expect(playback.advance(0.4)).toBe(0);
  });

  it('переключается туда и обратно', () => {
    const playback = new Playback(() => true);
    playback.toggle();
    expect(playback.playing).toBe(true);
    playback.toggle();
    expect(playback.playing).toBe(false);
  });

  it('защищён от гигантского шага времени при возврате вкладки', () => {
    let steps = 0;
    const playback = new Playback(() => {
      steps++;
      return true;
    });
    playback.speed = 8;
    playback.play();
    // Вкладка была свёрнута полчаса: не должно быть тысяч шагов за кадр.
    playback.advance(1800);
    expect(steps).toBeLessThanOrEqual(8);
  });

  it('нечисловое время кадра не портит накопитель', () => {
    let steps = 0;
    const playback = new Playback(() => {
      steps++;
      return true;
    });
    playback.speed = 10;
    playback.play();
    // NaN должен считаться нулевым — кадр пропускается.
    expect(playback.advance(NaN)).toBe(0);
    expect(steps).toBe(0);
    // Накопитель целый, следующий нормальный кадр работает.
    expect(playback.advance(0.2)).toBe(2);
    expect(steps).toBe(2);
  });

  it('бесконечное время кадра не портит накопитель', () => {
    let steps = 0;
    const playback = new Playback(() => {
      steps++;
      return true;
    });
    playback.speed = 5;
    playback.play();
    // Infinity должна считаться нулевой.
    expect(playback.advance(Infinity)).toBe(0);
    expect(steps).toBe(0);
    // Накопитель целый.
    expect(playback.advance(0.1)).toBe(0);
    // После второго кадра 0.2 * 5 = 1 шаг.
    expect(playback.advance(0.1)).toBe(1);
  });

  it('нулевая скорость не прокручивает историю', () => {
    let steps = 0;
    const playback = new Playback(() => {
      steps++;
      return true;
    });
    playback.speed = 0;
    playback.play();
    expect(playback.advance(10)).toBe(0);
    expect(steps).toBe(0);
  });

  it('отрицательная скорость не прокручивает историю', () => {
    let steps = 0;
    const playback = new Playback(() => {
      steps++;
      return true;
    });
    playback.speed = -5;
    playback.play();
    expect(playback.advance(1)).toBe(0);
    expect(steps).toBe(0);
  });

  it('нечисловая скорость не прокручивает историю', () => {
    let steps = 0;
    const playback = new Playback(() => {
      steps++;
      return true;
    });
    (playback as any).speed = NaN;
    playback.play();
    expect(playback.advance(1)).toBe(0);
    expect(steps).toBe(0);
  });

  it('скорость восстанавливает эффект после возврата к нормальной', () => {
    let steps = 0;
    const playback = new Playback(() => {
      steps++;
      return true;
    });
    playback.speed = 0;
    playback.play();
    expect(playback.advance(0.5)).toBe(0);
    // Возвращаем нормальную скорость.
    playback.speed = 4;
    expect(playback.advance(0.5)).toBe(2);
    expect(steps).toBe(2);
  });
});
