export function replaceTiddlerStoreScriptToTriggerFullReload(tiddlerStoreScript: string): string {
  return tiddlerStoreScript.replaceAll('window.location.reload', 'window.service.wikiHookService.triggerFullReload');
}
