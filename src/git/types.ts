/** Что произошло с файлом в коммите. Берётся из raw-блока git log. */
export type ChangeKind = 'add' | 'modify' | 'delete';

export interface RawFileChange {
  path: string;
  kind: ChangeKind;
  /** Добавлено строк. Для бинарных файлов всегда 0. */
  added: number;
  /** Удалено строк. Для бинарных файлов всегда 0. */
  deleted: number;
  binary: boolean;
}

export interface RawCommit {
  hash: string;
  authorName: string;
  authorEmail: string;
  /** Unix-время автора в секундах. */
  timestamp: number;
  subject: string;
  changes: RawFileChange[];
}
