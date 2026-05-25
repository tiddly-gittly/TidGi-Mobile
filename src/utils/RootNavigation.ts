/**
 * @url https://reactnavigation.org/docs/navigating-without-navigation-prop/
 */
import { createNavigationContainerRef } from '@react-navigation/native';
import { RootStackParameterList } from '../App';
import { WikiWebViewProps } from '../pages/WikiWebView';

export const navigationReference = createNavigationContainerRef<RootStackParameterList>();

export function navigateIfNotAlreadyThere(screen: 'WikiWebView', parameters: WikiWebViewProps) {
  if (navigationReference.isReady()) {
    const currentRoute = navigationReference.getCurrentRoute();
    const currentRouteId = currentRoute?.name === screen ? currentRoute.params?.id : undefined;
    const isSameWikiWebViewTarget = currentRouteId === parameters.id;
    if (!isSameWikiWebViewTarget) {
      navigationReference.navigate(screen, parameters);
    }
  }
}
