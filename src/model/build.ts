import type { RawCommit } from '../git/types.js';
import { KIND_ADD, KIND_DELETE, KIND_MODIFY, buildPathHistory } from './history.js';
import { PathTable } from './path-table.js';
import { FLAG_BINARY, type Author, type Pack } from './types.js';

export interface BuildOptions {
  repoName: string;
  head: string;
}

const KIND_BY_NAME = { add: KIND_ADD, modify: KIND_MODIFY, delete: KIND_DELETE } as const;

export function buildPack(commits: RawCommit[], opts: BuildOptions): Pack {
  const table = new PathTable();

  const authors: Author[] = [];
  const authorIndex = new Map<string, number>();

  const commitTs: number[] = [];
  const commitAuthor: number[] = [];
  const commitHash: string[] = [];
  const commitSubject: string[] = [];
  const commitEventStart: number[] = [0];

  const eventPath: number[] = [];
  const eventCommit: number[] = [];
  const eventKind: number[] = [];
  const eventAdded: number[] = [];
  const eventDeleted: number[] = [];
  const eventFlags: number[] = [];

  for (let c = 0; c < commits.length; c++) {
    const commit = commits[c]!;

    // Email — ключ дедупликации авторов: почтовые клиенты и хостинги
    // нормализуют регистр по-разному, но это один и тот же человек. В пул
    // при этом кладём написание из первого попавшегося коммита как есть.
    const authorKey = commit.authorEmail.trim().toLowerCase();
    let authorId = authorIndex.get(authorKey);
    if (authorId === undefined) {
      authorId = authors.length;
      authors.push({ name: commit.authorName, email: commit.authorEmail });
      authorIndex.set(authorKey, authorId);
    }

    commitTs.push(commit.timestamp);
    commitAuthor.push(authorId);
    commitHash.push(commit.hash.slice(0, 10));
    commitSubject.push(commit.subject.slice(0, 200));

    for (const change of commit.changes) {
      eventPath.push(table.intern(change.path));
      eventCommit.push(c);
      eventKind.push(KIND_BY_NAME[change.kind]);
      eventAdded.push(change.added);
      eventDeleted.push(change.deleted);
      eventFlags.push(change.binary ? FLAG_BINARY : 0);
    }
    commitEventStart.push(eventPath.length);
  }

  // Границы периода считаем по всему массиву: в `git log` берётся дата автора,
  // а порядок коммитов — по дате коммита, и после rebase, cherry-pick или
  // `git am` края массива вовсе не обязаны быть минимумом и максимумом.
  let firstTs = 0;
  let lastTs = 0;
  if (commitTs.length > 0) {
    firstTs = commitTs[0]!;
    lastTs = commitTs[0]!;
    for (const ts of commitTs) {
      if (ts < firstTs) firstTs = ts;
      if (ts > lastTs) lastTs = ts;
    }
  }

  const pathCount = table.size();
  const history = buildPathHistory({
    pathCount,
    eventPath: Uint32Array.from(eventPath),
    eventCommit: Uint32Array.from(eventCommit),
    eventKind: Uint8Array.from(eventKind),
    eventAdded: Uint32Array.from(eventAdded),
    eventDeleted: Uint32Array.from(eventDeleted),
  });

  return {
    meta: {
      repoName: opts.repoName,
      head: opts.head,
      commitCount: commits.length,
      pathCount,
      firstTs,
      lastTs,
    },
    paths: table.paths.slice(),
    pathParent: Uint32Array.from(table.parent),
    pathIsDir: Uint8Array.from(table.isDir),
    authors,
    commitTs: Uint32Array.from(commitTs),
    commitAuthor: Uint32Array.from(commitAuthor),
    commitHash,
    commitSubject,
    commitEventStart: Uint32Array.from(commitEventStart),
    eventPath: Uint32Array.from(eventPath),
    eventCommit: Uint32Array.from(eventCommit),
    eventKind: Uint8Array.from(eventKind),
    eventAdded: Uint32Array.from(eventAdded),
    eventDeleted: Uint32Array.from(eventDeleted),
    eventFlags: Uint8Array.from(eventFlags),
    ...history,
  };
}
