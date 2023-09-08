import { ProxyPropertyType } from 'react-native-postmessage-cat';
import type { ProxyDescriptor } from 'react-native-postmessage-cat/common';

export enum WikiHookServiceChannel {
  name = 'wiki-hook-service',
}
export const WikiHookServiceIPCDescriptor: ProxyDescriptor = {
  channel: WikiHookServiceChannel.name,
  properties: {
    overrideOnReload: ProxyPropertyType.Function,
  },
};
