import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import { Dispatch, RefObject, SetStateAction, useEffect, useRef, useState } from 'react';
import type { WebView } from 'react-native-webview';
import expoFileSystemSyncadaptorUiAssetID from '../../../assets/plugins/syncadaptor-ui.html';
import expoFileSystemSyncadaptorAssetID from '../../../assets/plugins/syncadaptor.html';
import { ExternalStorage, toPlainPath } from '../../../modules/external-storage';
import { getWikiFilePath } from '../../constants/paths';
import { WikiHookService } from '../../services/WikiHookService';
import { FileSystemWikiStorageService } from '../../services/WikiStorageService/FileSystemWikiStorageService';
import { IWikiWorkspace } from '../../store/workspace';
import { useStreamChunksToWebView } from './useStreamChunksToWebView';
import { FileSystemTiddlersReadStream } from './useStreamChunksToWebView/FileSystemTiddlersReadStream';

/**
 * Whether a path points to external/shared storage (needs ExternalStorage native module).
 */
function isExternalPath(filepath: string): boolean {
  const plain = toPlainPath(filepath);
  return plain.startsWith('/storage/') || plain.startsWith('/sdcard/');
}

/**
 * Read text file content — uses ExternalStorage for external paths,
 * expo-file-system for internal paths.
 */
async function readTextFile(uri: string): Promise<string> {
  if (isExternalPath(uri)) {
    return ExternalStorage.readFileUtf8(toPlainPath(uri));
  }
  const file = new File(uri);
  return file.text();
}

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
        /**
         * @url file:///data/user/0/host.exp.exponent/files/wikis/wiki/index.html or 'file:///data/user/0/host.exp.exponent/cache/ExponentAsset-8568a405f924c561e7d18846ddc10c97.html'
         */
        const wikiFilePath = getWikiFilePath(workspace);
        console.log(`[useTiddlyWiki] reading wiki HTML from: ${wikiFilePath}`);
        const htmlText = await readTextFile(wikiFilePath);
        console.log(`[useTiddlyWiki] wiki HTML loaded, length=${htmlText.length}`);
        const html = `<!doctype html>${htmlText}`;
        console.log(`[useTiddlyWiki] loading TidGi mobile plugins...`);
        const pluginJSONStrings = await getTidGiMobilePlugins();
        console.log(`[useTiddlyWiki] plugins loaded, syncadaptor length=${pluginJSONStrings.expoFileSystemSyncadaptor.length}`);
        if (tiddlersStreamReference.current !== undefined) {
          tiddlersStreamReference.current.destroy();
        }

        const tiddlersStream = new FileSystemTiddlersReadStream(workspace, {
          additionalContent: [pluginJSONStrings.expoFileSystemSyncadaptor, pluginJSONStrings.expoFileSystemSyncadaptorUi],
          quickLoad,
        });
        console.log(`[useTiddlyWiki] calling tiddlersStream.init()...`);
        tiddlersStream.init();
        console.log(`[useTiddlyWiki] tiddlersStream.init() done, calling injectHtmlAndTiddlersStore...`);

        tiddlersStreamReference.current = tiddlersStream;
        await injectHtmlAndTiddlersStore({ html, tiddlersStream, setLoadHtmlError });
        console.log(`[useTiddlyWiki] injectHtmlAndTiddlersStore completed`);
      } catch (error) {
        console.error(`[useTiddlyWiki] FATAL error:`, error, (error as Error).stack);
        setLoadHtmlError((error as Error).message);
      }
    })();
    // React Hook useMemo has a missing dependency: 'injectHtmlAndTiddlersStore', 'quickLoad', and 'workspace'. Either include it or remove the dependency array.
    // but workspace and injectHtmlAndTiddlersStore reference may change multiple times, causing rerender
  }, [workspace.id, webviewLoaded, keyToTriggerReload]);
  return { loadHtmlError, loading, streamChunksToWebViewPercentage };
}

export interface ITidGiMobilePlugins {
  expoFileSystemSyncadaptor: string;
  expoFileSystemSyncadaptorUi: string;
}
async function getTidGiMobilePlugins(): Promise<ITidGiMobilePlugins> {
  const assets = await Asset.loadAsync([expoFileSystemSyncadaptorAssetID, expoFileSystemSyncadaptorUiAssetID]);
  const expoFileSystemSyncadaptorFileUri = assets[0].localUri;
  const expoFileSystemSyncadaptorUiFileUri = assets[1].localUri;
  if (!expoFileSystemSyncadaptorFileUri) {
    throw new Error(`expoFileSystemSyncadaptor plugin failed to load, ID: ${expoFileSystemSyncadaptorAssetID}`);
  }
  if (!expoFileSystemSyncadaptorUiFileUri) {
    throw new Error(`expoFileSystemSyncadaptorUiAsset plugin failed to load, ID: ${expoFileSystemSyncadaptorUiAssetID}`);
  }
  const syncadaptorFile = new File(expoFileSystemSyncadaptorFileUri);
  const syncadaptorUiFile = new File(expoFileSystemSyncadaptorUiFileUri);
  const [expoFileSystemSyncadaptor, expoFileSystemSyncadaptorUi] = await Promise.all([
    syncadaptorFile.text(),
    syncadaptorUiFile.text(),
  ]);
  return ({
    expoFileSystemSyncadaptor,
    expoFileSystemSyncadaptorUi,
  });
}

// export function useEmptyTiddlyWiki() {
//   const [htmlContent, setHtmlContent] = useState('');

//   const [assets, error] = useAssets([emptyWikiAssetID]);
//   useEffect(() => {
//     const emptyWikiFileUri = assets?.[0]?.localUri;
//     if (emptyWikiFileUri === undefined || emptyWikiFileUri === null) return;
//     const fetchHTML = async () => {
//       const content = await fs.readAsStringAsync(emptyWikiFileUri);
//       const modifiedContent = content.replace('</body>', '<script>console.log("loaded")</script></body>');
//       setHtmlContent(modifiedContent);
//     };

//     void fetchHTML();
//   }, [assets]);
//   return htmlContent;
// }
