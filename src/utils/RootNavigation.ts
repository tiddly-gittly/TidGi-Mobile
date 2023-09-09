/**
 * @url https://reactnavigation.org/docs/navigating-without-navigation-prop/
 */
import { createNavigationContainerRef } from '@react-navigation/native';
import { RootStackParameterList } from '../App';
import { WikiWebViewProps } from '../pages/WikiWebView';

export const navigationReference = createNavigationContainerRef<RootStackParameterList>();

export function navigateIfNotAlreadyThere(screen: 'WikiWebView', parameters: WikiWebViewProps) {
  if (navigationReference.isReady()) {
    const currentRouteName = navigationReference.getCurrentRoute()?.name;
    if (currentRouteName !== screen) {
      navigationReference.navigate(screen, parameters);
    }
  }
}
