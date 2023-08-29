/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import * as fs from 'expo-file-system';
import { useCallback, useState } from 'react';
import { getWikiFilePath, WIKI_FOLDER_PATH } from '../../constants/paths';
import { IWikiWorkspace, useWikiStore } from '../../store/wiki';

type StoreHtmlStatus = 'idle' | 'fetching' | 'creating' | 'storing' | 'success' | 'error';

export function useImportHTML() {
  const [status, setStatus] = useState<StoreHtmlStatus>('idle');
  const [error, setError] = useState<string | undefined>();
  const addWiki = useWikiStore(state => state.add);
  const [importedWikiWorkspace, setImportedWikiWorkspace] = useState<undefined | IWikiWorkspace>();

  const storeHtml = useCallback(async (url: string, wikiName: string) => {
    if (WIKI_FOLDER_PATH === undefined) return;
    setStatus('fetching');

    // Fetch the HTML content
    try {
      const response = await fetch(url);
      const html = await response.text();

      setStatus('creating');

      // Save the HTML to a file
      const workspace = addWiki({ name: wikiName });
      if (workspace === undefined) throw new Error('Failed to create workspace');
      try {
        // make main folder
        await fs.makeDirectoryAsync(workspace.wikiFolderLocation);
      } catch {}
      const filePath = getWikiFilePath(workspace);
      setStatus('storing');
      await fs.writeAsStringAsync(filePath, html, {
        encoding: fs.EncodingType.UTF8,
      });
      setImportedWikiWorkspace(workspace);

      setStatus('success');
    } catch (error) {
      console.error(error, (error as Error).stack);
      setError((error as Error).message || 'An error occurred');
      setStatus('error');
    }
  }, [addWiki]);

  return { storeHtml, status, error, importedWikiWorkspace };
}
