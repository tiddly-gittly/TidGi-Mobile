import { StackScreenProps } from '@react-navigation/stack';
import React, { FC } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from 'react-native';
import { styled } from 'styled-components/native';
import { RootStackParameterList } from '../../App';
import { Performance } from './Performance';
import { TiddlyWiki } from './TiddlyWiki';
import { useOpenDirectory } from './useOpenDirectory';

const ConfigContainer = styled.View`
  flex: 1;
  padding: 20px;
`;

export const Config: FC<StackScreenProps<RootStackParameterList, 'Config'>> = () => {
  const { t } = useTranslation();

  const { isOpeningDirectory, openDocumentDirectory } = useOpenDirectory();

  return (
    <ConfigContainer>
      <Performance />
      <TiddlyWiki />
      <Button
        title={t('Preference.OpenWikisFolder')}
        onPress={openDocumentDirectory}
        disabled={isOpeningDirectory}
      />
    </ConfigContainer>
  );
};
