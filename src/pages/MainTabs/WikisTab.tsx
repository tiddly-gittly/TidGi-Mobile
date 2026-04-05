/**
 * Wikis tab — wraps the existing MainMenu content (workspace list + add button).
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { StackNavigationProp } from '@react-navigation/stack';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useColorScheme } from 'react-native';
import { Appbar } from 'react-native-paper';
import { styled, useTheme } from 'styled-components/native';
import type { RootStackParameterList } from '../../App';
import { CreateWorkspaceButton } from '../../components/NavigationButtons';
import { WorkspaceList } from '../../components/WorkspaceList';
import { useAutoOpenDefaultWiki } from '../../hooks/useAutoOpenDefaultWiki';
import { useWorkspaceStore } from '../../store/workspace';

const Container = styled.View`
  flex: 1;
  background-color: ${({ theme }) => theme.colors.background};
`;

const BottomButtons = styled.View`
  background-color: ${({ theme }) => theme.colors.background};
  display: flex;
  flex-direction: row;
  justify-content: space-around;
`;

interface WikisTabProps {
  rootNavigation: StackNavigationProp<RootStackParameterList>;
}

export function WikisTab({ rootNavigation }: WikisTabProps): React.JSX.Element {
  const { t } = useTranslation();
  const theme = useTheme();
  const allWorkspaces = useWorkspaceStore(state => state.workspaces);
  const workspaceIDSet = new Set(allWorkspaces.map(w => w.id));
  const [justReordered, setJustReordered] = useState(false);
  useAutoOpenDefaultWiki(justReordered);

  return (
    <Container>
      <Appbar.Header>
        <Appbar.Content title={t('Navigation.Wikis')} titleStyle={{ color: theme.colors.primary }} />
      </Appbar.Header>
      <WorkspaceList
        includeSubWikis={false}
        isFocused={true}
        onPress={(wiki) => {
          if (wiki.type === 'wiki' && wiki.isSubWiki === true && typeof wiki.mainWikiID === 'string') {
            if (!workspaceIDSet.has(wiki.mainWikiID)) {
              rootNavigation.navigate('WorkspaceDetail', { id: wiki.id });
              return;
            }
            rootNavigation.navigate('WikiWebView', { id: wiki.mainWikiID });
            return;
          }
          rootNavigation.navigate('WikiWebView', { id: wiki.id });
        }}
        onPressSettings={(wiki) => {
          if (wiki.type === 'wiki') {
            rootNavigation.navigate('WorkspaceDetail', { id: wiki.id });
          }
        }}
        onReorderEnd={() => {
          setJustReordered(true);
        }}
      />
      <BottomButtons>
        <CreateWorkspaceButton />
      </BottomButtons>
    </Container>
  );
}
