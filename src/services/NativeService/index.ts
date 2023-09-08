import { Camera } from 'expo-camera';
import * as Location from 'expo-location';
import ReceiveSharingIntent from 'react-native-receive-sharing-intent';

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

  registerReceivingShareIntent() {
    // To get All Recived Urls
    ReceiveSharingIntent.getReceivedFiles(
      (
        files: Array<{
          contentUri: null | string;
          extension: null | string;
          fileName: null | string;
          filePath: null | string;
          mimeType: null | string;
          text: null | string;
          weblink: null | string;
        }>,
      ) => {
        // files returns as JSON Array example
        // [{ filePath: null, text: null, weblink: null, mimeType: null, contentUri: null, fileName: null, extension: null }]
        console.log(files);
      },
      (error: Error) => {
        console.log(error);
      },
      'fun.tidgi.mobile', // share url protocol (must be unique to your app, suggest using your apple bundle id)
    );

    // To clear Intents
    ReceiveSharingIntent.clearReceivedFiles();
  }
}

/**
 * Only need a singleton instance for all wikis.
 */
export const nativeService = new NativeService();
