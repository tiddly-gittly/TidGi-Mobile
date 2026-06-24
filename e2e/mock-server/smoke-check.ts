import { ensureWikiReady, getMockServerUrl, startServer, stopServer } from './setup';

async function main() {
  try {
    ensureWikiReady();
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
        const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        const text = await response.text();
        console.log(`${path} -> ${response.status} ${text.slice(0, 200)}`);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`${path} -> ERROR: ${message}`);
      }
    }
  } finally {
    stopServer();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
