import { Camera } from 'expo-camera';
import * as Location from 'expo-location';

/**
 * Service for using native ability like Location based Geofencing in the wiki todo system.
 */
export class NativeService {
  async getLocationWithTimeout(timeout = 1000): Promise<Location.LocationObjectCoords | undefined> {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      return;
    }

    try {
      const timeoutPromise = new Promise<Location.LocationObject['coords'] | undefined>((resolve) => {
        setTimeout(() => {
          resolve(undefined);
        }, timeout); // resolve as undefined after 1 second
      });

      // this usually last for a very long time. So we use a timeout to prevent it from blocking the app
      const locationPromise = (async () => {
        const location = (await Location.getLastKnownPositionAsync()) ?? await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Lowest,
        });
        return location.coords;
      })();

      return await Promise.race([timeoutPromise, locationPromise]);
    } catch (error) {
      console.error('Error fetching location:', error);
      return undefined;
    }
  }

  async requestCameraPermission(): Promise<boolean> {
    const { status } = await Camera.requestCameraPermissionsAsync();
    return status === 'granted';
  }

  async requestMicrophonePermission(): Promise<boolean> {
    const { status } = await Camera.requestMicrophonePermissionsAsync();
    return status === 'granted';
  }
}

/**
 * Only need a singleton instance for all wikis.
 */
export const nativeService = new NativeService();
