/* eslint-disable @typescript-eslint/promise-function-async */
/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/* eslint-disable unicorn/no-null */
import { Asset } from 'expo-asset';
import * as fs from 'expo-file-system';
import { useEffect, useRef, useState } from 'react';
import expoFileSystemSyncadaptorUiAssetID from '../../../assets/plugins/syncadaptor-ui.html';
import expoFileSystemSyncadaptorAssetID from '../../../assets/plugins/syncadaptor.html';
import { getWikiFilePath, getWikiTiddlerStorePath } from '../../constants/paths';
import { replaceTiddlerStoreScriptToTriggerFullReload } from '../../services/WikiHookService';
import { getSkinnyTiddlersJSONFromSQLite } from '../../services/WikiStorageService';
import { IWikiWorkspace } from '../../store/workspace';
import { usePromiseValue } from '../../utils/usePromiseValue';

export interface IHtmlContent {
  html: string;
  skinnyTiddlerStore: string;
  tiddlerStoreScript: string;
}
export function useTiddlyWiki(workspace: IWikiWorkspace, injectHtmlAndTiddlersStore: (htmlContent: IHtmlContent) => void, webviewLoaded: boolean, keyToTriggerReload: number) {
  const [loadHtmlError, setLoadHtmlError] = useState('');
  /**
   * @url file:///data/user/0/host.exp.exponent/files/wikis/wiki/index.html or 'file:///data/user/0/host.exp.exponent/cache/ExponentAsset-8568a405f924c561e7d18846ddc10c97.html'
   */
  const html = usePromiseValue<string>(() => fs.readAsStringAsync(getWikiFilePath(workspace)));
  /**
   * @url file:///data/user/0/host.exp.exponent/files/wikis/wiki/tiddlerStore.json
   */
  const tiddlerStoreScript = usePromiseValue<string>(() => fs.readAsStringAsync(getWikiTiddlerStorePath(workspace)));
  const skinnyTiddlerStore = usePromiseValue<string>(() => getSkinnyTiddlersJSONFromSQLite(workspace));
  const pluginJSONStrings = usePromiseValue<ITidGiMobilePlugins>(() => getTidGiMobilePlugins());
  useEffect(() => {
    if (!webviewLoaded || !html || !tiddlerStoreScript || !skinnyTiddlerStore || !pluginJSONStrings) return;
    try {
      const htmlWithPrefix = `<!doctype html>${html}`;
      // inject tidgi syncadaptor plugins
      const tidgiMobilePlugins = `,${pluginJSONStrings.expoFileSystemSyncadaptor},${pluginJSONStrings.expoFileSystemSyncadaptorUi}`;
      const tiddlerStoreScriptWithTidGiMobilePlugins = `${patchTiddlyWiki(tiddlerStoreScript).slice(0, -1)}${tidgiMobilePlugins}]`;
      injectHtmlAndTiddlersStore({ html: htmlWithPrefix, tiddlerStoreScript: tiddlerStoreScriptWithTidGiMobilePlugins, skinnyTiddlerStore });
    } catch (error) {
      console.error(error, (error as Error).stack);
      setLoadHtmlError((error as Error).message);
    }
  }, [injectHtmlAndTiddlersStore, webviewLoaded, keyToTriggerReload, html, tiddlerStoreScript, skinnyTiddlerStore, pluginJSONStrings]);
  return { loadHtmlError };
}
function patchTiddlyWiki(tiddlyWikiHTML: string): string {
  return replaceTiddlerStoreScriptToTriggerFullReload(tiddlyWikiHTML);
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
