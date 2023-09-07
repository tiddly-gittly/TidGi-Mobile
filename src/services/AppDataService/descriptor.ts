import { ProxyPropertyType } from 'react-native-postmessage-cat';
import type { ProxyDescriptor } from 'react-native-postmessage-cat/common';

export enum AppDataServiceChannel {
  name = 'app-data-service',
}
export const AppDataServiceIPCDescriptor: ProxyDescriptor = {
  channel: AppDataServiceChannel.name,
  properties: {
    getServerState: ProxyPropertyType.Function,
    getConfigState: ProxyPropertyType.Function,
    getWikiState: ProxyPropertyType.Function,
    $getServerState: ProxyPropertyType.Function$,
    $getConfigState: ProxyPropertyType.Function$,
    $getWikiState: ProxyPropertyType.Function$,
  },
};
