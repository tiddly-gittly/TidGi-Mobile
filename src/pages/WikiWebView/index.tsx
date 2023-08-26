import React from 'react';
import { styled } from 'styled-components/native';
import { Sidebar } from '../../components/Sidebar';
import { WikiViewer } from './WikiViewer';

const Container = styled.View`
  flex-direction: row;
`;

export const WikiWebView: React.FC = () => {
  return (
    <Container>
      <Sidebar />
      <WikiViewer />
    </Container>
  );
};
