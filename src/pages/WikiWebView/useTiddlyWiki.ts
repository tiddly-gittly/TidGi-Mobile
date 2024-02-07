/* eslint-disable @typescript-eslint/promise-function-async */
/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/* eslint-disable unicorn/no-null */
import { Asset } from 'expo-asset';
import * as fs from 'expo-file-system';
import { Dispatch, SetStateAction, useEffect, useRef, useState } from 'react';
import expoFileSystemSyncadaptorUiAssetID from '../../../assets/plugins/syncadaptor-ui.html';
import expoFileSystemSyncadaptorAssetID from '../../../assets/plugins/syncadaptor.html';
import { getWikiFilePath } from '../../constants/paths';
import { IWikiWorkspace } from '../../store/workspace';
import { usePromiseValue } from '../../utils/usePromiseValue';
import { createSQLiteTiddlersReadStream, SQLiteTiddlersReadStream } from './useStreamChunksToWebView/SQLiteTiddlersReadStream';

export interface IHtmlContent {
  html: string;
  setLoadHtmlError: Dispatch<SetStateAction<string>>;
  tiddlersStream: SQLiteTiddlersReadStream;
}
export function useTiddlyWiki(
  workspace: IWikiWorkspace,
  injectHtmlAndTiddlersStore: (htmlContent: IHtmlContent) => Promise<void>,
  webviewLoaded: boolean,
  keyToTriggerReload: number,
  quickLoad: boolean,
) {
  const [loadHtmlError, setLoadHtmlError] = useState('');
  /**
   * @url file:///data/user/0/host.exp.exponent/files/wikis/wiki/index.html or 'file:///data/user/0/host.exp.exponent/cache/ExponentAsset-8568a405f924c561e7d18846ddc10c97.html'
   */
  const html = usePromiseValue<string>(() => fs.readAsStringAsync(getWikiFilePath(workspace)));
  const pluginJSONStrings = usePromiseValue<ITidGiMobilePlugins>(() => getTidGiMobilePlugins());
  const tiddlersStreamReference = useRef<SQLiteTiddlersReadStream | undefined>();
  useEffect(() => {
    if (!webviewLoaded || !html || !pluginJSONStrings) return;
    void (async () => {
      try {
        const htmlWithPrefix = `<!doctype html>${html}`;
        if (tiddlersStreamReference.current !== undefined) {
          tiddlersStreamReference.current.destroy();
        }
        const tiddlersStream = createSQLiteTiddlersReadStream(workspace, {
          // inject tidgi syncadaptor plugins
          additionalContent: [pluginJSONStrings.expoFileSystemSyncadaptor, pluginJSONStrings.expoFileSystemSyncadaptorUi],
          quickLoad,
        });
        tiddlersStreamReference.current = tiddlersStream;
        await injectHtmlAndTiddlersStore({ html: htmlWithPrefix, tiddlersStream, setLoadHtmlError });
      } catch (error) {
        console.error(error, (error as Error).stack);
        setLoadHtmlError((error as Error).message);
      }
    })();
    // React Hook useMemo has a missing dependency: 'workspace'. Either include it or remove the dependency array.
    // but workspace reference may change multiple times, causing rerender
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id, injectHtmlAndTiddlersStore, webviewLoaded, keyToTriggerReload, html, pluginJSONStrings]);
  return { loadHtmlError };
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
