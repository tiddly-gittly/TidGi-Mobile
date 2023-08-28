import { StackScreenProps } from '@react-navigation/stack';
import React from 'react';
import { styled } from 'styled-components/native';
import { RootStackParameterList } from '../../App';
import { useWikiStore } from '../../store/wiki';
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
  const activeWikiWorkspace = useWikiStore(state => state.wikis.find(wiki => wiki.id === id));

  return (
    <Container>
      {(activeWikiWorkspace !== undefined) && <WikiViewer wikiWorkspace={activeWikiWorkspace} />}
    </Container>
  );
};
