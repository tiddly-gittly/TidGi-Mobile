/* eslint-disable @typescript-eslint/promise-function-async */
/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import * as fs from 'expo-file-system';
import { useCallback, useState } from 'react';
import { defaultBinaryFilter, defaultTextBasedTiddlerFilter } from '../../constants/filters';
import {
  getWikiBinaryTiddlersListCachePath,
  getWikiCacheFolderPath,
  getWikiFilePath,
  getWikiMainSqlitePath,
  getWikiTiddlerFolderPath,
  getWikiTiddlerSkinnyStoreCachePath,
  getWikiTiddlerStorePath,
  getWikiTiddlerTextStoreCachePath,
  WIKI_FOLDER_PATH,
} from '../../constants/paths';
import { importService } from '../../services/ImportService';
import { sqliteServiceService } from '../../services/SQLiteService';
import { IWikiWorkspace, useWorkspaceStore } from '../../store/workspace';

type StoreHtmlStatus = 'idle' | 'fetching' | 'creating' | 'downloading' | 'sqlite' | 'success' | 'error';

export function useImportHTML() {
  const [status, setStatus] = useState<StoreHtmlStatus>('idle');
  const [error, setError] = useState<string | undefined>();
  const [skinnyHtmlDownloadPercentage, setSkinnyHtmlDownloadPercentage] = useState(0);
  const [skinnyTiddlerStoreScriptDownloadPercentage, setSkinnyTiddlerStoreScriptDownloadPercentage] = useState(0);
  const [nonSkinnyTiddlerStoreScriptDownloadPercentage, setNonSkinnyTiddlerStoreScriptDownloadPercentage] = useState(0);
  const [skinnyTiddlerTextCacheDownloadPercentage, setSkinnyTiddlerTextCacheDownloadPercentage] = useState(0);
  const [binaryTiddlersListDownloadPercentage, setBinaryTiddlersListDownloadPercentage] = useState(0);
  const [addTextToSQLitePercentage, setAddTextToSQLitePercentage] = useState(0);
  const [addFieldsToSQLitePercentage, setAddFieldsToSQLitePercentage] = useState(0);
  const [addSystemTiddlersToSQLitePercentage, setAddSystemTiddlersToSQLitePercentage] = useState(0);
  const addWiki = useWorkspaceStore(state => state.add);
  const removeWiki = useWorkspaceStore(state => state.remove);
  const [createdWikiWorkspace, setCreatedWikiWorkspace] = useState<undefined | IWikiWorkspace>();
  const resetState = useCallback(() => {
    setStatus('idle');
    setError(undefined);
    setSkinnyHtmlDownloadPercentage(0);
    setSkinnyTiddlerStoreScriptDownloadPercentage(0);
    setNonSkinnyTiddlerStoreScriptDownloadPercentage(0);
    setSkinnyTiddlerTextCacheDownloadPercentage(0);
    setBinaryTiddlersListDownloadPercentage(0);
    setAddTextToSQLitePercentage(0);
    setAddFieldsToSQLitePercentage(0);
    setCreatedWikiWorkspace(undefined);
  }, []);

  const storeHtml = useCallback(async (origin: string, wikiName: string, serverID?: string) => {
    if (WIKI_FOLDER_PATH === undefined) return;
    setStatus('fetching');
    const getSkinnyHTMLUrl = new URL('/tw-mobile-sync/get-skinny-html', origin);
    /**
     * Get tiddlers without text field
     */
    const getSkinnyTiddlywikiTiddlerStoreScriptUrl = new URL('/tw-mobile-sync/get-skinny-tiddlywiki-tiddler-store-script', origin);
    /**
     * This will basically get non-binary text tiddlers's text field as a large JSON.
     * Only get text field of these skinny tiddlers, excluding all binary tiddlers, by adding filter to the path
     * `/^\/tw-mobile-sync\/get-skinny-tiddler-text\/(.+)$/;`
     */
    const getSkinnyTiddlerTextCacheUrl = new URL(`/tw-mobile-sync/get-skinny-tiddler-text/${encodeURIComponent(defaultTextBasedTiddlerFilter)}`, origin);
    /**
     * Get binary tiddlers metadata without text field. We later can use this to prefetch all binary tiddlers.
     */
    const getBinaryTiddlersListUrl = new URL(`/recipes/default/tiddlers.json?filter=${encodeURIComponent(defaultBinaryFilter)}`, origin);
    /**
     * Some tiddlers must have text field on start, this gets them.
     * This JSON contains non-skinny tiddlers, like system tiddlers and state tiddlers.
     */
    const getNonSkinnyTiddlywikiTiddlerStoreScriptUrl = new URL('/tw-mobile-sync/get-non-skinny-tiddlywiki-tiddler-store-script', origin);

    // Fetch the HTML content
    let newWorkspaceID: string | undefined;
    try {
      setStatus('creating');

      const newWorkspace = addWiki({ type: 'wiki', name: wikiName, syncedServers: serverID === undefined ? [] : [{ serverID, lastSync: Date.now(), syncActive: true }] }) as
        | IWikiWorkspace
        | undefined;
      if (newWorkspace === undefined) throw new Error('Failed to create workspace');
      newWorkspaceID = newWorkspace.id;
      // make main folder
      // prevent error `Directory 'file:///data/user/0/host.exp.exponent/files/wikis/wiki' could not be created or already exists]`
      await fs.deleteAsync(newWorkspace.wikiFolderLocation, { idempotent: true });
      try {
        await fs.deleteAsync(getWikiMainSqlitePath(newWorkspace));
      } catch {}
      await fs.makeDirectoryAsync(newWorkspace.wikiFolderLocation, { intermediates: true });
      await fs.makeDirectoryAsync(getWikiCacheFolderPath(newWorkspace), { intermediates: true });
      await fs.makeDirectoryAsync(getWikiTiddlerFolderPath(newWorkspace), { intermediates: true });
      setCreatedWikiWorkspace(newWorkspace);

      setStatus('downloading');
      const createDownloadResumableWithProgress = (url: URL, locationToSave: string, setProgress: (progress: number) => void) => {
        return fs.createDownloadResumable(
          url.toString(),
          locationToSave,
          {},
          (progress) => {
            if (progress.totalBytesExpectedToWrite <= 0) {
              setProgress(1);
              return;
            }
            setProgress(progress.totalBytesWritten / progress.totalBytesExpectedToWrite);
          },
        );
      };
      // Save the HTML to a file
      const htmlDownloadResumable = createDownloadResumableWithProgress(getSkinnyHTMLUrl, getWikiFilePath(newWorkspace), setSkinnyHtmlDownloadPercentage);
      const skinnyTiddlerStoreDownloadResumable = createDownloadResumableWithProgress(
        getSkinnyTiddlywikiTiddlerStoreScriptUrl,
        getWikiTiddlerSkinnyStoreCachePath(newWorkspace),
        setSkinnyTiddlerStoreScriptDownloadPercentage,
      );
      const skinnyTiddlywikiTiddlerTextDownloadResumable = createDownloadResumableWithProgress(
        getSkinnyTiddlerTextCacheUrl,
        getWikiTiddlerTextStoreCachePath(newWorkspace),
        setSkinnyTiddlerTextCacheDownloadPercentage,
      );
      const nonSkinnyTiddlerStoreDownloadResumable = createDownloadResumableWithProgress(
        getNonSkinnyTiddlywikiTiddlerStoreScriptUrl,
        getWikiTiddlerStorePath(newWorkspace),
        setNonSkinnyTiddlerStoreScriptDownloadPercentage,
      );
      const binaryTiddlersListDownloadResumable = createDownloadResumableWithProgress(
        getBinaryTiddlersListUrl,
        getWikiBinaryTiddlersListCachePath(newWorkspace),
        setBinaryTiddlersListDownloadPercentage,
      );
      await Promise.all([
        htmlDownloadResumable.downloadAsync(),
        skinnyTiddlerStoreDownloadResumable.downloadAsync(),
        nonSkinnyTiddlerStoreDownloadResumable.downloadAsync(),
        skinnyTiddlywikiTiddlerTextDownloadResumable.downloadAsync(),
        binaryTiddlersListDownloadResumable.downloadAsync(),
      ]);
      setStatus('sqlite');
      await importService.storeTiddlersToSQLite(newWorkspace, {
        text: setAddTextToSQLitePercentage,
        fields: setAddFieldsToSQLitePercentage,
        system: setAddSystemTiddlersToSQLitePercentage,
        setError,
      });
      await sqliteServiceService.closeDatabase(newWorkspace);
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
      binaryTiddlersListDownloadPercentage,
      addTextToSQLitePercentage,
      addFieldsToSQLitePercentage,
      addSystemTiddlersToSQLitePercentage,
    },
  };
}
