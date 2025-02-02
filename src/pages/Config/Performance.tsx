import React from 'react';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';
import { Switch, Text } from 'react-native-paper';
import { useShallow } from 'zustand/react/shallow';
import { FlexibleText, SwitchContainer } from '../../components/PreferenceWidgets';
import { useConfigStore } from '../../store/config';

export function Performance(): JSX.Element {
  const { t } = useTranslation();

  const [keepAliveInBackground, autoOpenDefaultWiki, androidHardwareAcceleration] = useConfigStore(
    useShallow(state => [state.keepAliveInBackground, state.autoOpenDefaultWiki, state.androidHardwareAcceleration]),
  );
  const setConfig = useConfigStore(state => state.set);

  return (
    <>
      <Text variant='titleLarge'>{t('Preference.KeepAliveInBackground')}</Text>
      <SwitchContainer>
        <FlexibleText>{t('Preference.KeepAliveInBackgroundDescription')}</FlexibleText>
        <Switch
          value={keepAliveInBackground}
          onValueChange={(value) => {
            setConfig({ keepAliveInBackground: value });
          }}
        />
      </SwitchContainer>
      <Text variant='titleLarge'>{t('Preference.AutoOpenDefaultWiki')}</Text>
      <SwitchContainer>
        <FlexibleText>{t('Preference.AutoOpenDefaultWikiDescription')}</FlexibleText>
        <Switch
          value={autoOpenDefaultWiki}
          onValueChange={(value) => {
            setConfig({ autoOpenDefaultWiki: value });
          }}
        />
      </SwitchContainer>
      {Platform.OS === 'android' && (
        <>
          <Text variant='titleLarge'>{t('Preference.AndroidHardwareAcceleration')}</Text>
          <SwitchContainer>
            <FlexibleText>{t('Preference.AndroidHardwareAccelerationDescription')}</FlexibleText>
            <Switch
              value={androidHardwareAcceleration}
              onValueChange={(value) => {
                setConfig({ androidHardwareAcceleration: value });
              }}
            />
          </SwitchContainer>
        </>
      )}
    </>
  );
}
