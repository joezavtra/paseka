import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer, type RunningServer } from '../../src/server/serve.js';

const running: RunningServer[] = [];
afterAll(async () => {
  await Promise.all(running.map((s) => s.close()));
});

async function makeWebRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gr-web-'));
  await writeFile(join(dir, 'index.html'), '<!doctype html><title>ok</title>');
  return dir;
}

describe('startServer', () => {
  it('отдаёт pack и статику', async () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const server = await startServer({
      webRoot: await makeWebRoot(),
      port: 0,
      getPack: async () => payload,
    });
    running.push(server);

    const packResponse = await fetch(`${server.url}/api/pack`);
    expect(packResponse.status).toBe(200);
    expect(new Uint8Array(await packResponse.arrayBuffer())).toEqual(payload);

    const indexResponse = await fetch(`${server.url}/`);
    expect(await indexResponse.text()).toContain('<title>ok</title>');
    expect(indexResponse.headers.get('content-type')).toContain('text/html');
  });

  it('не выпускает за пределы webRoot', async () => {
    const server = await startServer({
      webRoot: await makeWebRoot(),
      port: 0,
      getPack: async () => new Uint8Array(),
    });
    running.push(server);
    const response = await fetch(`${server.url}/../../etc/passwd`);
    expect(response.status).toBe(404);
  });

  it('занимает следующий свободный порт, если указанный занят', async () => {
    const webRoot = await makeWebRoot();
    const first = await startServer({ webRoot, port: 0, getPack: async () => new Uint8Array() });
    running.push(first);
    const second = await startServer({
      webRoot,
      port: first.port,
      getPack: async () => new Uint8Array(),
    });
    running.push(second);
    expect(second.port).not.toBe(first.port);
  });
});
