/**
 * События последних секунд с затуханием — основа всего, что рисуется поверх
 * дерева: вспышки узлов, лучи и цели авторов выводятся из него покадрово.
 *
 * Ёмкость ограничена: первый коммит репозитория трогает тысячи файлов, и
 * держать их все ради полутора секунд свечения незачем. При переполнении
 * вытесняется самое старое событие — луч, который и так вот-вот погас бы.
 */
export class RecentEvents {
  private readonly path: Uint32Array;
  private readonly author: Uint32Array;
  private readonly at: Float64Array;
  private head = 0;
  private size = 0;

  constructor(
    private readonly capacity: number,
    private readonly lifetimeMs: number,
    private readonly authorCount: number,
  ) {
    this.path = new Uint32Array(capacity);
    this.author = new Uint32Array(capacity);
    this.at = new Float64Array(capacity);
  }

  push(path: number, author: number, atMs: number): void {
    if (!Number.isFinite(atMs)) return;
    if (!Number.isInteger(path) || path < 0) return;
    if (!Number.isInteger(author) || author < 0 || author >= this.authorCount) return;

    const slot = (this.head + this.size) % this.capacity;
    this.path[slot] = path;
    this.author[slot] = author;
    this.at[slot] = atMs;

    if (this.size < this.capacity) this.size++;
    else this.head = (this.head + 1) % this.capacity;
  }

  /** Сила — от 1 в момент события до 0 в конце его жизни. */
  forEach(nowMs: number, visit: (path: number, author: number, strength: number) => void): void {
    if (!Number.isFinite(nowMs)) return;
    for (let i = 0; i < this.size; i++) {
      const slot = (this.head + i) % this.capacity;
      const age = nowMs - this.at[slot];
      if (age < 0 || age >= this.lifetimeMs) continue;
      visit(this.path[slot], this.author[slot], 1 - age / this.lifetimeMs);
    }
  }

  clear(): void {
    this.head = 0;
    this.size = 0;
  }
}
