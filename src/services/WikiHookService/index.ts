/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/* eslint-disable @typescript-eslint/require-await */
import { backOff } from 'exponential-backoff';
import { MutableRefObject } from 'react';
import { WebView } from 'react-native-webview';
import { IWikiWorkspace, useWorkspaceStore } from '../../store/workspace';

/**
 * Provide some hook for wiki api.
 */
export class WikiHookService {
  #triggerFullReloadCallback: () => void = () => {};
  /** value in this maybe outdated, use #wikiStore for latest data. */
  readonly #workspace: IWikiWorkspace;
  #webViewReference?: MutableRefObject<WebView | null>;
  readonly #wikiStore = useWorkspaceStore;

  constructor(workspace: IWikiWorkspace) {
    this.#workspace = workspace;
  }

  public setLatestTriggerFullReloadCallback(triggerFullReloadCallback: () => void) {
    this.#triggerFullReloadCallback = triggerFullReloadCallback;
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

  public async triggerFullReload() {
    console.info(`triggerFullReload: ${this.#workspace.name} (${this.#workspace.id})`);
    this.#triggerFullReloadCallback();
  }

  public saveLocationInfo(hash: string) {
    this.#wikiStore.getState().update(this.#workspace.id, { lastLocationHash: hash });
  }

  #webViewReceiverReady = false;
  public setWebviewReceiverReady() {
    this.#webViewReceiverReady = true;
  }

  public resetWebviewReceiverReady() {
    this.#webViewReceiverReady = false;
  }

  public async waitForWebviewReceiverReady(tryGetReady: () => void): Promise<void> {
    await backOff(
      async () => {
        console.log(`backoff retry waitForWebviewReceiverReady`);
        if (this.#webViewReceiverReady) {
          return true;
        } else {
          tryGetReady();
          throw new Error('Webview receiver not ready');
        }
      },
      { numOfAttempts: 100, jitter: 'full' },
    );
  }
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
