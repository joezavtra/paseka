import { describe, it, expect } from 'vitest';
import { CommitParser, parseRecord } from '../../src/git/parse.js';

const REC = '\x01';
const FS = '\x1f';

/** Двухкоммитный лог в точности в том виде, в каком его печатает git. */
const LOG = [
  `${REC}aaa111${FS}Аня${FS}anya@example.com${FS}1700000000${FS}первый коммит`,
  ':000000 100644 0000000 f0f2307 A\ta.txt',
  ':000000 100644 0000000 587be6b A\tsrc/б.ts',
  '3\t0\ta.txt',
  '1\t0\tsrc/б.ts',
  '',
  `${REC}bbb222${FS}Bob${FS}bob@example.com${FS}1700000100${FS}`,
  ':100644 100644 f0f2307 0ddd0f3 M\ta.txt',
  ':000000 100644 0000000 8352675 A\tbin.dat',
  ':100644 000000 587be6b 0000000 D\tsrc/б.ts',
  '1\t0\ta.txt',
  '-\t-\tbin.dat',
  '0\t1\tsrc/б.ts',
].join('\n');

describe('parseRecord', () => {
  it('разбирает заголовок и файлы обычного коммита', () => {
    const record = LOG.slice(1, LOG.indexOf(REC, 1));
    const c = parseRecord(record);
    expect(c).not.toBeNull();
    expect(c!.hash).toBe('aaa111');
    expect(c!.authorName).toBe('Аня');
    expect(c!.authorEmail).toBe('anya@example.com');
    expect(c!.timestamp).toBe(1700000000);
    expect(c!.subject).toBe('первый коммит');
    expect(c!.changes).toEqual([
      { path: 'a.txt', kind: 'add', added: 3, deleted: 0, binary: false },
      { path: 'src/б.ts', kind: 'add', added: 1, deleted: 0, binary: false },
    ]);
  });

  it('различает удаление и вырезание строк, помечает бинарные файлы', () => {
    const c = parseRecord(LOG.slice(LOG.indexOf(REC, 1) + 1))!;
    expect(c.subject).toBe('');
    expect(c.changes).toEqual([
      { path: 'a.txt', kind: 'modify', added: 1, deleted: 0, binary: false },
      { path: 'bin.dat', kind: 'add', added: 0, deleted: 0, binary: true },
      { path: 'src/б.ts', kind: 'delete', added: 0, deleted: 1, binary: false },
    ]);
  });

  it('принимает коммит без изменений файлов', () => {
    const c = parseRecord(`ccc333${FS}Zoe${FS}z@e.com${FS}1700000200${FS}пустой`)!;
    expect(c.changes).toEqual([]);
  });

  it('отбрасывает запись с недостающими полями', () => {
    expect(parseRecord(`ccc333${FS}Zoe`)).toBeNull();
  });

  it('разбирает путь с пробелом целиком', () => {
    const record = [
      `ddd444${FS}Ева${FS}eva@example.com${FS}1700000300${FS}пробел в пути`,
      ':000000 100644 0000000 aaaaaaa A\tfile with space.txt',
      '3\t0\tfile with space.txt',
    ].join('\n');
    const c = parseRecord(record)!;
    expect(c.changes).toEqual([
      { path: 'file with space.txt', kind: 'add', added: 3, deleted: 0, binary: false },
    ]);
  });

  it('игнорирует строку без табов в теле записи, не теряя остальные файлы', () => {
    const record = [
      `eee555${FS}Ева${FS}eva@example.com${FS}1700000400${FS}мусорная строка`,
      ':000000 100644 0000000 aaaaaaa A\ta.txt',
      'мусорная строка без табов',
      '2\t0\ta.txt',
    ].join('\n');
    const c = parseRecord(record)!;
    expect(c.changes).toEqual([{ path: 'a.txt', kind: 'add', added: 2, deleted: 0, binary: false }]);
  });

  it('добавляет файл из numstat-строки без парного raw-блока с kind=modify', () => {
    const record = [
      `fff666${FS}Ева${FS}eva@example.com${FS}1700000500${FS}осиротевший numstat`,
      '5\t2\torphan.txt',
    ].join('\n');
    const c = parseRecord(record)!;
    expect(c.changes).toEqual([
      { path: 'orphan.txt', kind: 'modify', added: 5, deleted: 2, binary: false },
    ]);
  });
});

describe('CommitParser', () => {
  it('собирает коммиты при любой нарезке потока на чанки', () => {
    for (const size of [1, 7, 64, 4096]) {
      const parser = new CommitParser();
      const got = [];
      for (let i = 0; i < LOG.length; i += size) {
        got.push(...parser.push(LOG.slice(i, i + size)));
      }
      got.push(...parser.flush());
      expect(got.map((c) => c.hash), `чанк ${size}`).toEqual(['aaa111', 'bbb222']);
      expect(got[1]!.changes).toHaveLength(3);
    }
  });
});
