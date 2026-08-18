import type { Page } from '@playwright/test';

/**
 * Сумма непрозрачности холста. Гашение фильтром уменьшает её, но не обнуляет:
 * именно этим «гасит» отличается от «скрывает».
 */
export async function brightness(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.getElementById('scene') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let sum = 0;
    for (let i = 3; i < data.length; i += 4) sum += data[i]!;
    return sum;
  });
}

/**
 * Готовность холста (`data-ready`) не значит, что картинка устоялась: сразу
 * после неё раскладка ещё расходится из тесного стартового кома, а камера
 * непрерывно подстраивает масштаб под неё — на типичном тестовом репозитории
 * суммарная непрозрачность в первые секунды меняется в разы (замерено: 16.6M
 * сразу после готовности → плавно затухает до устойчивых ~915–930K к
 * шестой-восьмой секунде) по причинам, вообще не связанным с тем, что именно
 * проверяет вызывающий тест. `first-frame.spec.ts` уже обходил ровно этот же
 * зазор фиксированной паузой перед проверкой пикселей — здесь фиксированная
 * пауза не годится вдвойне: сквозные тесты меряют яркость по нескольку раз за
 * прогон (эталон и хотя бы одно состояние после действия), и каждая точка
 * обязана быть одинаково устоявшейся. Короткая пауза на медленной машине
 * окажется недостаточной, а с запасом — лишней и раздувающей тест. Вместо
 * паузы опрашиваем яркость, пока несколько подряд замеров не перестанут
 * заметно отличаться — то есть пока раскладка и камера не остановятся сами, а
 * не по внешним часам.
 *
 * Окно и порог подобраны по факту: спад после старта не монотонно резкий, а
 * плавно затухающий (силовая раскладка гасит температуру постепенно), и на
 * коротком окне в пару сотен миллисекунд последовательные замеры сходятся
 * между собой заметно раньше, чем яркость доходит до истинного плато —
 * поэтому окно взято на секунду, а не на три замера подряд.
 */
export async function stableBrightness(page: Page): Promise<number> {
  const POLL_MS = 250;
  const STREAK = 5;
  const TOLERANCE = 0.015;
  const DEADLINE_MS = 20_000;
  const deadline = Date.now() + DEADLINE_MS;
  const recent: number[] = [];
  for (;;) {
    const value = await brightness(page);
    recent.push(value);
    if (recent.length > STREAK) recent.shift();
    if (recent.length === STREAK) {
      const max = Math.max(...recent);
      const min = Math.min(...recent);
      if (max - min <= max * TOLERANCE) return value;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Яркость холста не стабилизировалась за ${DEADLINE_MS} мс: последние замеры ${recent.join(', ')}`,
      );
    }
    await page.waitForTimeout(POLL_MS);
  }
}
