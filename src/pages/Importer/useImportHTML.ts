/* eslint-disable @typescript-eslint/promise-function-async */
/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import * as fs from 'expo-file-system';
import { useCallback, useState } from 'react';
import { getWikiFilePath, getWikiTiddlerStorePath, WIKI_FOLDER_PATH } from '../../constants/paths';
import { IWikiWorkspace, useWikiStore } from '../../store/wiki';

type StoreHtmlStatus = 'idle' | 'fetching' | 'creating' | 'downloading' | 'success' | 'error';

export function useImportHTML() {
  const [status, setStatus] = useState<StoreHtmlStatus>('idle');
  const [error, setError] = useState<string | undefined>();
  const [skinnyHtmlDownloadPercentage, setSkinnyHtmlDownloadPercentage] = useState(0);
  const [skinnyTiddlerStoreScriptDownloadPercentage, setSkinnyTiddlerStoreScriptDownloadPercentage] = useState(0);
  const [nonSkinnyTiddlerStoreScriptDownloadPercentage, setNonSkinnyTiddlerStoreScriptDownloadPercentage] = useState(0);
  const addWiki = useWikiStore(state => state.add);
  const removeWiki = useWikiStore(state => state.remove);
  const [createdWikiWorkspace, setCreatedWikiWorkspace] = useState<undefined | IWikiWorkspace>();

  const storeHtml = useCallback(async (urlString: string, wikiName: string, selectiveSyncFilter: string) => {
    if (WIKI_FOLDER_PATH === undefined) return;
    setStatus('fetching');
    const getSkinnyHTMLUrl = new URL(urlString);
    /**
     * Get tiddlers without text field
     */
    const getSkinnyTiddlywikiTiddlerStoreScriptUrl = new URL(urlString);
    getSkinnyTiddlywikiTiddlerStoreScriptUrl.pathname = '/tw-mobile-sync/get-skinny-tiddlywiki-tiddler-store-script';
    /**
     * Some tiddlers must have text field on start, this gets them
     */
    const getNonSkinnyTiddlywikiTiddlerStoreScriptUrl = new URL(urlString);
    getNonSkinnyTiddlywikiTiddlerStoreScriptUrl.pathname = '/tw-mobile-sync/get-non-skinny-tiddlywiki-tiddler-store-script';

    // Fetch the HTML content
    let newWorkspaceID: string | undefined;
    try {
      setStatus('creating');

      // Save the HTML to a file
      const newWorkspace = addWiki({ name: wikiName, selectiveSyncFilter });
      if (newWorkspace === undefined) throw new Error('Failed to create workspace');
      newWorkspaceID = newWorkspace.id;
      try {
        // make main folder
        await fs.makeDirectoryAsync(newWorkspace.wikiFolderLocation);
      } catch {}
      setCreatedWikiWorkspace(newWorkspace);

      setStatus('downloading');
      const htmlDownloadResumable = fs.createDownloadResumable(getSkinnyHTMLUrl.toString(), getWikiFilePath(newWorkspace), {}, (progress) => {
        setSkinnyHtmlDownloadPercentage(progress.totalBytesWritten / progress.totalBytesExpectedToWrite);
      });
      const skinnyTiddlerStoreDownloadResumable = fs.createDownloadResumable(
        getSkinnyTiddlywikiTiddlerStoreScriptUrl.toString(),
        getWikiTiddlerStorePath(newWorkspace, true),
        {},
        (progress) => {
          setSkinnyTiddlerStoreScriptDownloadPercentage(progress.totalBytesWritten / progress.totalBytesExpectedToWrite);
        },
      );
      const nonSkinnyTiddlerStoreDownloadResumable = fs.createDownloadResumable(
        getNonSkinnyTiddlywikiTiddlerStoreScriptUrl.toString(),
        getWikiTiddlerStorePath(newWorkspace, false),
        {},
        (progress) => {
          setNonSkinnyTiddlerStoreScriptDownloadPercentage(progress.totalBytesWritten / progress.totalBytesExpectedToWrite);
        },
      );
      await Promise.all([
        htmlDownloadResumable.downloadAsync(),
        skinnyTiddlerStoreDownloadResumable.downloadAsync(),
        nonSkinnyTiddlerStoreDownloadResumable.downloadAsync(),
      ]);
      setStatus('success');
    } catch (error) {
      console.error(error, (error as Error).stack);
      setError((error as Error).message || 'An error occurred');
      setStatus('error');
      if (newWorkspaceID !== undefined) {
        removeWiki(newWorkspaceID);
      }
    }
  }, [addWiki, removeWiki]);

  return {
    storeHtml,
    status,
    error,
    createdWikiWorkspace,
    downloadPercentage: {
      skinnyHtmlDownloadPercentage,
      skinnyTiddlerStoreScriptDownloadPercentage,
      nonSkinnyTiddlerStoreScriptDownloadPercentage,
    },
  };
}
