import { describePack, loadPack, showFatal } from './boot.js';
import { TimeEngine, type TimeDelta } from './time/engine.js';
import { buildActiveLinks, radiusFor } from './layout/graph.js';
import type { FromWorker, LayoutInit, LayoutUpdate } from './layout/protocol.js';
import { Camera } from './render/camera.js';
import { colorForPath, drawScene, type SceneInput } from './render/scene.js';
import type { Pack } from '../src/model/types.js';

const DIR_COLOR = '#39414d';

async function start(): Promise<void> {
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const status = document.getElementById('status');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    showFatal('Браузер не дал контекст canvas 2D.');
    return;
  }

  const pack: Pack = await loadPack();
  const { pathCount } = pack.meta;

  const color: string[] = new Array<string>(pathCount);
  for (let path = 0; path < pathCount; path++) {
    color[path] = pack.pathIsDir[path] === 1 ? DIR_COLOR : colorForPath(pack.paths[path]!);
  }

  const scene: SceneInput = {
    active: new Uint8Array(pathCount),
    positions: new Float32Array(pathCount * 2),
    radius: new Float32Array(pathCount),
    color,
    linkSource: new Uint32Array(0),
    linkTarget: new Uint32Array(0),
  };

  const camera = new Camera();
  camera.attach(canvas);
  let fitted = false;

  const worker = new Worker(new URL('./layout/worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<FromWorker>) => {
    if (event.data.type !== 'positions') return;
    scene.positions = event.data.positions;
    // Вписываем камеру один раз — но только когда вписывать действительно было
    // что: на пустой сцене fitActive ничего не делает, и поднимать флаг нельзя.
    if (!fitted && event.data.alpha < 0.3) {
      fitted = camera.fitActive(
        scene.positions,
        scene.active,
        canvas.clientWidth,
        canvas.clientHeight,
      );
    }
  };
  // Ловит и ошибку загрузки модуля воркера, и необработанное исключение внутри
  // него: без этого раскладка молча не запускается, а узлы остаются в нуле.
  worker.onerror = (event: ErrorEvent) => {
    const detail = event.message || 'подробности недоступны';
    showFatal(`Раскладка не запустилась: воркер аварийно завершился. ${detail}`);
  };

  const init: LayoutInit = { type: 'init', pathCount, seed: 20260817 };
  worker.postMessage(init);

  const engine = new TimeEngine(pack);

  /**
   * Переносит разницу движка времени в сцену и в воркер.
   * `full` обязателен после перемотки: `seek` не сообщает затронутые пути, а
   * размеры при этом меняются у любого выжившего файла — без полного обхода
   * радиусы остались бы от прежнего положения курсора.
   */
  function applyDelta(delta: TimeDelta, full = false): void {
    scene.active.set(engine.alive);

    const radiusIds: number[] = [];
    const radiusValues: number[] = [];
    const remember = (path: number) => {
      // Округляем до float32: scene.radius хранит именно его, и без округления
      // сравнение «изменилось ли» было бы истинным всегда.
      const next = Math.fround(radiusFor(engine.sizes[path]!, pack.pathIsDir[path] === 1));
      if (scene.radius[path] === next) return;
      scene.radius[path] = next;
      radiusIds.push(path);
      radiusValues.push(next);
    };
    if (full) {
      for (let path = 0; path < pathCount; path++) {
        if (scene.active[path] === 1) remember(path);
      }
    } else {
      for (const path of delta.added) remember(path);
      for (const path of delta.touched) remember(path);
    }

    const links = buildActiveLinks(scene.active, pack.pathParent);
    scene.linkSource = links.source;
    scene.linkTarget = links.target;

    const parentOf = new Uint32Array(delta.added.length);
    for (let i = 0; i < delta.added.length; i++) {
      parentOf[i] = pack.pathParent[delta.added[i]!]!;
    }

    const update: LayoutUpdate = {
      type: 'update',
      added: delta.added,
      removed: delta.removed,
      radiusIds: Uint32Array.from(radiusIds),
      radiusValues: Float32Array.from(radiusValues),
      linkSource: links.source,
      linkTarget: links.target,
      parentOf,
    };
    worker.postMessage(update);

    if (status) {
      let live = 0;
      for (let path = 0; path < pathCount; path++) if (scene.active[path] === 1) live++;
      status.textContent = `${describePack(pack)} · узлов: ${live}`;
    }
  }

  applyDelta(engine.seek(pack.meta.commitCount - 1), true);

  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  window.addEventListener('resize', resize);
  resize();

  // Исключение внутри кадра не должно молча остановить цикл на недостижимом
  // requestAnimationFrame: показываем причину и прекращаем цикл осознанно.
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
