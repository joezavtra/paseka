import { defineConfig } from '@playwright/test';

/**
 * В CI поведение другое, и не ради строгости, а по существу.
 *
 * `workers: 1` — сквозные тесты поднимают по процессу CLI и меряют устойчивость
 * живой силовой раскладки: `inspector-search.spec.ts` опрашивает картинку, пока
 * d3-force тикает. На двухъядерном раннере параллельные прогоны отбирают друг у
 * друга процессор, и такие проверки превращаются в лотерею.
 *
 * `trace`, `screenshot`, `video` — иначе при падении в CI складывать в артефакты
 * нечего, а воспроизвести падение canvas-приложения по одной строке лога нельзя.
 *
 * `retries: 1` — минимальная страховка от разовой флакости. Одиночная повторная
 * попытка ещё видна в отчёте и не даёт спрятать регулярный флак.
 */
const ci = !!process.env.CI;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  workers: ci ? 1 : undefined,
  reporter: ci ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    headless: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
