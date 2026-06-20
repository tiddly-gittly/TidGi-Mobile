import { ensureWikiReady, getMockServerUrl, startServer, stopServer } from './setup';

async function main() {
  try {
    await ensureWikiReady();
    await startServer();
    const base = getMockServerUrl();

    const endpoints = [
      '/status',
      '/tw-mobile-sync/git/mobile-sync-info',
      '/tw-mobile-sync/git/standalone/pack-size',
    ];

    for (const path of endpoints) {
      const url = `${base}${path}`;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        const text = await res.text();
        console.log(`${path} -> ${res.status} ${text.slice(0, 200)}`);
      } catch (e: any) {
        console.error(`${path} -> ERROR: ${e.message}`);
      }
    }
  } finally {
    stopServer();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
