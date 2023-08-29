/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import * as fs from 'expo-file-system';
import { useCallback, useState } from 'react';
import { WIKI_FOLDER_PATH } from '../../constants/paths';
import { useWikiStore } from '../../store/wiki';

type StoreHtmlStatus = 'idle' | 'fetching' | 'storing' | 'success' | 'error';

export function useImportHTML() {
  const [status, setStatus] = useState<StoreHtmlStatus>('idle');
  const [error, setError] = useState<string | undefined>();
  const addWiki = useWikiStore(state => state.add);

  const storeHtml = useCallback(async (url: string, wikiName: string) => {
    if (WIKI_FOLDER_PATH === undefined) return;
    setStatus('fetching');

    // Fetch the HTML content
    try {
      const response = await fetch(url);
      const html = await response.text();

      setStatus('storing');

      // Save the HTML to a file
      const workspaceID = addWiki({ name: wikiName });
      if (workspaceID === undefined) throw new Error('Failed to create workspace');
      await fs.makeDirectoryAsync(`${WIKI_FOLDER_PATH}/${workspaceID}`);
      const filePath = `${WIKI_FOLDER_PATH}/${workspaceID}/index.html`;
      await fs.writeAsStringAsync(filePath, html, {
        encoding: fs.EncodingType.UTF8,
      });

      setStatus('success');
    } catch (error) {
      setError((error as Error).message || 'An error occurred');
      setStatus('error');
    }
  }, [addWiki]);

  return { storeHtml, status, error };
}
