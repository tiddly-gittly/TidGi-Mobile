const setup = () => {
  if (typeof window === 'undefined') {
    setTimeout(() => {
      console.error('window is not defined in monitorLocationChange, retry in 1s.');
      setup();
    }, 1000);
    return;
  }
  window.addEventListener('hashchange', () => {
    const lastLocationHash = location.hash;
    window.service?.wikiHookService?.saveLocationInfo(lastLocationHash);
  });
};

/* eslint-disable @typescript-eslint/no-unsafe-member-access */
exports.startup = setup;
