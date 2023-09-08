import { useMemo } from 'react';
import { useRegisterProxy } from 'react-native-postmessage-cat';
import { IWikiWorkspace } from '../../store/wiki';
import { WikiHookService } from '.';
import { WikiHookServiceIPCDescriptor } from './descriptor';

export function useWikiHookService(workspace: IWikiWorkspace) {
  const wikiHookService = useMemo(() => new WikiHookService(workspace), [workspace]);
  const [webViewReference, onMessageReference] = useRegisterProxy(wikiHookService, WikiHookServiceIPCDescriptor);
  return [webViewReference, onMessageReference, wikiHookService] as const;
}
