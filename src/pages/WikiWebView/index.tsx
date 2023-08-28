import { StackScreenProps } from '@react-navigation/stack';
import React from 'react';
import { styled } from 'styled-components/native';
import { RootStackParameterList } from '../../App';
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
  return (
    <Container>
      <WikiViewer id={id} />
    </Container>
  );
};
