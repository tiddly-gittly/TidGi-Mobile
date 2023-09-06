/* eslint-disable @typescript-eslint/promise-function-async */
/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import * as fs from 'expo-file-system';
import { useCallback, useState } from 'react';
import {
  getWikiCacheFolderPath,
  getWikiFilePath,
  getWikiTiddlerFolderPath,
  getWikiTiddlerSkinnyStoreCachePath,
  getWikiTiddlerStorePath,
  getWikiTiddlerTextStoreCachePath,
  WIKI_FOLDER_PATH,
} from '../../constants/paths';
import { IWikiWorkspace, useWikiStore } from '../../store/wiki';
import { createTable } from './createTable';
import { storeTiddlersToSQLite } from './storeTextToSQLite';

type StoreHtmlStatus = 'idle' | 'fetching' | 'creating' | 'downloading' | 'sqlite' | 'success' | 'error';

export function useImportHTML() {
  const [status, setStatus] = useState<StoreHtmlStatus>('idle');
  const [error, setError] = useState<string | undefined>();
  const [skinnyHtmlDownloadPercentage, setSkinnyHtmlDownloadPercentage] = useState(0);
  const [skinnyTiddlerStoreScriptDownloadPercentage, setSkinnyTiddlerStoreScriptDownloadPercentage] = useState(0);
  const [nonSkinnyTiddlerStoreScriptDownloadPercentage, setNonSkinnyTiddlerStoreScriptDownloadPercentage] = useState(0);
  const [skinnyTiddlerTextCacheDownloadPercentage, setSkinnyTiddlerTextCacheDownloadPercentage] = useState(0);
  const [addTextToSQLitePercentage, setAddTextToSQLitePercentage] = useState(0);
  const [addFieldsToSQLitePercentage, setAddFieldsToSQLitePercentage] = useState(0);
  const addWiki = useWikiStore(state => state.add);
  const removeWiki = useWikiStore(state => state.remove);
  const [createdWikiWorkspace, setCreatedWikiWorkspace] = useState<undefined | IWikiWorkspace>();
  const resetState = useCallback(() => {
    setStatus('idle');
    setError(undefined);
    setSkinnyHtmlDownloadPercentage(0);
    setSkinnyTiddlerStoreScriptDownloadPercentage(0);
    setNonSkinnyTiddlerStoreScriptDownloadPercentage(0);
    setSkinnyTiddlerTextCacheDownloadPercentage(0);
    setAddTextToSQLitePercentage(0);
    setAddFieldsToSQLitePercentage(0);
    setCreatedWikiWorkspace(undefined);
  }, []);

  const storeHtml = useCallback(async (origin: string, wikiName: string, selectiveSyncFilter: string, serverID: string) => {
    if (WIKI_FOLDER_PATH === undefined) return;
    setStatus('fetching');
    const getSkinnyHTMLUrl = new URL('/tw-mobile-sync/get-skinny-html', origin);
    /**
     * Get tiddlers without text field
     */
    const getSkinnyTiddlywikiTiddlerStoreScriptUrl = new URL('/tw-mobile-sync/get-skinny-tiddlywiki-tiddler-store-script', origin);
    /**
     * Text field of these skinny tiddlers (but might filter ` -[is[binary]]`)
     */
    const getSkinnyTiddlerTextCacheUrl = new URL('/tw-mobile-sync/get-skinny-tiddler-text', origin);
    /**
     * Some tiddlers must have text field on start, this gets them
     */
    const getNonSkinnyTiddlywikiTiddlerStoreScriptUrl = new URL('/tw-mobile-sync/get-non-skinny-tiddlywiki-tiddler-store-script', origin);

    // Fetch the HTML content
    let newWorkspaceID: string | undefined;
    try {
      setStatus('creating');

      // Save the HTML to a file
      const newWorkspace = addWiki({ name: wikiName, selectiveSyncFilter, syncedServers: [{ serverID, lastSync: Date.now() }] });
      if (newWorkspace === undefined) throw new Error('Failed to create workspace');
      newWorkspaceID = newWorkspace.id;
      // make main folder
      // prevent error `Directory 'file:///data/user/0/host.exp.exponent/files/wikis/wiki' could not be created or already exists]`
      await fs.deleteAsync(newWorkspace.wikiFolderLocation, { idempotent: true });
      await fs.makeDirectoryAsync(newWorkspace.wikiFolderLocation, { intermediates: true });
      await fs.makeDirectoryAsync(getWikiCacheFolderPath(newWorkspace), { intermediates: true });
      await fs.makeDirectoryAsync(getWikiTiddlerFolderPath(newWorkspace), { intermediates: true });
      setCreatedWikiWorkspace(newWorkspace);

      setStatus('downloading');
      const htmlDownloadResumable = fs.createDownloadResumable(getSkinnyHTMLUrl.toString(), getWikiFilePath(newWorkspace), {}, (progress) => {
        setSkinnyHtmlDownloadPercentage(progress.totalBytesWritten / progress.totalBytesExpectedToWrite);
      });
      const skinnyTiddlerStoreDownloadResumable = fs.createDownloadResumable(
        getSkinnyTiddlywikiTiddlerStoreScriptUrl.toString(),
        getWikiTiddlerSkinnyStoreCachePath(newWorkspace),
        {},
        (progress) => {
          setSkinnyTiddlerStoreScriptDownloadPercentage(progress.totalBytesWritten / progress.totalBytesExpectedToWrite);
        },
      );
      const skinnyTiddlywikiTiddlerTextDownloadResumable = fs.createDownloadResumable(
        getSkinnyTiddlerTextCacheUrl.toString(),
        getWikiTiddlerTextStoreCachePath(newWorkspace),
        {},
        (progress) => {
          setSkinnyTiddlerTextCacheDownloadPercentage(progress.totalBytesWritten / progress.totalBytesExpectedToWrite);
        },
      );
      const nonSkinnyTiddlerStoreDownloadResumable = fs.createDownloadResumable(
        getNonSkinnyTiddlywikiTiddlerStoreScriptUrl.toString(),
        getWikiTiddlerStorePath(newWorkspace),
        {},
        (progress) => {
          setNonSkinnyTiddlerStoreScriptDownloadPercentage(progress.totalBytesWritten / progress.totalBytesExpectedToWrite);
        },
      );
      await Promise.all([
        htmlDownloadResumable.downloadAsync(),
        skinnyTiddlerStoreDownloadResumable.downloadAsync(),
        nonSkinnyTiddlerStoreDownloadResumable.downloadAsync(),
        skinnyTiddlywikiTiddlerTextDownloadResumable.downloadAsync(),
      ]);
      setStatus('sqlite');
      await createTable(newWorkspace);
      await storeTiddlersToSQLite(newWorkspace, { text: setAddTextToSQLitePercentage, fields: setAddFieldsToSQLitePercentage });
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
    resetState,
    createdWikiWorkspace,
    downloadPercentage: {
      skinnyHtmlDownloadPercentage,
      skinnyTiddlerStoreScriptDownloadPercentage,
      nonSkinnyTiddlerStoreScriptDownloadPercentage,
      skinnyTiddlerTextCacheDownloadPercentage,
      addTextToSQLitePercentage,
      addFieldsToSQLitePercentage,
    },
  };
}
