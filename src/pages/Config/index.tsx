/* eslint-disable react-native/no-inline-styles */
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
  padding-top: 0px;
  flex: 1;
`;

export const Config: FC<StackScreenProps<RootStackParameterList, 'Config'>> = () => {
  return (
    <ConfigContainer contentContainerStyle={{ flexGrow: 1 }}>
      <Performance />
      <TiddlyWiki />
      <ServerAndSync />
      <Developer />
    </ConfigContainer>
  );
};
