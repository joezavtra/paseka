export interface ActorTarget {
  author: number;
  x: number;
  y: number;
}

/** Жёсткость пружины к цели, в единицах «за секунду в квадрате». */
const STIFFNESS = 6;
/** Затухание скорости за секунду: без него автор бесконечно колеблется у цели. */
const DAMPING = 5;
/** Насколько сильно авторы расталкиваются и до какого расстояния это считается. */
const REPULSION = 12000;
const REPULSION_RANGE = 112;
/** Потолок дельты времени: свёрнутая вкладка не должна швырнуть авторов за экран. */
const MAX_STEP_SECONDS = 1 / 15;

/**
 * Авторы живут отдельно от force-раскладки узлов: их единицы, а не тысячи, и
 * гонять ради них воркер незачем. Каждый тянется к центроиду файлов, которых
 * коснулся, и слегка отталкивается от соседей, чтобы значки не слипались.
 */
export class ActorField {
  /** Пары x, y по идентификатору автора. */
  readonly positions: Float32Array;
  /** 1, если у автора есть цель в этом кадре. */
  readonly active: Uint8Array;

  private readonly velocity: Float32Array;
  /** Был ли автор хоть раз размещён: первое появление ставится сразу в цель. */
  private readonly placed: Uint8Array;

  constructor(authorCount: number) {
    this.positions = new Float32Array(authorCount * 2);
    this.active = new Uint8Array(authorCount);
    this.velocity = new Float32Array(authorCount * 2);
    this.placed = new Uint8Array(authorCount);
  }

  update(dtSeconds: number, targets: readonly ActorTarget[]): void {
    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return;
    const dt = Math.min(dtSeconds, MAX_STEP_SECONDS);

    this.active.fill(0);

    for (const target of targets) {
      const author = target.author;
      if (author < 0 || author >= this.active.length) continue;
      if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) continue;
      this.active[author] = 1;

      if (this.placed[author] === 0) {
        // Первое появление: ставим в цель, а не запускаем издалека — иначе
        // значок влетал бы в кадр из угла на каждом новом авторе.
        this.placed[author] = 1;
        this.positions[author * 2] = target.x;
        this.positions[author * 2 + 1] = target.y;
        this.velocity[author * 2] = 0;
        this.velocity[author * 2 + 1] = 0;
        continue;
      }

      const dx = target.x - this.positions[author * 2];
      const dy = target.y - this.positions[author * 2 + 1];
      this.velocity[author * 2] += dx * STIFFNESS * dt;
      this.velocity[author * 2 + 1] += dy * STIFFNESS * dt;
    }

    // Отталкивание между активными: их единицы, поэтому попарный обход дешевле
    // любого индекса.
    for (let a = 0; a < this.active.length; a++) {
      if (this.active[a] === 0) continue;
      for (let b = a + 1; b < this.active.length; b++) {
        if (this.active[b] === 0) continue;
        let dx = this.positions[a * 2] - this.positions[b * 2];
        let dy = this.positions[a * 2 + 1] - this.positions[b * 2 + 1];
        let distance = Math.hypot(dx, dy);
        if (distance < 1e-3) {
          // Строго совпавшие авторы: разводим по устойчивому направлению,
          // выведенному из их номеров, — случайность в проекте запрещена.
          dx = Math.cos(a * 2.399963 + b);
          dy = Math.sin(a * 2.399963 + b);
          distance = 1;
        }
        if (distance > REPULSION_RANGE) continue;
        const push = (REPULSION / (distance * distance + 1)) * dt;
        this.velocity[a * 2] += (dx / distance) * push;
        this.velocity[a * 2 + 1] += (dy / distance) * push;
        this.velocity[b * 2] -= (dx / distance) * push;
        this.velocity[b * 2 + 1] -= (dy / distance) * push;
      }
    }

    const damping = Math.max(0, 1 - DAMPING * dt);
    for (let author = 0; author < this.active.length; author++) {
      if (this.active[author] === 0) continue;
      this.velocity[author * 2] *= damping;
      this.velocity[author * 2 + 1] *= damping;
      this.positions[author * 2] += this.velocity[author * 2] * dt;
      this.positions[author * 2 + 1] += this.velocity[author * 2 + 1] * dt;
    }
  }
}
