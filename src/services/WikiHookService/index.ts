/* eslint-disable @typescript-eslint/require-await */
import { IWikiWorkspace } from '../../store/wiki';

/**
 * Provide some hook for wiki api.
 */
export class WikiHookService {
  #onReloadCallback: () => void = () => {};
  #workspace: IWikiWorkspace;

  constructor(workspace: IWikiWorkspace) {
    this.#workspace = workspace;
  }

  public setLatestOnReloadCallback(onReloadCallback: () => void) {
    this.#onReloadCallback = onReloadCallback;
  }

  public async overrideOnReload() {
    console.log(`overrideOnReload: ${this.#workspace.name} (${this.#workspace.id})`);
    this.#onReloadCallback();
  }
}

export function replaceTiddlerStoreScriptToOverrideOnReload(tiddlerStoreScript: string): string {
  return tiddlerStoreScript.replaceAll('window.location.reload', 'window.service.wikiHookService.overrideOnReload');
}
