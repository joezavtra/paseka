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
  /** Метка поколения на автора: заменяет Set при подсчёте активных. */
  private readonly seen: Uint32Array;
  private generation = 0;
  private head = 0;
  private size = 0;

  constructor(
    private readonly capacity: number,
    private readonly lifetimeMs: number,
    authorCount: number,
  ) {
    this.path = new Uint32Array(capacity);
    this.author = new Uint32Array(capacity);
    this.at = new Float64Array(capacity);
    this.seen = new Uint32Array(authorCount);
  }

  push(path: number, author: number, atMs: number): void {
    if (!Number.isFinite(atMs)) return;
    if (author < 0 || author >= this.seen.length) return;

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

  /** Сколько авторов имеет хотя бы одно живое событие. */
  activeAuthors(nowMs: number): number {
    if (!Number.isFinite(nowMs)) return 0;
    this.generation++;
    let count = 0;
    for (let i = 0; i < this.size; i++) {
      const slot = (this.head + i) % this.capacity;
      const age = nowMs - this.at[slot];
      if (age < 0 || age >= this.lifetimeMs) continue;
      const author = this.author[slot];
      if (this.seen[author] === this.generation) continue;
      this.seen[author] = this.generation;
      count++;
    }
    return count;
  }

  clear(): void {
    this.head = 0;
    this.size = 0;
  }
}
