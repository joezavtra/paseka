import { describe, it, expect } from 'vitest';
import { encodePack, HEADER_OFFSET, MAGIC, PACK_VERSION, align4 } from '../../src/pack/encode.js';
import { decodePack, PackError } from '../../src/pack/decode.js';
import { buildPack } from '../../src/model/build.js';
import { makeRng } from '../../src/util/rng.js';
import type { RawCommit } from '../../src/git/types.js';
import type { Pack } from '../../src/model/types.js';

function randomCommits(seed: number, count: number): RawCommit[] {
  const rng = makeRng(seed);
  const files = ['a.txt', 'src/b.ts', 'src/deep/c.ts', 'docs/d.md', 'logo.png'];
  const commits: RawCommit[] = [];
  const alive = new Set<string>();

  for (let i = 0; i < count; i++) {
    const changes = [];
    for (const path of files) {
      if (rng() < 0.5) continue;
      const isAlive = alive.has(path);
      const kind = !isAlive ? 'add' : rng() < 0.2 ? 'delete' : 'modify';
      if (kind === 'add') alive.add(path);
      if (kind === 'delete') alive.delete(path);
      changes.push({
        path,
        kind: kind as 'add' | 'modify' | 'delete',
        added: Math.floor(rng() * 40),
        deleted: Math.floor(rng() * 20),
        binary: path.endsWith('.png'),
      });
    }
    commits.push({
      hash: `hash${i.toString(16).padStart(6, '0')}`,
      authorName: rng() < 0.5 ? 'Аня' : 'Bob',
      authorEmail: rng() < 0.5 ? 'anya@example.com' : 'bob@example.com',
      timestamp: 1_700_000_000 + i * 60,
      subject: `коммит №${i} — тест ${'x'.repeat(i % 7)}`,
      changes,
    });
  }
  return commits;
}

const TYPED_FIELDS: (keyof Pack)[] = [
  'pathParent', 'pathIsDir', 'commitTs', 'commitAuthor', 'commitEventStart',
  'eventPath', 'eventCommit', 'eventKind', 'eventAdded', 'eventDeleted', 'eventFlags',
  'pathEventStart', 'pathEventIdx', 'pathEventLines',
  'lifetimeStart', 'lifetimeBirth', 'lifetimeDeath',
];

/**
 * Кодирует pack, а затем пересобирает буфер вокруг испорченного заголовка:
 * распаковывает JSON-заголовок, даёт вызывающему его исказить и снова
 * склеивает magic + версию + новый заголовок + исходные секции данных.
 * Так тесты порчи заголовка не зависят от внутренней раскладки encodePack.
 */
function corruptHeader(pack: Pack, mutate: (header: Record<string, unknown>) => void): Uint8Array {
  const encoded = encodePack(pack);
  const view = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength);
  const headerLength = view.getUint32(8, true);
  const header = JSON.parse(
    new TextDecoder().decode(encoded.subarray(HEADER_OFFSET, HEADER_OFFSET + headerLength)),
  ) as Record<string, unknown>;
  const dataStart = align4(HEADER_OFFSET + headerLength);
  const data = encoded.subarray(dataStart);

  mutate(header);

  const newHeaderBytes = new TextEncoder().encode(JSON.stringify(header));
  const newDataStart = align4(HEADER_OFFSET + newHeaderBytes.length);
  const out = new Uint8Array(newDataStart + data.length);
  out.set(MAGIC, 0);
  const outView = new DataView(out.buffer);
  outView.setUint32(4, PACK_VERSION, true);
  outView.setUint32(8, newHeaderBytes.length, true);
  out.set(newHeaderBytes, HEADER_OFFSET);
  out.set(data, newDataStart);
  return out;
}

function expectSamePack(a: Pack, b: Pack): void {
  expect(b.meta).toEqual(a.meta);
  expect(b.paths).toEqual(a.paths);
  expect(b.authors).toEqual(a.authors);
  expect(b.commitHash).toEqual(a.commitHash);
  expect(b.commitSubject).toEqual(a.commitSubject);
  for (const field of TYPED_FIELDS) {
    const left = a[field] as ArrayLike<number>;
    const right = b[field] as ArrayLike<number>;
    expect(Array.from(right), String(field)).toEqual(Array.from(left));
  }
}

describe('кодек pack', () => {
  it('переживает round-trip на случайных историях', () => {
    for (const seed of [1, 2, 3, 42, 1337]) {
      const pack = buildPack(randomCommits(seed, 40), { repoName: 'демо', head: 'abc1234' });
      expectSamePack(pack, decodePack(encodePack(pack)));
    }
  });

  it('переживает round-trip на пустой истории', () => {
    const pack = buildPack([], { repoName: 'empty', head: '0000000' });
    expectSamePack(pack, decodePack(encodePack(pack)));
  });

  it('декодирует из невыровненного среза буфера', () => {
    const pack = buildPack(randomCommits(7, 10), { repoName: 'демо', head: 'abc1234' });
    const encoded = encodePack(pack);
    const padded = new Uint8Array(encoded.length + 3);
    padded.set(encoded, 3);
    expectSamePack(pack, decodePack(padded.subarray(3)));
  });

  it('отвергает чужие данные', () => {
    expect(() => decodePack(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])))
      .toThrow(PackError);
  });

  it('отвергает физически усечённый буфер', () => {
    const pack = buildPack(randomCommits(11, 10), { repoName: 'демо', head: 'abc1234' });
    const encoded = encodePack(pack);
    const truncated = encoded.slice(0, encoded.length - 5);
    expect(() => decodePack(truncated)).toThrow(PackError);
  });

  it('отвергает заголовок без списка секций', () => {
    const pack = buildPack(randomCommits(12, 10), { repoName: 'демо', head: 'abc1234' });
    const corrupted = corruptHeader(pack, (header) => {
      delete header.sections;
    });
    expect(() => decodePack(corrupted)).toThrow(PackError);
  });

  it('отвергает секцию, вылезающую за границы буфера', () => {
    const pack = buildPack(randomCommits(13, 10), { repoName: 'демо', head: 'abc1234' });
    const corrupted = corruptHeader(pack, (header) => {
      const sections = header.sections as { length: number }[];
      sections[0]!.length = 1_000_000;
    });
    expect(() => decodePack(corrupted)).toThrow(PackError);
  });

  it('отвергает заголовок с пропущенной обязательной секцией', () => {
    const pack = buildPack(randomCommits(14, 10), { repoName: 'демо', head: 'abc1234' });
    const corrupted = corruptHeader(pack, (header) => {
      const sections = header.sections as { name: string }[];
      header.sections = sections.filter((s) => s.name !== 'lifetimeDeath');
    });
    expect(() => decodePack(corrupted)).toThrow(PackError);
  });
});
