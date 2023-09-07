import { ProxyPropertyType } from 'react-native-postmessage-cat';
import type { ProxyDescriptor } from 'react-native-postmessage-cat/common';

export enum BackgroundSyncServiceChannel {
  name = 'background-sync',
}
export const BackgroundSyncServiceIPCDescriptor: ProxyDescriptor = {
  channel: BackgroundSyncServiceChannel.name,
  properties: {
    sync: ProxyPropertyType.Function,
    updateServerOnlineStatus: ProxyPropertyType.Function,
    getChangeLogsSinceLastSync: ProxyPropertyType.Function,
    syncWikiWithServer: ProxyPropertyType.Function,
  },
};
