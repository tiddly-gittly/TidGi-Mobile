/* eslint-disable @typescript-eslint/no-unsafe-member-access */
exports.startup = () => {
  $tw.rootWidget.addEventListener('tm-browser-refresh', function() {
    // TODO: remove old listener first if https://github.com/Jermolene/TiddlyWiki5/issues/7192 is fixed.
    void window?.service?.wikiHookService?.triggerFullReload?.();
  });
};
exports.name = 'fixBrowserAPI';
exports.after = ['story'];
exports.synchronous = true;
