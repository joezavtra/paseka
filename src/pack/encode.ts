import type { Pack } from '../model/types.js';

export const PACK_VERSION = 1;
export const MAGIC = [0x47, 0x52, 0x50, 0x4b]; // GRPK
export const HEADER_OFFSET = 12;

/** Порядок секций фиксирован: он же определяет раскладку файла. */
export const SECTION_FIELDS = [
  'pathParent', 'pathIsDir', 'commitTs', 'commitAuthor', 'commitEventStart',
  'eventPath', 'eventCommit', 'eventKind', 'eventAdded', 'eventDeleted', 'eventFlags',
  'pathEventStart', 'pathEventIdx', 'pathEventLines',
  'lifetimeStart', 'lifetimeBirth', 'lifetimeDeath',
] as const;

export type SectionField = (typeof SECTION_FIELDS)[number];
export type SectionKind = 'u8' | 'u32' | 'i32';

export interface SectionDescriptor {
  name: SectionField;
  kind: SectionKind;
  length: number;
  offset: number;
}

export function align4(n: number): number {
  return (n + 3) & ~3;
}

function kindOf(array: Uint8Array | Uint32Array | Int32Array): SectionKind {
  if (array instanceof Uint8Array) return 'u8';
  if (array instanceof Int32Array) return 'i32';
  return 'u32';
}

/**
 * Раскладка: `GRPK` | версия u32 | длина заголовка u32 | JSON-заголовок |
 * выравнивание до 4 | секции подряд, каждая выровнена на 4 байта.
 * Строки (пути, хэши, subject) живут в JSON-заголовке, числа — в секциях,
 * поэтому декодирование не копирует горячие данные.
 */
export function encodePack(pack: Pack): Uint8Array {
  const sections: SectionDescriptor[] = [];
  let dataLength = 0;
  for (const name of SECTION_FIELDS) {
    const array = pack[name];
    sections.push({ name, kind: kindOf(array), length: array.length, offset: dataLength });
    dataLength += align4(array.byteLength);
  }

  const headerBytes = new TextEncoder().encode(
    JSON.stringify({
      meta: pack.meta,
      paths: pack.paths,
      authors: pack.authors,
      commitHash: pack.commitHash,
      commitSubject: pack.commitSubject,
      sections,
    }),
  );

  const dataStart = align4(HEADER_OFFSET + headerBytes.length);
  const out = new Uint8Array(dataStart + dataLength);
  out.set(MAGIC, 0);
  const view = new DataView(out.buffer);
  view.setUint32(4, PACK_VERSION, true);
  view.setUint32(8, headerBytes.length, true);
  out.set(headerBytes, HEADER_OFFSET);

  for (const section of sections) {
    const array = pack[section.name];
    out.set(
      new Uint8Array(array.buffer, array.byteOffset, array.byteLength),
      dataStart + section.offset,
    );
  }
  return out;
}
