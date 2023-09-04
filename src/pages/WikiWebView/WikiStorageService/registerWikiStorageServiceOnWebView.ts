import { WikiStorageServiceIPCDescriptor } from './descriptor';

export const registerWikiStorageServiceOnWebView = `
var wikiStorageService = window.PostMessageCat(${JSON.stringify(WikiStorageServiceIPCDescriptor)});
window.service = window.service || {};
window.service.wikiStorageService = wikiStorageService;
`;
