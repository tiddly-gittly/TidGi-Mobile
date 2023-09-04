/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/* eslint-disable unicorn/no-null */
import { useAssets } from 'expo-asset';
import * as fs from 'expo-file-system';
import { useEffect, useState } from 'react';
import expoFileSystemSyncadaptorUiAssetID from '../../../assets/plugins/syncadaptor-ui.html';
import expoFileSystemSyncadaptorAssetID from '../../../assets/plugins/syncadaptor.html';
import { getWikiFilePath, getWikiTiddlerStorePath } from '../../constants/paths';
import { IWikiWorkspace } from '../../store/wiki';
import { getSkinnyTiddlersJSONFromSQLite } from './WikiStorageService';

export interface IHtmlContent {
  html: string;
  skinnyTiddlerStore: string;
  tiddlerStoreScript: string;
}
export function useTiddlyWiki(workspace: IWikiWorkspace) {
  const [htmlContent, setHtmlContent] = useState<IHtmlContent | null>(null);
  const [loadHtmlError, setLoadHtmlError] = useState('');

  const [pluginJSONStrings, pluginLoadError] = useTidGiMobilePlugins();

  useEffect(() => {
    if (pluginJSONStrings === undefined) return;
    const fetchHTML = async () => {
      try {
        setHtmlContent(null);
        const [html, tiddlerStoreScript] = await Promise.all([
          fs.readAsStringAsync(getWikiFilePath(workspace)), // file:///data/user/0/host.exp.exponent/files/wikis/wiki/index.html or 'file:///data/user/0/host.exp.exponent/cache/ExponentAsset-8568a405f924c561e7d18846ddc10c97.html'
          fs.readAsStringAsync(getWikiTiddlerStorePath(workspace)), // file:///data/user/0/host.exp.exponent/files/wikis/wiki/tiddlerStore.json
        ]);

        const skinnyTiddlerStore = await getSkinnyTiddlersJSONFromSQLite(workspace);

        // inject tidgi syncadaptor plugins
        const tidgiMobilePlugins = `,${pluginJSONStrings.expoFileSystemSyncadaptor},${pluginJSONStrings.expoFileSystemSyncadaptorUi}`;
        const tiddlerStoreScriptWithTidGiMobilePlugins = `${tiddlerStoreScript.slice(0, -1)}${tidgiMobilePlugins}]`;
        setHtmlContent({ html, tiddlerStoreScript: tiddlerStoreScriptWithTidGiMobilePlugins, skinnyTiddlerStore });
      } catch (error) {
        console.error(error, (error as Error).stack);
        setLoadHtmlError((error as Error).message);
      }
    };
    void fetchHTML();
  }, [workspace, pluginJSONStrings]);
  return { htmlContent, loadHtmlError, pluginLoadError };
}

export interface ITidGiMobilePlugins {
  expoFileSystemSyncadaptor: string;
  expoFileSystemSyncadaptorUi: string;
}
export function useTidGiMobilePlugins() {
  const [pluginJSONStrings, setPluginString] = useState<ITidGiMobilePlugins | undefined>();

  const [assets, error] = useAssets([expoFileSystemSyncadaptorAssetID, expoFileSystemSyncadaptorUiAssetID]);
  useEffect(() => {
    const expoFileSystemSyncadaptorFileUri = assets?.[0]?.localUri;
    const expoFileSystemSyncadaptorUiFileUri = assets?.[1]?.localUri;
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    if (!expoFileSystemSyncadaptorFileUri || !expoFileSystemSyncadaptorUiFileUri) return;
    const fetchHTML = async () => {
      const [expoFileSystemSyncadaptor, expoFileSystemSyncadaptorUi] = await Promise.all([
        fs.readAsStringAsync(expoFileSystemSyncadaptorFileUri),
        fs.readAsStringAsync(expoFileSystemSyncadaptorUiFileUri),
      ]);
      setPluginString({
        expoFileSystemSyncadaptor,
        expoFileSystemSyncadaptorUi,
      });
    };

    void fetchHTML();
  }, [assets]);
  return [pluginJSONStrings, error?.message] as const;
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
