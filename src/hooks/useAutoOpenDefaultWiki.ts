/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import { useNavigation, useRoute } from '@react-navigation/native';
import type { StackScreenProps } from '@react-navigation/stack';
import { compact } from 'lodash';
import { useEffect, useState } from 'react';
import type { RootStackParameterList } from '../App';
import { useConfigStore } from '../store/config';
import { IWikiWorkspace, useWorkspaceStore, WikiState } from '../store/workspace';
import { navigateIfNotAlreadyThere } from '../utils/RootNavigation';

/**
 * Can only be used in MainMenu
 */
export function useAutoOpenDefaultWiki(preventOpen?: boolean) {
  const autoOpenDefaultWiki = useConfigStore(state => state.autoOpenDefaultWiki);
  const navigation = useNavigation<StackScreenProps<RootStackParameterList, 'MainMenu'>['navigation']>();
  const route = useRoute<StackScreenProps<RootStackParameterList, 'MainMenu'>['route']>();
  /** If we are just go back from a wiki, don't immediately goto default wiki. */
  const { fromWikiID } = route.params ?? {};

  // once model opened, we need to prevent closing model trigger the auto open
  const [hadPreventOpen, setHadPreventOpen] = useState(preventOpen);
  useEffect(() => {
    if (preventOpen === true) {
      setHadPreventOpen(true);
    }
  }, [preventOpen]);

  useEffect(() => {
    if (hadPreventOpen) return;
    if (!autoOpenDefaultWiki) return;
    const currentScreen = navigation.getState()?.routes.at(-1)?.name;
    if (fromWikiID === undefined && currentScreen === 'MainMenu') {
      openDefaultWikiIfNotAlreadyThere();
    }
  }, [navigation, fromWikiID, route.name, autoOpenDefaultWiki, hadPreventOpen]);
}

export function openDefaultWikiIfNotAlreadyThere() {
  /**
   * Be aware that this is loaded using asyncStorage, so it maybe empty or not loaded yet.
   */
  const defaultWiki = compact(useWorkspaceStore.getState().workspaces).find((w): w is IWikiWorkspace => w.type === 'wiki');
  console.log(`openDefaultWiki ${defaultWiki?.id ?? 'undefined'}`);
  if (defaultWiki === undefined) {
    const unsubscribe = useWorkspaceStore.subscribe(onStoreLoaded);
    setTimeout(unsubscribe, 1000);
    // wait for 1s for asyncStorage to load
    // eslint-disable-next-line no-inner-declarations
    function onStoreLoaded(state: WikiState, previousState: WikiState) {
      if (previousState.workspaces.length !== state.workspaces.length) {
        openDefaultWikiIfNotAlreadyThere();
        unsubscribe();
      }
    }
  } else {
    navigateIfNotAlreadyThere('WikiWebView', { id: defaultWiki.id, quickLoad: defaultWiki.enableQuickLoad });
  }
}
