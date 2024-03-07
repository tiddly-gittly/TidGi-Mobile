/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/* eslint-disable unicorn/no-null */
class TidGiMobileDownloadSaver {
  info = {
    name: 'tidgi-mobile-download',
    priority: 10_000,
    capabilities: ['download'],
  };

  save(text: string, method: 'download', callback: (none: null | Error) => void, options: { downloadType?: string; variables?: { filename?: string } }): boolean {
    if (window.service?.nativeService === undefined) {
      const error = new Error("TidGi-Mobile nativeService is undefined, can't save file.");
      callback(error);
      return false;
    }
    let filename = options.variables?.filename;
    if (!filename) {
      const p = document.location.pathname.lastIndexOf('/');
      if (p !== -1) {
        // We decode the pathname because document.location is URL encoded by the browser
        filename = $tw.utils.decodeURIComponentSafe(document.location.pathname.substr(p + 1));
      }
    }
    if (!filename) {
      filename = 'tiddlywiki.html';
    }
    void window.service.nativeService.saveFileToFs(filename, text, options.downloadType).then((result) => {
      if (result === false) {
        callback(new Error('Failed to save file'));
      } else {
        callback(null);
        $tw.notifier.display(result);
      }
    });
    return true;
  }
}

// eslint-disable-next-line no-var
interface IExports {
  canSave: (wiki: typeof $tw.wiki) => boolean;
  create: (wiki: typeof $tw.wiki) => TidGiMobileDownloadSaver;
}
(exports as IExports).canSave = function() {
  return true;
};

(exports as IExports).create = function() {
  return new TidGiMobileDownloadSaver();
};
