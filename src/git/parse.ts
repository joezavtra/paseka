import type { ChangeKind, RawCommit, RawFileChange } from './types.js';

export const RECORD_SEP = '\x01';
export const FIELD_SEP = '\x1f';

/**
 * `--raw` и `--numstat` нужны оба: numstat даёт числа строк, но не статус —
 * строка `0\t42\tpath` одинаково означает «файл удалён» и «из файла вырезали
 * 42 строки». Комбинация `--numstat --name-status` не работает: эти опции
 * перекрывают друг друга, и git печатает только один блок.
 */
export const GIT_LOG_ARGS: string[] = [
  '-c',
  'core.quotepath=false',
  'log',
  '--reverse',
  '--no-merges',
  '--no-renames',
  '--raw',
  '--numstat',
  `--pretty=format:${RECORD_SEP}%H${FIELD_SEP}%an${FIELD_SEP}%ae${FIELD_SEP}%at${FIELD_SEP}%s`,
];

function statusToKind(letter: string): ChangeKind {
  if (letter === 'A') return 'add';
  if (letter === 'D') return 'delete';
  return 'modify';
}

/** Разбирает одну запись — всё, что лежит между двумя разделителями `\x01`. */
export function parseRecord(record: string): RawCommit | null {
  const nl = record.indexOf('\n');
  const header = nl === -1 ? record : record.slice(0, nl);

  const at: number[] = [];
  let cursor = -1;
  for (let i = 0; i < 4; i++) {
    cursor = header.indexOf(FIELD_SEP, cursor + 1);
    if (cursor === -1) return null;
    at.push(cursor);
  }

  const hash = header.slice(0, at[0]);
  const timestamp = Number(header.slice(at[2] + 1, at[3]));
  if (hash.length === 0 || !Number.isFinite(timestamp)) return null;

  const changes: RawFileChange[] = [];
  const byPath = new Map<string, RawFileChange>();

  if (nl !== -1) {
    for (const line of record.slice(nl + 1).split('\n')) {
      if (line.length === 0) continue;
      const tab = line.indexOf('\t');
      if (tab === -1) continue;

      if (line.charCodeAt(0) === 58 /* ':' */) {
        // raw: `:<srcmode> <dstmode> <srcsha> <dstsha> <status>\t<path>`
        const meta = line.slice(0, tab);
        const status = meta.slice(meta.lastIndexOf(' ') + 1);
        const path = line.slice(tab + 1);
        const change: RawFileChange = {
          path,
          kind: statusToKind(status.charAt(0)),
          added: 0,
          deleted: 0,
          binary: false,
        };
        changes.push(change);
        byPath.set(path, change);
        continue;
      }

      // numstat: `<added>\t<deleted>\t<path>`, у бинарных файлов оба поля — `-`
      const tab2 = line.indexOf('\t', tab + 1);
      if (tab2 === -1) continue;
      const addedText = line.slice(0, tab);
      const deletedText = line.slice(tab + 1, tab2);
      const path = line.slice(tab2 + 1);
      const binary = addedText === '-';
      const existing = byPath.get(path);
      const target =
        existing ??
        (() => {
          // numstat без парного raw-блока не встречался, но терять файл нельзя
          const c: RawFileChange = { path, kind: 'modify', added: 0, deleted: 0, binary: false };
          changes.push(c);
          byPath.set(path, c);
          return c;
        })();
      target.binary = binary;
      target.added = binary ? 0 : Number(addedText) || 0;
      target.deleted = binary ? 0 : Number(deletedText) || 0;
    }
  }

  return {
    hash,
    authorName: header.slice(at[0] + 1, at[1]),
    authorEmail: header.slice(at[1] + 1, at[2]),
    timestamp,
    subject: header.slice(at[3] + 1),
    changes,
  };
}

/**
 * Стриминговый разбор: держит в памяти только хвост незавершённой записи.
 * Вызывающий обязан завершить работу вызовом `flush()`.
 */
export class CommitParser {
  private buffer = '';

  push(chunk: string): RawCommit[] {
    this.buffer += chunk;
    const out: RawCommit[] = [];
    let start = this.buffer.indexOf(RECORD_SEP);
    if (start === -1) return out;
    for (;;) {
      const next = this.buffer.indexOf(RECORD_SEP, start + 1);
      if (next === -1) break;
      const commit = parseRecord(this.buffer.slice(start + 1, next));
      if (commit) out.push(commit);
      start = next;
    }
    this.buffer = this.buffer.slice(start);
    return out;
  }

  flush(): RawCommit[] {
    const out: RawCommit[] = [];
    if (this.buffer.startsWith(RECORD_SEP)) {
      const commit = parseRecord(this.buffer.slice(1));
      if (commit) out.push(commit);
    }
    this.buffer = '';
    return out;
  }
}
