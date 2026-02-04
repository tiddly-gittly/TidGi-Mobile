import { MutableRefObject, useEffect, useRef } from 'react';
import { IWikiWorkspace } from '../../store/workspace';
import { gitBackgroundSyncService } from './index';

/**
 * Hook for using background sync service in WebView
 */
export function useBackgroundSyncService() {
  const serviceReference: MutableRefObject<typeof gitBackgroundSyncService | undefined> = useRef();

  useEffect(() => {
    serviceReference.current = gitBackgroundSyncService;
  }, []);

  const onMessageReference = useRef(() => {
    // Handle messages from WebView if needed
  });

  return [serviceReference, onMessageReference] as const;
}
