/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/* eslint-disable @typescript-eslint/require-await */
import { MutableRefObject } from 'react';
import { WebView } from 'react-native-webview';
import { IWikiWorkspace } from '../../store/wiki';

/**
 * Provide some hook for wiki api.
 */
export class WikiHookService {
  #onReloadCallback: () => void = () => {};
  #workspace: IWikiWorkspace;
  #webViewReference?: MutableRefObject<WebView | null>;

  constructor(workspace: IWikiWorkspace) {
    this.#workspace = workspace;
  }

  public setLatestOnReloadCallback(onReloadCallback: () => void) {
    this.#onReloadCallback = onReloadCallback;
  }

  public setLatestWebViewReference(webViewReference: MutableRefObject<WebView | null>) {
    this.#webViewReference = webViewReference;
  }

  public async getLatestWebViewReference() {
    if (this.#webViewReference?.current) {
      return this.#webViewReference;
    } else {
      return await new Promise<MutableRefObject<WebView | null>>((resolve) => {
        const interval = setInterval(() => {
          if (this.#webViewReference?.current) {
            clearInterval(interval);
            resolve(this.#webViewReference);
          }
        }, 100);
      });
    }
  }

  public async executeAfterTwReady(script: string) {
    const webViewReference = await this.getLatestWebViewReference();
    webViewReference.current?.injectJavaScript(wrapScriptToWaitTwReady(script));
  }

  public async overrideOnReload() {
    console.log(`overrideOnReload: ${this.#workspace.name} (${this.#workspace.id})`);
    this.#onReloadCallback();
  }
}

export function replaceTiddlerStoreScriptToOverrideOnReload(tiddlerStoreScript: string): string {
  return tiddlerStoreScript.replaceAll('window.location.reload', 'window.service.wikiHookService.overrideOnReload');
}

export function wrapScriptToWaitTwReady(script: string): string {
  return `
  (function waitForTwReadyIntervalIIFE() {
    var check = () => '$tw' in window && window.$tw && window.$tw.rootWidget && $tw.wiki && $tw.wiki.makeWidget
    console.log(check())
    if (check()) {
      ${script}
    } else {
      var waitForTwReadyInterval = setInterval(() => {
        console.log('waitForTwReadyInterval', check())
        if (check()) {
          clearInterval(waitForTwReadyInterval);
          ${script}
        }
      }, 100);
    }
  })();`;
}
