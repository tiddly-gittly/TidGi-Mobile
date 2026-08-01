import { type DeviceCloudConnectionAdapter, DeviceCloudConnectionCoordinator, type DeviceCloudConnectionCoordinatorOptions } from 'memeloop/device-network';

export type MobileCloudConnectionAdapter<Configuration> = Omit<
  DeviceCloudConnectionAdapter<Configuration>,
  'relayRequiredForOnline'
>;

/** Mobile has no dependable inbound direct address, so relay is mandatory. */
export function createMobileCloudConnectionCoordinator<Configuration>(
  options: Omit<DeviceCloudConnectionCoordinatorOptions<Configuration>, 'adapter'> & {
    adapter: MobileCloudConnectionAdapter<Configuration>;
  },
): DeviceCloudConnectionCoordinator<Configuration> {
  return new DeviceCloudConnectionCoordinator({
    ...options,
    adapter: {
      ...options.adapter,
      relayRequiredForOnline: () => true,
    },
  });
}
