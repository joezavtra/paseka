import { ALIVE, KIND_DELETE } from '../../src/model/history.js';
import type { Pack } from '../../src/model/types.js';

/** Курсор до первого коммита: не живо ничего. */
export const BEFORE_HISTORY = -1;

export interface TimeDelta {
  /** Идентификаторы путей, ставших живыми. */
  added: Uint32Array;
  /** Идентификаторы путей, ставших мёртвыми. */
  removed: Uint32Array;
  /** Пути, затронутые событиями этого перехода: пригодятся для вспышек. */
  touched: Uint32Array;
}

const EMPTY = new Uint32Array(0);

/**
 * Держит живое множество путей и их размеры на текущем курсоре.
 *
 * Живость пути складывается из двух источников: собственные события файла и
 * наличие живых потомков. Второе считается счётчиком, а не пересчётом дерева,
 * поэтому изменение состояния одного файла стоит O(глубины пути).
 */
export class TimeEngine {
  /** Живые пути; индекс — идентификатор пути. */
  readonly alive: Uint8Array;
  /** Размер файла в строках; директории всегда 0. */
  readonly sizes: Int32Array;

  private readonly ownAlive: Uint8Array;
  private readonly liveChildren: Uint32Array;
  /** Глобальный индекс события → его позиция в CSR по путям. */
  private readonly linePos: Uint32Array;
  private cursorIndex = BEFORE_HISTORY;

  constructor(private readonly pack: Pack) {
    const { pathCount } = pack.meta;
    this.alive = new Uint8Array(pathCount);
    this.sizes = new Int32Array(pathCount);
    this.ownAlive = new Uint8Array(pathCount);
    this.liveChildren = new Uint32Array(pathCount);

    // pathEventLines индексируется позицией в CSR по путям, а события мы
    // обходим по глобальному индексу — строим обратное соответствие один раз.
    this.linePos = new Uint32Array(pack.eventPath.length);
    for (let k = 0; k < pack.pathEventIdx.length; k++) {
      this.linePos[pack.pathEventIdx[k]] = k;
    }
  }

  get cursor(): number {
    return this.cursorIndex;
  }

  /** Полный пересчёт на произвольный коммит. Используется при драге слайдера. */
  seek(target: number): TimeDelta {
    const clamped = Math.max(
      BEFORE_HISTORY,
      Math.min(target, this.pack.meta.commitCount - 1),
    );
    const before = this.alive.slice();
    this.recompute(clamped);
    this.cursorIndex = clamped;

    const added: number[] = [];
    const removed: number[] = [];
    for (let p = 0; p < this.alive.length; p++) {
      if (before[p] === this.alive[p]) continue;
      if (this.alive[p] === 1) added.push(p);
      else removed.push(p);
    }
    return { added: Uint32Array.from(added), removed: Uint32Array.from(removed), touched: EMPTY };
  }

  private recompute(target: number): void {
    const { pack } = this;
    const { pathCount } = pack.meta;
    this.ownAlive.fill(0);
    this.sizes.fill(0);
    this.liveChildren.fill(0);
    this.alive.fill(0);
    if (target < 0) return;

    for (let p = 0; p < pathCount; p++) {
      for (let k = pack.lifetimeStart[p]; k < pack.lifetimeStart[p + 1]; k++) {
        const birth = pack.lifetimeBirth[k];
        if (birth > target) break; // интервалы идут по возрастанию
        const death = pack.lifetimeDeath[k];
        if (death === ALIVE || death > target) {
          this.ownAlive[p] = 1;
          break;
        }
      }

      // Последнее событие пути, попавшее в [0, target] — двоичным поиском.
      let lo = pack.pathEventStart[p];
      let hi = pack.pathEventStart[p + 1] - 1;
      let found = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (pack.eventCommit[pack.pathEventIdx[mid]] <= target) {
          found = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      if (found !== -1) this.sizes[p] = pack.pathEventLines[found];
    }

    // Идентификатор родителя всегда меньше идентификатора потомка, поэтому
    // обход по убыванию гарантирует, что потомки посчитаны раньше родителя.
    for (let p = pathCount - 1; p >= 1; p--) {
      if (this.ownAlive[p] === 1 || this.liveChildren[p] > 0) {
        this.alive[p] = 1;
        this.liveChildren[pack.pathParent[p]]++;
      }
    }
    if (pathCount > 0) {
      this.alive[0] = this.ownAlive[0] === 1 || this.liveChildren[0] > 0 ? 1 : 0;
    }
  }

  /**
   * Переводит курсор на следующий коммит, обрабатывая только его события.
   * Это горячий путь воспроизведения: стоимость — O(событий коммита + глубины
   * затронутых путей), без обхода всего дерева.
   */
  step(): TimeDelta {
    const next = this.cursorIndex + 1;
    if (next >= this.pack.meta.commitCount) {
      return { added: EMPTY, removed: EMPTY, touched: EMPTY };
    }

    const { pack } = this;
    const added: number[] = [];
    const removed: number[] = [];
    const touched: number[] = [];

    for (let e = pack.commitEventStart[next]; e < pack.commitEventStart[next + 1]; e++) {
      const path = pack.eventPath[e];
      const kind = pack.eventKind[e];
      touched.push(path);
      this.sizes[path] = pack.pathEventLines[this.linePos[e]];

      const own = kind === KIND_DELETE ? 0 : 1;
      if (own !== this.ownAlive[path]) {
        this.ownAlive[path] = own;
        this.refresh(path, added, removed);
      }
    }

    this.cursorIndex = next;
    return {
      added: Uint32Array.from(added),
      removed: Uint32Array.from(removed),
      touched: Uint32Array.from(touched),
    };
  }

  /**
   * Пересчитывает живость пути и, если она изменилась, поднимается к корню:
   * директория жива ровно пока у неё есть живые потомки.
   */
  private refresh(path: number, added: number[], removed: number[]): void {
    const now = this.ownAlive[path] === 1 || this.liveChildren[path] > 0 ? 1 : 0;
    if (now === this.alive[path]) return;

    this.alive[path] = now;
    if (now === 1) added.push(path);
    else removed.push(path);

    if (path === 0) return; // у корня родитель — он сам
    const parent = this.pack.pathParent[path];
    if (now === 1) this.liveChildren[parent]++;
    else this.liveChildren[parent]--;
    this.refresh(parent, added, removed);
  }
}
