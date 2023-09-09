const setup = () => {
  window.addEventListener('hashchange', () => {
    const lastLocationHash = location.hash;
    window.service?.wikiHookService?.saveLocationInfo(lastLocationHash);
  });
};

// eslint-disable-next-line no-var
declare var exports: {
  startup: typeof setup;
};
exports.startup = setup;
