import { StackScreenProps } from '@react-navigation/stack';
import React, { FC } from 'react';
import { styled } from 'styled-components/native';
import { RootStackParameterList } from '../../App';
import { Developer } from './Developer';
import { Performance } from './Performance';
import { ServerAndSync } from './ServerAndSync';
import { TiddlyWiki } from './TiddlyWiki';

const ConfigContainer = styled.ScrollView`
  padding: 20px;
  padding-bottom: 50px;
`;

export const Config: FC<StackScreenProps<RootStackParameterList, 'Config'>> = () => {
  return (
    <ConfigContainer>
      <Performance />
      <TiddlyWiki />
      <ServerAndSync />
      <Developer />
    </ConfigContainer>
  );
};
