import { ProxyPropertyType } from 'react-native-postmessage-cat';
import type { ProxyDescriptor } from 'react-native-postmessage-cat/common';

export enum WikiStorageServiceChannel {
  name = 'wiki-storage',
}
export const WikiStorageServiceIPCDescriptor: ProxyDescriptor = {
  channel: WikiStorageServiceChannel.name,
  properties: {
    deleteTiddler: ProxyPropertyType.Function,
    getSkinnyTiddlers: ProxyPropertyType.Function,
    getStatus: ProxyPropertyType.Function,
    getWikiChangeObserver$: ProxyPropertyType.Function$,
    loadTiddlerText: ProxyPropertyType.Function,
    saveTiddler: ProxyPropertyType.Function,
  },
};
