import { useIsFocused } from '@react-navigation/native';
import type { StackScreenProps } from '@react-navigation/stack';
import { FC, useState } from 'react';
import { Button } from 'react-native-paper';
import { styled } from 'styled-components/native';
import type { RootStackParameterList } from '../../App';
import { CreateWorkspaceButton } from '../../components/NavigationButtons';
import { WorkspaceList } from '../../components/WorkspaceList';
import { useAutoOpenDefaultWiki } from '../../hooks/useAutoOpenDefaultWiki';
import { useWorkspaceStore } from '../../store/workspace';

const Container = styled.View`
  flex: 1;
  background-color: ${({ theme }) => theme.colors.background};
  display: flex;
  flex-direction: column;
  justify-content: space-between;
`;
const ButtonButtonsContainer = styled.View`
  background-color: ${({ theme }) => theme.colors.background};
  display: flex;
  flex-direction: row;
  justify-content: space-around;
  padding-bottom: 24px;
`;

export interface MainMenuProps {
  fromWikiID?: string;
}

export const MainMenu: FC<StackScreenProps<RootStackParameterList, 'MainMenu'>> = ({ navigation }) => {
  const isFocused = useIsFocused();
  const allWorkspaces = useWorkspaceStore(state => state.workspaces);
  const workspaceIDSet = new Set(allWorkspaces.map(workspace => workspace.id));

  const [justReordered, setJustReordered] = useState(false);
  const preventAutoOpen = justReordered;
  useAutoOpenDefaultWiki(preventAutoOpen);

  return (
    <Container testID='main-menu-screen'>
      <WorkspaceList
        includeSubWikis={false}
        isFocused={isFocused}
        onPress={(wiki) => {
          if (wiki.type === 'wiki' && wiki.isSubWiki === true && typeof wiki.mainWikiID === 'string') {
            if (!workspaceIDSet.has(wiki.mainWikiID)) {
              navigation.navigate('WorkspaceDetail', { id: wiki.id });
              return;
            }
            navigation.navigate('WikiWebView', { id: wiki.mainWikiID });
            return;
          }
          navigation.navigate('WikiWebView', { id: wiki.id });
        }}
        onPressSettings={(wiki) => {
          if (wiki.type === 'wiki') {
            navigation.navigate('WorkspaceDetail', { id: wiki.id });
          } else if (wiki.type === 'webpage') {
            navigation.navigate('WebPageDetail', { id: wiki.id });
          }
        }}
        onReorderEnd={(workspaces) => {
          setJustReordered(true);
          useWorkspaceStore.setState({ workspaces });
        }}
      />
      <ButtonButtonsContainer>
        <Button
          icon='robot-outline'
          mode='outlined'
          onPress={() => {
            navigation.navigate('AgentChat');
          }}
        >
          Agent
        </Button>
        <CreateWorkspaceButton />
      </ButtonButtonsContainer>
    </Container>
  );
};
