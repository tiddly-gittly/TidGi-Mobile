const setup = () => {
  window.addEventListener('hashchange', () => {
    const lastLocationHash = location.hash;
    window.service?.wikiHookService?.saveLocationInfo(lastLocationHash);
  });
};

/* eslint-disable @typescript-eslint/no-unsafe-member-access */
exports.startup = setup;
