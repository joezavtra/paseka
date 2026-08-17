import { describePack, loadPack, showFatal } from './boot.js';
import { aliveAt, sizesAt } from './time/alive.js';
import { buildLayoutGraph, radiusFor } from './layout/graph.js';
import type { FromWorker, LayoutInit } from './layout/protocol.js';
import { Camera } from './render/camera.js';
import { colorForPath, drawScene, type SceneInput } from './render/scene.js';

async function start(): Promise<void> {
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const status = document.getElementById('status');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    showFatal('Браузер не дал контекст canvas 2D.');
    return;
  }

  const pack = await loadPack();
  if (status) status.textContent = describePack(pack);

  const head = Math.max(0, pack.meta.commitCount - 1);
  const alive = aliveAt(pack, head);
  const sizes = sizesAt(pack, head);
  const graph = buildLayoutGraph(alive, pack.pathParent);

  const radius = new Float32Array(graph.nodeIds.length);
  const color: string[] = [];
  for (let i = 0; i < graph.nodeIds.length; i++) {
    const path = graph.nodeIds[i]!;
    const isDir = pack.pathIsDir[path] === 1;
    radius[i] = radiusFor(sizes[path]!, isDir);
    color.push(isDir ? '#39414d' : colorForPath(pack.paths[path]!));
  }

  const scene: SceneInput = {
    positions: new Float32Array(graph.nodeIds.length * 2),
    radius,
    color,
    linkSource: graph.linkSource,
    linkTarget: graph.linkTarget,
  };

  const camera = new Camera();
  camera.attach(canvas);
  let fitted = false;

  const worker = new Worker(new URL('./layout/worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<FromWorker>) => {
    if (event.data.type !== 'positions') return;
    scene.positions = event.data.positions;
    if (!fitted && event.data.alpha < 0.3) {
      camera.fit(scene.positions, canvas.clientWidth, canvas.clientHeight);
      fitted = true;
    }
  };
  // Ловит и ошибку загрузки/сборки модуля воркера, и необработанное исключение
  // внутри него: без этого раскладка молча не запускается, а узлы навсегда
  // остаются слипшимися в точке (0, 0) — без объяснения на экране.
  worker.onerror = (event: ErrorEvent) => {
    // event.message бывает пустым (например, для некоторых ошибок разрешения
    // модуля) — не показываем пользователю буквальное "undefined".
    const detail = event.message || 'подробности недоступны';
    showFatal(`Раскладка не запустилась: воркер аварийно завершился. ${detail}`);
  };

  const init: LayoutInit = {
    type: 'init',
    nodeCount: graph.nodeIds.length,
    linkSource: graph.linkSource,
    linkTarget: graph.linkTarget,
    radius,
    seed: 20260817,
  };
  worker.postMessage(init);

  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  window.addEventListener('resize', resize);
  resize();

  // Если drawScene бросит исключение (например, из-за рассинхронизации данных),
  // не даём циклу отрисовки молча остановиться на недостижимом requestAnimationFrame:
  // показываем причину пользователю и осознанно прекращаем цикл, один раз.
  const frame = () => {
    try {
      drawScene(ctx, camera, scene, canvas.clientWidth, canvas.clientHeight);
    } catch (error) {
      showFatal(
        `Не удалось отрисовать кадр: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  canvas.dataset.ready = 'true';
}

start().catch((error: unknown) => {
  showFatal(error instanceof Error ? error.message : 'Не удалось построить визуализацию.');
});
