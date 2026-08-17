/** Бинарный файл: в numstat вместо чисел стоят прочерки. */
export const FLAG_BINARY = 1;

/**
 * Событие дописано сверкой с деревом HEAD, а не прочитано из `git log`:
 * так закрываются пути, потерявшие удаление вместе с пропущенным коммитом
 * слияния (см. buildPack). Автор последнего коммита этих файлов не касался,
 * поэтому потребители «затронутых путей» (лучи и вспышки среза 4) обязаны
 * такие события отличать.
 */
export const FLAG_SYNTHETIC = 2;

export interface PackMeta {
  repoName: string;
  head: string;
  commitCount: number;
  pathCount: number;
  /** Unix-секунды первого и последнего коммита. */
  firstTs: number;
  lastTs: number;
}

export interface Author {
  name: string;
  email: string;
}

/**
 * Всё, что браузеру нужно знать о репозитории. Строки живут в пулах,
 * числа — в typed arrays, связи «один-ко-многим» — в CSR (offsets + плоский
 * массив). Никаких объектов на элемент: на 50k коммитов их было бы полмиллиона.
 */
export interface Pack {
  meta: PackMeta;

  /** Пул путей; индекс 0 — корень репозитория. */
  paths: string[];
  pathParent: Uint32Array;
  pathIsDir: Uint8Array;

  authors: Author[];

  commitTs: Uint32Array;
  commitAuthor: Uint32Array;
  commitHash: string[];
  commitSubject: string[];
  /** CSR: события коммита c лежат в [commitEventStart[c], commitEventStart[c+1]). */
  commitEventStart: Uint32Array;

  eventPath: Uint32Array;
  eventCommit: Uint32Array;
  eventKind: Uint8Array;
  eventAdded: Uint32Array;
  eventDeleted: Uint32Array;
  eventFlags: Uint8Array;

  /** CSR по путям, см. buildPathHistory. */
  pathEventStart: Uint32Array;
  pathEventIdx: Uint32Array;
  pathEventLines: Int32Array;
  lifetimeStart: Uint32Array;
  lifetimeBirth: Uint32Array;
  lifetimeDeath: Uint32Array;
}
