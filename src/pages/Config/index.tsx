import { StackScreenProps } from '@react-navigation/stack';
import React, { FC } from 'react';
import { styled } from 'styled-components/native';
import { RootStackParameterList } from '../../App';
import { Developer } from './Developer';
import { Performance } from './Performance';
import { TiddlyWiki } from './TiddlyWiki';

const ConfigContainer = styled.View`
  flex: 1;
  padding: 20px;
`;

export const Config: FC<StackScreenProps<RootStackParameterList, 'Config'>> = () => {
  return (
    <ConfigContainer>
      <Performance />
      <TiddlyWiki />
      <Developer />
    </ConfigContainer>
  );
};
