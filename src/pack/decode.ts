import type { Author, Pack, PackMeta } from '../model/types.js';
import {
  HEADER_OFFSET,
  MAGIC,
  PACK_VERSION,
  SECTION_FIELDS,
  align4,
  type SectionDescriptor,
} from './encode.js';

export class PackError extends Error {}

interface PackHeader {
  meta: PackMeta;
  paths: string[];
  authors: Author[];
  commitHash: string[];
  commitSubject: string[];
  sections: SectionDescriptor[];
}

export function decodePack(input: Uint8Array): Pack {
  // Секции выровнены на 4 байта относительно начала pack, поэтому невыровненный
  // срез (например, кусок сетевого буфера) ломает создание typed array.
  const bytes = input.byteOffset % 4 === 0 ? input : new Uint8Array(input);

  if (bytes.length < HEADER_OFFSET || MAGIC.some((b, i) => bytes[i] !== b)) {
    throw new PackError('Это не файл данных paseka.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(4, true);
  if (version !== PACK_VERSION) {
    throw new PackError(`Неподдерживаемая версия данных: ${version}. Пересоберите визуализацию.`);
  }

  const headerLength = view.getUint32(8, true);
  let header: PackHeader;
  try {
    header = JSON.parse(
      new TextDecoder().decode(bytes.subarray(HEADER_OFFSET, HEADER_OFFSET + headerLength)),
    ) as PackHeader;
  } catch {
    throw new PackError('Заголовок данных повреждён.');
  }

  // Порченый заголовок от другой сборки может вообще не содержать sections —
  // без этой проверки итерация ниже падает сырым TypeError.
  if (!Array.isArray(header.sections)) {
    throw new PackError('Заголовок данных повреждён: отсутствует список секций. Пересоберите визуализацию.');
  }

  const dataStart = align4(HEADER_OFFSET + headerLength);
  // Граница данных отсчитывается от dataStart на уже (при необходимости)
  // скопированном буфере bytes, а не от исходного input.
  const dataLength = bytes.length - dataStart;

  const read = (section: SectionDescriptor) => {
    const bytesPerElement = section.kind === 'u8' ? 1 : 4;
    const byteLength = section.length * bytesPerElement;
    // Без этой проверки испорченная или завышенная длина секции ломает
    // конструктор typed array сырым RangeError вместо понятного PackError.
    if (
      typeof section.offset !== 'number' ||
      typeof section.length !== 'number' ||
      section.offset < 0 ||
      byteLength < 0 ||
      section.offset + byteLength > dataLength
    ) {
      throw new PackError(
        `Заголовок данных повреждён: секция «${section.name}» выходит за границы файла. Пересоберите визуализацию.`,
      );
    }
    const at = bytes.byteOffset + dataStart + section.offset;
    if (section.kind === 'u8') return new Uint8Array(bytes.buffer, at, section.length);
    if (section.kind === 'i32') return new Int32Array(bytes.buffer, at, section.length);
    return new Uint32Array(bytes.buffer, at, section.length);
  };

  const arrays = {} as Record<SectionDescriptor['name'], ReturnType<typeof read>>;
  for (const section of header.sections) {
    arrays[section.name] = read(section);
  }

  // Заголовок мог описывать не все обязательные секции (например, файл от
  // более старой сборки) — без этой проверки Pack тихо уедет с undefined
  // в одном из typed-array полей, и падение обнаружится позже и не там.
  const missing = SECTION_FIELDS.filter((name) => !(name in arrays));
  if (missing.length > 0) {
    throw new PackError(
      `Заголовок данных повреждён: отсутствуют обязательные секции (${missing.join(', ')}). Пересоберите визуализацию.`,
    );
  }

  return {
    meta: header.meta,
    paths: header.paths,
    authors: header.authors,
    commitHash: header.commitHash,
    commitSubject: header.commitSubject,
    pathParent: arrays.pathParent as Uint32Array,
    pathIsDir: arrays.pathIsDir as Uint8Array,
    commitTs: arrays.commitTs as Uint32Array,
    commitAuthor: arrays.commitAuthor as Uint32Array,
    commitEventStart: arrays.commitEventStart as Uint32Array,
    eventPath: arrays.eventPath as Uint32Array,
    eventCommit: arrays.eventCommit as Uint32Array,
    eventKind: arrays.eventKind as Uint8Array,
    eventAdded: arrays.eventAdded as Uint32Array,
    eventDeleted: arrays.eventDeleted as Uint32Array,
    eventFlags: arrays.eventFlags as Uint8Array,
    pathEventStart: arrays.pathEventStart as Uint32Array,
    pathEventIdx: arrays.pathEventIdx as Uint32Array,
    pathEventLines: arrays.pathEventLines as Int32Array,
    lifetimeStart: arrays.lifetimeStart as Uint32Array,
    lifetimeBirth: arrays.lifetimeBirth as Uint32Array,
    lifetimeDeath: arrays.lifetimeDeath as Uint32Array,
  };
}
