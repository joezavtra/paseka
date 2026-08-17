import { describePack, loadPack, showFatal } from './boot.js';

async function start(): Promise<void> {
  const status = document.getElementById('status');
  try {
    const pack = await loadPack();
    if (status) status.textContent = describePack(pack);
  } catch (error) {
    showFatal(error instanceof Error ? error.message : 'Не удалось загрузить данные.');
  }
}

void start();
