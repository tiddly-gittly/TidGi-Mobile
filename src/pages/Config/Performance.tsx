import React from 'react';
import { useTranslation } from 'react-i18next';
import { Switch, Text } from 'react-native-paper';
import { FlexibleText, SwitchContainer } from '../../components/PreferenceWidgets';
import { useConfigStore } from '../../store/config';

export function Performance(): JSX.Element {
  const { t } = useTranslation();

  const [keepAliveInBackground, autoOpenDefaultWiki] = useConfigStore(state => [state.keepAliveInBackground, state.autoOpenDefaultWiki]);
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
    </>
  );
}
