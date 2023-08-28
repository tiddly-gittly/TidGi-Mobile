/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import * as fs from 'expo-file-system';
import { useCallback, useState } from 'react';

type StoreHtmlStatus = 'idle' | 'fetching' | 'storing' | 'success' | 'error';

export function useImportHTML() {
  const [status, setStatus] = useState<StoreHtmlStatus>('idle');
  const [error, setError] = useState<string | undefined>();

  const storeHtml = useCallback(async (url: string, wikiName: string) => {
    if (fs.documentDirectory === null) return;
    const filePath = `${fs.documentDirectory}${wikiName}/index.html`;
    setStatus('fetching');

    // Fetch the HTML content
    try {
      const response = await fetch(url);
      const html = await response.text();

      setStatus('storing');

      // Save the HTML to a file
      await fs.writeAsStringAsync(filePath, html, {
        encoding: fs.EncodingType.UTF8,
      });

      setStatus('success');
    } catch (error) {
      setError((error as Error).message || 'An error occurred');
      setStatus('error');
    }
  }, []);

  return { storeHtml, status, error };
}
