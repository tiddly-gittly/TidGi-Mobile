import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import { ExternalStorage, toPlainPath } from 'expo-filesystem-android-external-storage';
import { Dispatch, RefObject, SetStateAction, useEffect, useRef, useState } from 'react';
import type { WebView } from 'react-native-webview';
import expoFileSystemSyncadaptorUiAssetID from '../../../assets/plugins/syncadaptor-ui.html';
import expoFileSystemSyncadaptorAssetID from '../../../assets/plugins/syncadaptor.html';
import tiddlywikiEmptyHtmlAssetID from '../../../assets/tiddlywiki/tiddlywiki-empty.html';
import { getWikiTiddlerFolderPath } from '../../constants/paths';
import { WikiHookService } from '../../services/WikiHookService';
import { FileSystemWikiStorageService } from '../../services/WikiStorageService/FileSystemWikiStorageService';
import { readTidgiConfig } from '../../services/WikiStorageService/tidgiConfigManager';
import { IWikiWorkspace, useWorkspaceStore } from '../../store/workspace';
import { useStreamChunksToWebView } from './useStreamChunksToWebView';
import { FileSystemTiddlersReadStream } from './useStreamChunksToWebView/FileSystemTiddlersReadStream';

const timestamp = () => new Date().toISOString();

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
  const loadRunIdReference = useRef(0);
  /**
   * Webview can't load html larger than 20M, we stream the html to webview, and set innerHTML in webview using preloadScript.
   * This need to use with `webviewSideReceiver`.
   * @url https://github.com/react-native-webview/react-native-webview/issues/3126
   */
  const { injectHtmlAndTiddlersStore, streamChunksToWebViewPercentage } = useStreamChunksToWebView(webViewReference, servicesOfWorkspace);
  const loading = streamChunksToWebViewPercentage > 0 && streamChunksToWebViewPercentage < 1;

  const webviewLoaded = loaded && webViewReference.current !== null;
  useEffect(() => {
    console.log(
      `[useTiddlyWiki] effect fired: loaded=${String(loaded)}, webViewRef=${webViewReference.current !== null}, webviewLoaded=${
        String(webviewLoaded)
      }, workspaceId=${workspace.id}, wikiFolderLocation=${workspace.wikiFolderLocation}`,
    );
    if (!webviewLoaded) return;
    const loadRunId = ++loadRunIdReference.current;
    void (async () => {
      try {
        const { emptyHtml, expoFileSystemSyncadaptor, expoFileSystemSyncadaptorUi } = await loadBundledAssets();
        if (loadRunId !== loadRunIdReference.current) return;
        console.log(`${timestamp()} [useTiddlyWiki] assets loaded: html=${emptyHtml.length}, syncadaptor=${expoFileSystemSyncadaptor.length}`);
        if (tiddlersStreamReference.current !== undefined) {
          tiddlersStreamReference.current.removeAllListeners();
          tiddlersStreamReference.current.destroy();
        }

        // The HTML already contains $:/core + themes in its store area (rendered by $:/core/save/empty).
        // We only stream syncadaptor plugins and user tiddlers from the filesystem.
        const allWikiWorkspaces = useWorkspaceStore.getState().workspaces.filter((item): item is IWikiWorkspace => item.type === 'wiki');
        const relatedSubWikis = allWikiWorkspaces.filter(item => item.isSubWiki === true && item.mainWikiID === workspace.id);
        const mainConfig = await readTidgiConfig(workspace);
        const subWikisFromConfig = Array.isArray(mainConfig.subWikis) ? mainConfig.subWikis : [];
        const recoveredSubWikis = await Promise.all(relatedSubWikis.map(async (subWorkspace) => {
          if (await isWikiFolderAvailable(subWorkspace)) {
            return subWorkspace;
          }
          const matchedConfig = subWikisFromConfig.find((subWiki) =>
            (typeof subWiki.id === 'string' && subWiki.id === subWorkspace.id) ||
            (typeof subWiki.name === 'string' && subWiki.name === subWorkspace.name)
          );
          if (!matchedConfig || typeof matchedConfig.path !== 'string' || matchedConfig.path.length === 0) {
            return undefined;
          }
          const resolvedPath = resolveSubWikiPath(workspace.wikiFolderLocation, matchedConfig.path);
          const recoveredWorkspace = {
            ...subWorkspace,
            wikiFolderLocation: resolvedPath,
          };
          if (!(await isWikiFolderAvailable(recoveredWorkspace))) {
            return undefined;
          }
          return recoveredWorkspace;
        }));
        if (loadRunId !== loadRunIdReference.current) return;
        const workspacesToLoad = [workspace, ...recoveredSubWikis.filter((item): item is IWikiWorkspace => item !== undefined)];
        const tiddlersStream = new FileSystemTiddlersReadStream(workspacesToLoad, {
          additionalContent: [expoFileSystemSyncadaptor, expoFileSystemSyncadaptorUi],
          quickLoad,
        });
        tiddlersStream.init();

        tiddlersStreamReference.current = tiddlersStream;
        if (loadRunId !== loadRunIdReference.current) {
          tiddlersStream.removeAllListeners();
          tiddlersStream.destroy();
          return;
        }
        await injectHtmlAndTiddlersStore({ html: emptyHtml, tiddlersStream, setLoadHtmlError });
        if (loadRunId !== loadRunIdReference.current) return;
        await servicesOfWorkspace.current?.wikiHookService.executeAfterTwReady(`
          try {
            const inspectTitles = ['$:/SiteTitle', '$:/DefaultTiddlers', '$:/build'];
            const result = inspectTitles.map(title => {
              const tiddler = $tw.wiki.getTiddler(title);
              return {
                title,
                exists: !!tiddler,
                type: tiddler?.fields?.type,
                textPreview: typeof tiddler?.fields?.text === 'string' ? tiddler.fields.text.slice(0, 80) : undefined,
              };
            });
            console.log('${timestamp()} [useTiddlyWiki] post-boot system tiddler probe', JSON.stringify(result));
          } catch (error) {
            console.error('${timestamp()} [useTiddlyWiki] post-boot system tiddler probe failed', error);
          }
        `);
      } catch (error) {
        if (loadRunId !== loadRunIdReference.current) return;
        console.error(`[useTiddlyWiki] FATAL error:`, error, (error as Error).stack);
        setLoadHtmlError((error as Error).message);
      }
    })();
    // workspace and injectHtmlAndTiddlersStore reference may change multiple times, causing rerender
    return () => {
      if (loadRunIdReference.current === loadRunId) {
        loadRunIdReference.current += 1;
      }
      if (tiddlersStreamReference.current !== undefined) {
        tiddlersStreamReference.current.removeAllListeners();
        tiddlersStreamReference.current.destroy();
      }
    };
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

function resolveSubWikiPath(mainWikiFolderLocation: string, subWikiPath: string): string {
  if (subWikiPath.startsWith('file://')) {
    return subWikiPath;
  }
  const mainPlainPath = toPlainPath(mainWikiFolderLocation);
  const mainParentPath = mainPlainPath.slice(0, mainPlainPath.lastIndexOf('/'));
  const normalizedSubPath = subWikiPath.replace(/^\/+/, '');
  return `file://${mainParentPath}/${normalizedSubPath}`;
}

async function isWikiFolderAvailable(workspace: IWikiWorkspace): Promise<boolean> {
  const tiddlerFolderPath = getWikiTiddlerFolderPath(workspace);
  if (tiddlerFolderPath.includes('/storage/') || tiddlerFolderPath.includes('/sdcard/')) {
    const info = await ExternalStorage.getInfo(toPlainPath(tiddlerFolderPath));
    return info.exists && info.isDirectory;
  }
  const info = await FileSystemLegacy.getInfoAsync(tiddlerFolderPath);
  return info.exists && info.isDirectory;
}
