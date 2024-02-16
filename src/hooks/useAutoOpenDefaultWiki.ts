/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import { useNavigation, useRoute } from '@react-navigation/native';
import type { StackScreenProps } from '@react-navigation/stack';
import { compact } from 'lodash';
import { useEffect, useState } from 'react';
import type { RootStackParameterList } from '../App';
import { useConfigStore } from '../store/config';
import { IWikiWorkspace, useWorkspaceStore } from '../store/workspace';
import { navigateIfNotAlreadyThere } from '../utils/RootNavigation';

/**
 * Can only be used in MainMenu
 */
export function useAutoOpenDefaultWiki(preventOpen?: boolean) {
  const autoOpenDefaultWiki = useConfigStore(state => state.autoOpenDefaultWiki);
  const navigation = useNavigation<StackScreenProps<RootStackParameterList, 'MainMenu'>['navigation']>();
  const route = useRoute<StackScreenProps<RootStackParameterList, 'MainMenu'>['route']>();
  const wikis = useWorkspaceStore(state => compact(state.workspaces).filter((w): w is IWikiWorkspace => w.type === 'wiki'));
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
      openDefaultWikiIfNotAlreadyThere(wikis);
    }
  }, [navigation, wikis, fromWikiID, route.name, autoOpenDefaultWiki, hadPreventOpen]);
}

/**
 * @param wikis Be aware that this is loaded using asyncStorage, so it maybe empty or not loaded yet.
 */
export function openDefaultWikiIfNotAlreadyThere(workspaces = useWorkspaceStore.getState().workspaces) {
  const defaultWiki = workspaces.find((w): w is IWikiWorkspace => w.type === 'wiki');
  console.log(`openDefaultWiki ${defaultWiki?.id ?? 'undefined'}`);
  if (defaultWiki !== undefined) {
    navigateIfNotAlreadyThere('WikiWebView', { id: defaultWiki.id, quickLoad: defaultWiki.enableQuickLoad });
  }
}
