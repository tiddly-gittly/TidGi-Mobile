/* eslint-disable @typescript-eslint/promise-function-async */
/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/* eslint-disable unicorn/no-null */
import { Asset } from 'expo-asset';
import * as fs from 'expo-file-system';
import { Dispatch, MutableRefObject, SetStateAction, useEffect, useRef, useState } from 'react';
import type { WebView } from 'react-native-webview';
import expoFileSystemSyncadaptorUiAssetID from '../../../assets/plugins/syncadaptor-ui.html';
import expoFileSystemSyncadaptorAssetID from '../../../assets/plugins/syncadaptor.html';
import { getWikiFilePath } from '../../constants/paths';
import { WikiHookService } from '../../services/WikiHookService';
import { WikiStorageService } from '../../services/WikiStorageService';
import { IWikiWorkspace } from '../../store/workspace';
import { useStreamChunksToWebView } from './useStreamChunksToWebView';
import { createSQLiteTiddlersReadStream, SQLiteTiddlersReadStream } from './useStreamChunksToWebView/SQLiteTiddlersReadStream';

export interface IHtmlContent {
  html: string;
  setLoadHtmlError: Dispatch<SetStateAction<string>>;
  tiddlersStream: SQLiteTiddlersReadStream;
}
export function useTiddlyWiki(
  workspace: IWikiWorkspace,
  loaded: boolean,
  webViewReference: MutableRefObject<WebView | null>,
  keyToTriggerReload: number,
  quickLoad: boolean,
  servicesOfWorkspace: MutableRefObject<{ wikiHookService: WikiHookService; wikiStorageService: WikiStorageService } | undefined>,
) {
  const [loadHtmlError, setLoadHtmlError] = useState('');
  const tiddlersStreamReference = useRef<SQLiteTiddlersReadStream | undefined>();
  /**
   * Webview can't load html larger than 20M, we stream the html to webview, and set innerHTML in webview using preloadScript.
   * This need to use with `webviewSideReceiver`.
   * @url https://github.com/react-native-webview/react-native-webview/issues/3126
   */
  const { injectHtmlAndTiddlersStore, streamChunksToWebViewPercentage } = useStreamChunksToWebView(webViewReference, servicesOfWorkspace);
  const loading = streamChunksToWebViewPercentage > 0 && streamChunksToWebViewPercentage < 1;

  const webviewLoaded = loaded && webViewReference.current !== null;
  useEffect(() => {
    if (!webviewLoaded) return;
    void (async () => {
      try {
        /**
         * @url file:///data/user/0/host.exp.exponent/files/wikis/wiki/index.html or 'file:///data/user/0/host.exp.exponent/cache/ExponentAsset-8568a405f924c561e7d18846ddc10c97.html'
         */
        const html = `<!doctype html>${await fs.readAsStringAsync(getWikiFilePath(workspace))}`;
        const pluginJSONStrings = await getTidGiMobilePlugins();
        if (tiddlersStreamReference.current !== undefined) {
          tiddlersStreamReference.current.destroy();
        }
        const tiddlersStream = createSQLiteTiddlersReadStream(workspace, {
          // inject tidgi syncadaptor plugins
          additionalContent: [pluginJSONStrings.expoFileSystemSyncadaptor, pluginJSONStrings.expoFileSystemSyncadaptorUi],
          quickLoad,
        });
        tiddlersStreamReference.current = tiddlersStream;
        await injectHtmlAndTiddlersStore({ html, tiddlersStream, setLoadHtmlError });
      } catch (error) {
        console.error(error, (error as Error).stack);
        setLoadHtmlError((error as Error).message);
      }
    })();
    // React Hook useMemo has a missing dependency: 'injectHtmlAndTiddlersStore', 'quickLoad', and 'workspace'. Either include it or remove the dependency array.
    // but workspace and injectHtmlAndTiddlersStore reference may change multiple times, causing rerender
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id, webviewLoaded, keyToTriggerReload]);
  return { loadHtmlError, loading, streamChunksToWebViewPercentage };
}

export interface ITidGiMobilePlugins {
  expoFileSystemSyncadaptor: string;
  expoFileSystemSyncadaptorUi: string;
}
async function getTidGiMobilePlugins(): Promise<ITidGiMobilePlugins> {
  const assets = await Asset.loadAsync([expoFileSystemSyncadaptorAssetID, expoFileSystemSyncadaptorUiAssetID]);
  const expoFileSystemSyncadaptorFileUri = assets?.[0]?.localUri;
  const expoFileSystemSyncadaptorUiFileUri = assets?.[1]?.localUri;
  if (!expoFileSystemSyncadaptorFileUri) {
    throw new Error(`expoFileSystemSyncadaptor plugin failed to load, ID: ${expoFileSystemSyncadaptorAssetID}`);
  }
  if (!expoFileSystemSyncadaptorUiFileUri) {
    throw new Error(`expoFileSystemSyncadaptorUiAsset plugin failed to load, ID: ${expoFileSystemSyncadaptorUiAssetID}`);
  }
  const [expoFileSystemSyncadaptor, expoFileSystemSyncadaptorUi] = await Promise.all([
    fs.readAsStringAsync(expoFileSystemSyncadaptorFileUri),
    fs.readAsStringAsync(expoFileSystemSyncadaptorUiFileUri),
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
