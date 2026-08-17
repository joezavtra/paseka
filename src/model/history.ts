export const KIND_ADD = 0;
export const KIND_MODIFY = 1;
export const KIND_DELETE = 2;

/** Маркер незакрытого интервала жизни: путь дожил до конца истории. */
export const ALIVE = 0xffffffff;

export interface PathHistoryInput {
  pathCount: number;
  eventPath: Uint32Array;
  eventCommit: Uint32Array;
  eventKind: Uint8Array;
  eventAdded: Uint32Array;
  eventDeleted: Uint32Array;
}

export interface PathHistory {
  /** CSR-смещения: события пути p лежат в [start[p], start[p+1]). */
  pathEventStart: Uint32Array;
  /** Индексы в глобальных массивах событий, по возрастанию коммита. */
  pathEventIdx: Uint32Array;
  /** Размер файла в строках сразу после соответствующего события. */
  pathEventLines: Int32Array;
  /** CSR-смещения интервалов жизни. */
  lifetimeStart: Uint32Array;
  lifetimeBirth: Uint32Array;
  /** Индекс коммита, в котором путь умер, либо ALIVE. */
  lifetimeDeath: Uint32Array;
}

/**
 * Раскладывает плоский список событий по путям и выводит из него две вещи,
 * на которых стоит вся визуализация: когда путь существовал и какого он был
 * размера в каждый момент.
 */
export function buildPathHistory(input: PathHistoryInput): PathHistory {
  const { pathCount, eventPath, eventCommit, eventKind, eventAdded, eventDeleted } = input;
  const eventCount = eventPath.length;

  // Сортировка подсчётом: события уже идут в порядке коммитов, поэтому
  // раскладка по путям сохраняет хронологию внутри каждого пути.
  const pathEventStart = new Uint32Array(pathCount + 1);
  for (let i = 0; i < eventCount; i++) pathEventStart[eventPath[i] + 1]++;
  for (let p = 0; p < pathCount; p++) pathEventStart[p + 1] += pathEventStart[p];

  const cursor = pathEventStart.slice(0, pathCount);
  const pathEventIdx = new Uint32Array(eventCount);
  for (let i = 0; i < eventCount; i++) {
    pathEventIdx[cursor[eventPath[i]]++] = i;
  }

  const pathEventLines = new Int32Array(eventCount);
  const lifetimeStart = new Uint32Array(pathCount + 1);
  const births: number[] = [];
  const deaths: number[] = [];

  for (let p = 0; p < pathCount; p++) {
    lifetimeStart[p] = births.length;
    let lines = 0;
    let openInterval = -1;

    for (let k = pathEventStart[p]; k < pathEventStart[p + 1]; k++) {
      const e = pathEventIdx[k];
      const kind = eventKind[e];
      const commit = eventCommit[e];

      if (kind === KIND_DELETE) {
        if (openInterval !== -1) {
          deaths[openInterval] = commit;
          openInterval = -1;
        }
        lines = 0;
      } else {
        if (openInterval === -1) {
          // Рождением считаем и modify: при обрезанной истории (shallow clone)
          // первое известное событие файла вполне может быть изменением.
          openInterval = births.length;
          births.push(commit);
          deaths.push(ALIVE);
          lines = 0;
        }
        lines = kind === KIND_ADD ? eventAdded[e] : lines + eventAdded[e] - eventDeleted[e];
        if (lines < 0) lines = 0;
      }
      pathEventLines[k] = lines;
    }
  }
  lifetimeStart[pathCount] = births.length;

  return {
    pathEventStart,
    pathEventIdx,
    pathEventLines,
    lifetimeStart,
    lifetimeBirth: Uint32Array.from(births),
    lifetimeDeath: Uint32Array.from(deaths),
  };
}
