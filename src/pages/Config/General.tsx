import React from 'react';
import { useTranslation } from 'react-i18next';
import { SegmentedButtons, Switch, Text } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { useShallow } from 'zustand/react/shallow';
import { FlexibleText, SwitchContainer } from '../../components/PreferenceWidgets';
import { useConfigStore } from '../../store/config';

export function General(): JSX.Element {
  const { t } = useTranslation();

  const [translucentStatusBar, hideStatusBar] = useConfigStore(useShallow(state => [state.translucentStatusBar, state.hideStatusBar]));
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
      <Text variant='titleLarge'>{t('Preference.TranslucentStatusBar')}</Text>
      <SwitchContainer>
        <FlexibleText>{t('Preference.TranslucentStatusBarDescription')}</FlexibleText>
        <Switch
          value={translucentStatusBar}
          onValueChange={(value) => {
            setConfig({ translucentStatusBar: value });
          }}
        />
      </SwitchContainer>
      <Text variant='titleLarge'>{t('Preference.HideStatusBar')}</Text>
      <SwitchContainer>
        <FlexibleText>{t('Preference.HideStatusBarDescription')}</FlexibleText>
        <Switch
          value={hideStatusBar}
          onValueChange={(value) => {
            setConfig({ hideStatusBar: value });
          }}
        />
      </SwitchContainer>
    </>
  );
}

const SegmentedContainer = styled.View`
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
`;
