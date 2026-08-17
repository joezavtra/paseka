/**
 * Интернирует пути файлов и попутно строит дерево директорий.
 * Директории получают собственные идентификаторы: рендер рисует их как узлы,
 * а движок времени считает их живыми, пока жив хотя бы один потомок.
 */
export class PathTable {
  /** Полные пути; индекс в этом массиве и есть идентификатор пути. */
  readonly paths: string[] = [''];
  /** Идентификатор родителя; у корня родитель — он сам. */
  readonly parent: number[] = [0];
  /** 1 для директорий, 0 для файлов. */
  readonly isDir: number[] = [1];

  private readonly index = new Map<string, number>([['', 0]]);

  size(): number {
    return this.paths.length;
  }

  /** Возвращает идентификатор файла, создавая недостающие директории по пути. */
  intern(path: string): number {
    const normalized = normalize(path);
    const known = this.index.get(normalized);
    if (known !== undefined) return known;

    const cut = normalized.lastIndexOf('/');
    const parentId = cut === -1 ? 0 : this.internDir(normalized.slice(0, cut));
    return this.add(normalized, parentId, 0);
  }

  private internDir(path: string): number {
    const known = this.index.get(path);
    if (known !== undefined) return known;
    const cut = path.lastIndexOf('/');
    const parentId = cut === -1 ? 0 : this.internDir(path.slice(0, cut));
    return this.add(path, parentId, 1);
  }

  private add(path: string, parentId: number, dir: number): number {
    const id = this.paths.length;
    this.paths.push(path);
    this.parent.push(parentId);
    this.isDir.push(dir);
    this.index.set(path, id);
    return id;
  }
}

function normalize(path: string): string {
  let out = path;
  while (out.startsWith('./')) out = out.slice(2);
  out = out.replace(/\/{2,}/g, '/');
  if (out.endsWith('/')) out = out.slice(0, -1);
  return out;
}
