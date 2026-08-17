import { describePack, loadPack, showFatal } from './boot.js';
import { TimeEngine, type TimeDelta } from './time/engine.js';
import { buildActiveLinks, radiusFor } from './layout/graph.js';
import type { FromWorker, LayoutInit, LayoutUpdate } from './layout/protocol.js';
import { Camera } from './render/camera.js';
import { DIR_COLOR_INDEX, drawScene, paletteIndexForPath, type SceneInput } from './render/scene.js';
import { Playback } from './time/playback.js';
import { formatCommitLabel, mountTransport } from './ui/transport.js';
import type { Pack } from '../src/model/types.js';
import { RecentEvents } from './time/recent.js';
import { ActorField, type ActorTarget } from './render/actors.js';
import { avatarColor, initialsFor } from './render/avatar.js';
import type { ActorLayer, BeamLayer } from './render/scene.js';

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

  // Цвет узла — индекс в палитре сцены; строку для кисти отрисовка достаёт
  // сама. Одно объявление цвета каталога на весь проект живёт в PALETTE.
  const color = new Uint8Array(pathCount);
  for (let path = 0; path < pathCount; path++) {
    color[path] =
      pack.pathIsDir[path] === 1 ? DIR_COLOR_INDEX : paletteIndexForPath(pack.paths[path]!);
  }

  /** Сколько миллисекунд живёт луч и вспышка. */
  const ACTIVITY_MS = 1200;
  /** Потолок числа одновременно светящихся событий: первый коммит трогает всё. */
  const ACTIVITY_CAPACITY = 512;

  const authorCount = pack.authors.length;
  const recent = new RecentEvents(ACTIVITY_CAPACITY, ACTIVITY_MS, authorCount);
  const actorField = new ActorField(authorCount);

  const actors: ActorLayer = {
    positions: actorField.positions,
    active: actorField.active,
    color: pack.authors.map((author) => avatarColor(author.email)),
    initials: pack.authors.map((author) => initialsFor(author.name, author.email)),
    name: pack.authors.map((author) => author.name),
  };

  const beams: BeamLayer = {
    count: 0,
    fromX: new Float32Array(ACTIVITY_CAPACITY),
    fromY: new Float32Array(ACTIVITY_CAPACITY),
    toPath: new Uint32Array(ACTIVITY_CAPACITY),
    author: new Uint32Array(ACTIVITY_CAPACITY),
    strength: new Float32Array(ACTIVITY_CAPACITY),
  };

  const flash = new Float32Array(pathCount);
  /** Пути, которым в прошлом кадре ставили свечение: гасим только их. */
  let litPaths: number[] = [];

  // Копилки центроидов заводятся один раз: выделять их на каждом кадре значило
  // бы мусорить шестьдесят раз в секунду ради нескольких чисел.
  const centroidX = new Float64Array(authorCount);
  const centroidY = new Float64Array(authorCount);
  const centroidHits = new Uint32Array(authorCount);

  const scene: SceneInput = {
    active: new Uint8Array(pathCount),
    positions: new Float32Array(pathCount * 2),
    radius: new Float32Array(pathCount),
    color,
    linkSource: new Uint32Array(0),
    linkTarget: new Uint32Array(0),
    flash,
    beams,
    actors,
  };

  const camera = new Camera();
  camera.attach(canvas);

  const hud = document.getElementById('hud');

  /**
   * Вписывает живые узлы, пока камерой не завладел пользователь. Полоса HUD
   * (строка состояния и панель транспорта) из высоты вычитается: она лежит
   * поверх холста, и без этого нижняя часть дерева пряталась бы под ней.
   */
  const followLayout = (): void => {
    const reserved = hud ? hud.offsetHeight + 12 : 0;
    const height = Math.max(1, canvas.clientHeight - reserved);
    camera.autoFit(scene.positions, scene.active, canvas.clientWidth, height);
  };

  const worker = new Worker(new URL('./layout/worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<FromWorker>) => {
    if (event.data.type !== 'positions') return;
    scene.positions = event.data.positions;
    // Вписываем на каждом сообщении раскладки, а не однажды по порогу
    // температуры: дерево стартует плотным комком у родителей и расходится
    // за несколько сообщений — защёлкнутый масштаб оставил бы первый кадр
    // обрезанным. Сообщения приходят, только пока симуляция идёт, поэтому
    // слежение прекращается само, когда раскладка успокоилась, а колесо или
    // перетаскивание отключают его немедленно (см. Camera.autoFit).
    followLayout();
  };
  // Ловит и ошибку загрузки модуля воркера, и необработанное исключение внутри
  // него: без этого раскладка молча не запускается, а узлы остаются в нуле.
  worker.onerror = (event: ErrorEvent) => {
    const detail = event.message || 'подробности недоступны';
    showFatal(`Раскладка не запустилась: воркер аварийно завершился. ${detail}`);
  };

  const init: LayoutInit = { type: 'init', pathCount, parent: pack.pathParent, seed: 20260817 };
  worker.postMessage(init);

  const engine = new TimeEngine(pack);

  /** Неизменная часть строки состояния: имя, коммиты, файлы. */
  const packDescription = describePack(pack);

  let liveNodes = 0;
  let shownAuthors = -1;

  function renderStatus(): void {
    if (!status) return;
    status.textContent = `${packDescription} · узлов: ${liveNodes} · авторов: ${shownAuthors < 0 ? 0 : shownAuthors}`;
  }

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

    // Пока воркер не прислал позиции нового узла, рисуем его у родителя, а не
    // в мировом нуле: иначе на каждый коммит с воспроизведением будет вспышка
    // в центре сцены на один кадр. Годится только уже стоявший родитель — если
    // он сам родился в этой же разнице, у него ещё нет настоящей позиции.
    const addedThisDelta = new Set(delta.added);
    for (const path of delta.added) {
      const parentId = pack.pathParent[path]!;
      if (parentId === path) continue; // корень
      if (scene.active[parentId] !== 1) continue;
      if (addedThisDelta.has(parentId)) continue;
      scene.positions[path * 2] = scene.positions[parentId * 2]!;
      scene.positions[path * 2 + 1] = scene.positions[parentId * 2 + 1]!;
    }

    const links = buildActiveLinks(scene.active, pack.pathParent);
    scene.linkSource = links.source;
    scene.linkTarget = links.target;

    const update: LayoutUpdate = {
      type: 'update',
      active: scene.active.slice(),
      added: delta.added,
      radiusIds: Uint32Array.from(radiusIds),
      radiusValues: Float32Array.from(radiusValues),
      linkSource: links.source,
      linkTarget: links.target,
    };
    worker.postMessage(update);

    // Лучи заводятся только на шаге воспроизведения. Перемотка приходит с
    // full = true, и вспыхивать на ней нечему: пользователь не смотрит, как
    // работали авторы, он ищет место в истории.
    if (!full && engine.cursor >= 0) {
      const author = pack.commitAuthor[engine.cursor]!;
      const now = performance.now();
      for (const path of delta.touched) recent.push(path, author, now);
    }

    if (status) {
      // Описание репозитория за сессию не меняется и посчитано один раз выше:
      // на шаге воспроизведения остаётся только пересчитать живые узлы.
      let live = 0;
      for (let path = 0; path < pathCount; path++) if (scene.active[path] === 1) live++;
      liveNodes = live;
      renderStatus();
    }
  }

  const transportRoot = document.getElementById('transport');

  const playback = new Playback(() => {
    applyDelta(engine.step());
    return engine.cursor < pack.meta.commitCount - 1;
  });

  const handles = transportRoot
    ? mountTransport(transportRoot, {
        commitCount: pack.meta.commitCount,
        commitEventStart: pack.commitEventStart,
        onSeek: (index: number) => {
          playback.pause();
          playback.reset();
          applyDelta(engine.seek(index), true);
          syncTransport();
        },
        onTogglePlay: () => {
          // С конца истории воспроизведение начинается заново с начала.
          if (!playback.playing && engine.cursor >= pack.meta.commitCount - 1) {
            applyDelta(engine.seek(-1), true);
          }
          playback.toggle();
          syncTransport();
        },
        onSpeedChange: (value: number) => {
          playback.speed = value;
        },
      })
    : null;

  function syncTransport(): void {
    handles?.setCursor(engine.cursor, formatCommitLabel(pack, engine.cursor));
    handles?.setPlaying(playback.playing);
  }

  applyDelta(engine.seek(pack.meta.commitCount - 1), true);
  syncTransport();

  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Раскладка к этому моменту может уже стоять, и новых сообщений от воркера
    // не будет — вписываем сами, иначе после изменения размера окна (в том
    // числе из нулевого, как в скрытой вкладке) дерево осталось бы за кадром.
    followLayout();
  };
  window.addEventListener('resize', resize);
  resize();

  // Исключение внутри кадра не должно молча остановить цикл на недостижимом
  // requestAnimationFrame: показываем причину и прекращаем цикл осознанно.
  let lastFrameMs = performance.now();
  const frame = (nowMs: number) => {
    const dt = (nowMs - lastFrameMs) / 1000;
    lastFrameMs = nowMs;
    try {
      if (playback.advance(dt) > 0) syncTransport();

      // Гасим только то, что светилось в прошлом кадре: полный проход по всем
      // путям на каждом кадре был бы дороже самой отрисовки лучей.
      for (const path of litPaths) flash[path] = 0;
      litPaths = [];

      beams.count = 0;
      centroidX.fill(0);
      centroidY.fill(0);
      centroidHits.fill(0);

      recent.forEach(nowMs, (path, author, strength) => {
        if (scene.active[path] !== 1) return;
        if (flash[path] < strength) {
          if (flash[path] === 0) litPaths.push(path);
          flash[path] = strength;
        }
        centroidX[author] += scene.positions[path * 2]!;
        centroidY[author] += scene.positions[path * 2 + 1]!;
        centroidHits[author]++;

        if (beams.count < beams.toPath.length) {
          const i = beams.count++;
          beams.toPath[i] = path;
          beams.author[i] = author;
          beams.strength[i] = strength;
        }
      });

      const targets: ActorTarget[] = [];
      for (let author = 0; author < authorCount; author++) {
        const count = centroidHits[author]!;
        if (count === 0) continue;
        targets.push({ author, x: centroidX[author]! / count, y: centroidY[author]! / count });
      }
      actorField.update(dt, targets);

      // Начало луча — там, где значок оказался после этого шага поля.
      for (let i = 0; i < beams.count; i++) {
        const author = beams.author[i]!;
        beams.fromX[i] = actorField.positions[author * 2]!;
        beams.fromY[i] = actorField.positions[author * 2 + 1]!;
      }

      const authorsNow = recent.activeAuthors(nowMs);
      if (authorsNow !== shownAuthors) {
        shownAuthors = authorsNow;
        renderStatus();
      }

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
