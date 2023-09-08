/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/* eslint-disable unicorn/no-null */
import { Asset } from 'expo-asset';
import * as fs from 'expo-file-system';
import { useEffect, useState } from 'react';
import expoFileSystemSyncadaptorUiAssetID from '../../../assets/plugins/syncadaptor-ui.html';
import expoFileSystemSyncadaptorAssetID from '../../../assets/plugins/syncadaptor.html';
import { getWikiFilePath, getWikiTiddlerStorePath } from '../../constants/paths';
import { getSkinnyTiddlersJSONFromSQLite } from '../../services/WikiStorageService';
import { IWikiWorkspace } from '../../store/wiki';

export interface IHtmlContent {
  html: string;
  skinnyTiddlerStore: string;
  tiddlerStoreScript: string;
}
export function useTiddlyWiki(workspace: IWikiWorkspace, injectHtmlAndTiddlersStore: (htmlContent: IHtmlContent) => void, webviewLoaded: boolean, keyToTriggerReload: number) {
  const [loadHtmlError, setLoadHtmlError] = useState('');

  useEffect(() => {
    if (!webviewLoaded) return;
    const fetchHTML = async () => {
      try {
        const [html, tiddlerStoreScript, skinnyTiddlerStore, pluginJSONStrings] = await Promise.all([
          fs.readAsStringAsync(getWikiFilePath(workspace)), // file:///data/user/0/host.exp.exponent/files/wikis/wiki/index.html or 'file:///data/user/0/host.exp.exponent/cache/ExponentAsset-8568a405f924c561e7d18846ddc10c97.html'
          fs.readAsStringAsync(getWikiTiddlerStorePath(workspace)), // file:///data/user/0/host.exp.exponent/files/wikis/wiki/tiddlerStore.json
          getSkinnyTiddlersJSONFromSQLite(workspace),
          getTidGiMobilePlugins(),
        ]);

        // inject tidgi syncadaptor plugins
        const tidgiMobilePlugins = `,${pluginJSONStrings.expoFileSystemSyncadaptor},${pluginJSONStrings.expoFileSystemSyncadaptorUi}`;
        const tiddlerStoreScriptWithTidGiMobilePlugins = `${tiddlerStoreScript.slice(0, -1)}${tidgiMobilePlugins}]`;
        injectHtmlAndTiddlersStore({ html, tiddlerStoreScript: tiddlerStoreScriptWithTidGiMobilePlugins, skinnyTiddlerStore });
      } catch (error) {
        console.error(error, (error as Error).stack);
        setLoadHtmlError((error as Error).message);
      }
    };
    void fetchHTML();
  }, [workspace, injectHtmlAndTiddlersStore, webviewLoaded, keyToTriggerReload]);
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
