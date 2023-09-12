import React from 'react';
import { useTranslation } from 'react-i18next';
import { SegmentedButtons, Text } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { useConfigStore } from '../../store/config';

export function General(): JSX.Element {
  const { t } = useTranslation();

  const theme = useConfigStore(state => state.theme ?? 'default');
  const setConfig = useConfigStore(state => state.set);
  const supportedThemes = [
    { label: t('Preference.SystemDefault'), value: 'default' as typeof theme },
    { label: t('Preference.LightTheme'), value: 'light' as typeof theme },
    { label: t('Preference.DarkTheme'), value: 'dark' as typeof theme },
  ];

  return (
    <>
      <Text variant='titleLarge'>{t('Preference.Theme')}</Text>
      <SegmentedContainer>
        <SegmentedButtons
          value={theme}
          onValueChange={(newValue) => {
            setConfig({ theme: newValue as typeof theme });
          }}
          buttons={supportedThemes}
        />
      </SegmentedContainer>
    </>
  );
}

const SegmentedContainer = styled.View`
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
`;
