import { ProxyPropertyType } from 'react-native-postmessage-cat';
import type { ProxyDescriptor } from 'react-native-postmessage-cat/common';

export enum NativeServiceChannel {
  name = 'native-service',
}
export const NativeServiceIPCDescriptor: ProxyDescriptor = {
  channel: NativeServiceChannel.name,
  properties: {
    saveFileToFs: ProxyPropertyType.Function,
  },
};
