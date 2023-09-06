import { useNavigation, useRoute } from '@react-navigation/native';
import type { StackScreenProps } from '@react-navigation/stack';
import { useEffect } from 'react';
import type { RootStackParameterList } from '../App';
import { useConfigStore } from '../store/config';
import { useWikiStore } from '../store/wiki';

/**
 * Can only be used in MainMenu
 */
export function useAutoOpenDefaultWiki() {
  const autoOpenDefaultWiki = useConfigStore(state => state.autoOpenDefaultWiki);
  const navigation = useNavigation<StackScreenProps<RootStackParameterList, 'MainMenu'>['navigation']>();
  const route = useRoute<StackScreenProps<RootStackParameterList, 'MainMenu'>['route']>();
  const wikis = useWikiStore(state => state.wikis);
  const { fromWikiID } = route.params ?? {};

  useEffect(() => {
    if (!autoOpenDefaultWiki) return;
    const defaultWiki = wikis[0];
    const currentScreen = navigation.getState()?.routes.at(-1)?.name;
    if (defaultWiki !== undefined && fromWikiID === undefined && currentScreen === 'MainMenu') {
      navigation.navigate('WikiWebView', { id: defaultWiki.id });
    }
  }, [navigation, wikis, fromWikiID, route.name, autoOpenDefaultWiki]);
}
