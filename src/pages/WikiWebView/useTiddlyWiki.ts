import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import { Dispatch, RefObject, SetStateAction, useEffect, useRef, useState } from 'react';
import type { WebView } from 'react-native-webview';
import tiddlywikiEmptyHtmlAssetID from '../../../assets/tiddlywiki/tiddlywiki-empty.html';
import expoFileSystemSyncadaptorUiAssetID from '../../../assets/plugins/syncadaptor-ui.html';
import expoFileSystemSyncadaptorAssetID from '../../../assets/plugins/syncadaptor.html';
import { WikiHookService } from '../../services/WikiHookService';
import { FileSystemWikiStorageService } from '../../services/WikiStorageService/FileSystemWikiStorageService';
import { IWikiWorkspace } from '../../store/workspace';
import { useStreamChunksToWebView } from './useStreamChunksToWebView';
import { FileSystemTiddlersReadStream } from './useStreamChunksToWebView/FileSystemTiddlersReadStream';

export interface IHtmlContent {
  html: string;
  setLoadHtmlError: Dispatch<SetStateAction<string>>;
  tiddlersStream: FileSystemTiddlersReadStream;
}
export function useTiddlyWiki(
  workspace: IWikiWorkspace,
  loaded: boolean,
  webViewReference: RefObject<WebView | null>,
  keyToTriggerReload: number,
  quickLoad: boolean,
  servicesOfWorkspace: RefObject<{ wikiHookService: WikiHookService; wikiStorageService: FileSystemWikiStorageService } | undefined>,
) {
  const [loadHtmlError, setLoadHtmlError] = useState('');
  const tiddlersStreamReference = useRef<FileSystemTiddlersReadStream | undefined>(undefined);
  /**
   * Webview can't load html larger than 20M, we stream the html to webview, and set innerHTML in webview using preloadScript.
   * This need to use with `webviewSideReceiver`.
   * @url https://github.com/react-native-webview/react-native-webview/issues/3126
   */
  const { injectHtmlAndTiddlersStore, streamChunksToWebViewPercentage } = useStreamChunksToWebView(webViewReference, servicesOfWorkspace);
  const loading = streamChunksToWebViewPercentage > 0 && streamChunksToWebViewPercentage < 1;

  const webviewLoaded = loaded && webViewReference.current !== null;
  useEffect(() => {
    console.log(`[useTiddlyWiki] effect fired: loaded=${String(loaded)}, webViewRef=${webViewReference.current !== null}, webviewLoaded=${String(webviewLoaded)}, workspaceId=${workspace.id}, wikiFolderLocation=${workspace.wikiFolderLocation}`);
    if (!webviewLoaded) return;
    void (async () => {
      try {
        const { emptyHtml, expoFileSystemSyncadaptor, expoFileSystemSyncadaptorUi } = await loadBundledAssets();
        console.log(`[useTiddlyWiki] assets loaded: html=${emptyHtml.length}, syncadaptor=${expoFileSystemSyncadaptor.length}`);
        if (tiddlersStreamReference.current !== undefined) {
          tiddlersStreamReference.current.destroy();
        }

        // The HTML already contains $:/core + themes in its store area (rendered by $:/core/save/empty).
        // We only stream syncadaptor plugins and user tiddlers from the filesystem.
        const tiddlersStream = new FileSystemTiddlersReadStream(workspace, {
          additionalContent: [expoFileSystemSyncadaptor, expoFileSystemSyncadaptorUi],
          quickLoad,
        });
        tiddlersStream.init();

        tiddlersStreamReference.current = tiddlersStream;
        await injectHtmlAndTiddlersStore({ html: emptyHtml, tiddlersStream, setLoadHtmlError });
      } catch (error) {
        console.error(`[useTiddlyWiki] FATAL error:`, error, (error as Error).stack);
        setLoadHtmlError((error as Error).message);
      }
    })();
    // workspace and injectHtmlAndTiddlersStore reference may change multiple times, causing rerender
  }, [workspace.id, webviewLoaded, keyToTriggerReload]);
  return { loadHtmlError, loading, streamChunksToWebViewPercentage };
}

export interface IBundledAssets {
  emptyHtml: string;
  expoFileSystemSyncadaptor: string;
  expoFileSystemSyncadaptorUi: string;
}

/**
 * Load bundled TiddlyWiki assets from the app bundle.
 * The empty HTML (rendered from $:/core/save/empty) already contains $:/core + themes.
 */
async function loadBundledAssets(): Promise<IBundledAssets> {
  const assets = await Asset.loadAsync([
    tiddlywikiEmptyHtmlAssetID,
    expoFileSystemSyncadaptorAssetID,
    expoFileSystemSyncadaptorUiAssetID,
  ]);
  const uris = assets.map(a => a.localUri);
  for (let index = 0; index < uris.length; index++) {
    if (!uris[index]) throw new Error(`Asset ${index} failed to load (localUri is null)`);
  }
  const [emptyHtml, expoFileSystemSyncadaptor, expoFileSystemSyncadaptorUi] = await Promise.all(
    uris.map(uri => new File(uri!).text()),
  );
  return { emptyHtml, expoFileSystemSyncadaptor, expoFileSystemSyncadaptorUi };
}
