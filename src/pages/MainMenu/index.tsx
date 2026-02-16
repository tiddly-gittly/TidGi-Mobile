import { useIsFocused } from '@react-navigation/native';
import type { StackScreenProps } from '@react-navigation/stack';
import { FC, useState } from 'react';
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
`;

export interface MainMenuProps {
  fromWikiID?: string;
}

export const MainMenu: FC<StackScreenProps<RootStackParameterList, 'MainMenu'>> = ({ navigation }) => {
  const isFocused = useIsFocused();

  const [justReordered, setJustReordered] = useState(false);
  const preventAutoOpen = justReordered;
  useAutoOpenDefaultWiki(preventAutoOpen);

  return (
    <Container>
      <WorkspaceList
        includeSubWikis={false}
        isFocused={isFocused}
        onPress={(wiki) => {
          if (wiki.type === 'wiki' && wiki.isSubWiki === true && typeof wiki.mainWikiID === 'string') {
            navigation.navigate('WikiWebView', { id: wiki.mainWikiID });
            return;
          }
          navigation.navigate('WikiWebView', { id: wiki.id });
        }}
        onPressQuickLoad={(wiki) => {
          if (wiki.type === 'wiki' && wiki.isSubWiki === true && typeof wiki.mainWikiID === 'string') {
            navigation.navigate('WikiWebView', { id: wiki.mainWikiID, quickLoad: true });
            return;
          }
          navigation.navigate('WikiWebView', { id: wiki.id, quickLoad: true });
        }}
        onPressSettings={(wiki) => {
          if (wiki.type === 'wiki') {
            navigation.navigate('WorkspaceDetail', { id: wiki.id });
          }
        }}
        onReorderEnd={(workspaces) => {
          setJustReordered(true);
          useWorkspaceStore.setState({ workspaces });
        }}
      />
      <ButtonButtonsContainer>
        <CreateWorkspaceButton />
      </ButtonButtonsContainer>
    </Container>
  );
};
