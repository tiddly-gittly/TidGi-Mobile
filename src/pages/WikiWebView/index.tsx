import { StackScreenProps } from '@react-navigation/stack';
import React from 'react';
import { styled } from 'styled-components/native';
import { RootStackParameterList } from '../../App';
import { useCloseSQLite } from '../../services/SQLiteService/hooks';
import { useWorkspaceStore } from '../../store/workspace';
import { WikiViewer } from './WikiViewer';

const Container = styled.View`
  height: 100%;
  display: flex;
  flex-direction: row;
`;

export interface WikiWebViewProps {
  id?: string;
}
export const WikiWebView: React.FC<StackScreenProps<RootStackParameterList, 'WikiWebView'>> = ({ route }) => {
  const { id } = route.params;
  const activeWikiWorkspace = useWorkspaceStore(state => state.workspaces.find(wiki => wiki.id === id));
  useCloseSQLite(activeWikiWorkspace);

  return (
    <Container>
      {(activeWikiWorkspace !== undefined) && <WikiViewer wikiWorkspace={activeWikiWorkspace} />}
    </Container>
  );
};
