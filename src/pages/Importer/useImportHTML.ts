/* eslint-disable @typescript-eslint/promise-function-async */
/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import * as fs from 'expo-file-system';
import { useCallback, useState } from 'react';
import { getWikiFilePath, getWikiTiddlerStorePath, WIKI_FOLDER_PATH } from '../../constants/paths';
import { IWikiWorkspace, useWikiStore } from '../../store/wiki';

type StoreHtmlStatus = 'idle' | 'fetching' | 'creating' | 'storing' | 'success' | 'error';

export function useImportHTML() {
  const [status, setStatus] = useState<StoreHtmlStatus>('idle');
  const [error, setError] = useState<string | undefined>();
  const addWiki = useWikiStore(state => state.add);
  const [importedWikiWorkspace, setImportedWikiWorkspace] = useState<undefined | IWikiWorkspace>();

  const storeHtml = useCallback(async (urlString: string, wikiName: string) => {
    if (WIKI_FOLDER_PATH === undefined) return;
    setStatus('fetching');
    const getSkinnyHTMLUrl = new URL(urlString);
    const getSkinnyTiddlywikiTiddlerStoreScriptUrl = new URL(urlString);
    getSkinnyTiddlywikiTiddlerStoreScriptUrl.pathname = '/tw-mobile-sync/get-skinny-tiddlywiki-tiddler-store-script';

    // Fetch the HTML content
    try {
      const html = await fetch(getSkinnyHTMLUrl).then(response => response.text());
      const tiddlerStoreScript = await fetch(getSkinnyTiddlywikiTiddlerStoreScriptUrl).then(response => response.text());

      setStatus('creating');

      // Save the HTML to a file
      const workspace = addWiki({ name: wikiName });
      if (workspace === undefined) throw new Error('Failed to create workspace');
      try {
        // make main folder
        await fs.makeDirectoryAsync(workspace.wikiFolderLocation);
      } catch {}
      setStatus('storing');
      await fs.writeAsStringAsync(getWikiFilePath(workspace), html);
      await fs.writeAsStringAsync(getWikiTiddlerStorePath(workspace), tiddlerStoreScript);
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
