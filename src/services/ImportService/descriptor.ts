import { ProxyPropertyType } from 'react-native-postmessage-cat';
import type { ProxyDescriptor } from 'react-native-postmessage-cat/common';

export enum ImportServiceChannel {
  name = 'import-service',
}
export const ImportServiceIPCDescriptor: ProxyDescriptor = {
  channel: ImportServiceChannel.name,
  properties: {
    storeTiddlersToSQLite: ProxyPropertyType.Function,
  },
};
