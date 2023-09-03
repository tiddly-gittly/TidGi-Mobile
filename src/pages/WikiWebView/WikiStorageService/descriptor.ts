import { ProxyPropertyType } from 'react-native-postmessage-cat';
import type { ProxyDescriptor } from 'react-native-postmessage-cat/common';

export enum WikiStorageServiceChannel {
  name = 'wiki-storage',
}
export const WikiStorageServiceIPCDescriptor: ProxyDescriptor = {
  channel: WikiStorageServiceChannel.name,
  properties: {
    save: ProxyPropertyType.Function,
  },
};
