/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import { Asset } from 'expo-asset';
import * as fs from 'expo-file-system';
import streamChunksPreloadScriptAssetID from '../../../../assets/preload/streamChunksPreloadScript.js.html';

export enum OnStreamChunksToWebViewEventTypes {
  TIDDLER_SKINNY_STORE_SCRIPT_CHUNK = 'TIDDLER_SKINNY_STORE_SCRIPT_CHUNK',
  TIDDLER_SKINNY_STORE_SCRIPT_CHUNK_END = 'TIDDLER_SKINNY_STORE_SCRIPT_CHUNK_END',
  TIDDLER_STORE_SCRIPT_CHUNK = 'TIDDLER_STORE_SCRIPT_CHUNK',
  TIDDLER_STORE_SCRIPT_CHUNK_END = 'TIDDLER_STORE_SCRIPT_CHUNK_END',
  TIDDLYWIKI_HTML = 'TIDDLYWIKI_HTML',
}
type OnStreamChunksToWebViewEvents = {
  data: string;
  type:
    | OnStreamChunksToWebViewEventTypes.TIDDLYWIKI_HTML
    | OnStreamChunksToWebViewEventTypes.TIDDLER_STORE_SCRIPT_CHUNK
    | OnStreamChunksToWebViewEventTypes.TIDDLER_SKINNY_STORE_SCRIPT_CHUNK;
} | {
  type: OnStreamChunksToWebViewEventTypes.TIDDLER_SKINNY_STORE_SCRIPT_CHUNK_END | OnStreamChunksToWebViewEventTypes.TIDDLER_STORE_SCRIPT_CHUNK_END;
};
declare global {
  interface Window {
    onStreamChunksToWebView: (event: OnStreamChunksToWebViewEvents) => void;
  }
}

export const getWebviewSideReceiver = async () => {
  const [asset] = await Asset.loadAsync([streamChunksPreloadScriptAssetID]);
  const streamChunksPreloadScriptFileUri = asset?.localUri;
  if (!streamChunksPreloadScriptFileUri) {
    throw new Error(`streamChunksPreloadScript failed to load, ID: ${streamChunksPreloadScriptAssetID}`);
  }
  const webviewSideReceiver = await fs.readAsStringAsync(streamChunksPreloadScriptFileUri);
  return webviewSideReceiver;
};
