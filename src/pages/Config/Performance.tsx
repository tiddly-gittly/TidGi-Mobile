import React from 'react';
import { useTranslation } from 'react-i18next';
import { Switch, Text } from 'react-native-paper';
import { useConfigStore } from '../../store/config';

export function Performance(): JSX.Element {
  const { t } = useTranslation();

  const [keepAliveInBackground, autoOpenDefaultWiki] = useConfigStore(state => [state.keepAliveInBackground, state.autoOpenDefaultWiki]);
  const setConfig = useConfigStore(state => state.set);

  return (
    <>
      <Text variant='titleLarge'>{t('Preference.KeepAliveInBackground')}</Text>
      <Text>{t('Preference.KeepAliveInBackgroundDescription')}</Text>
      <Switch
        value={keepAliveInBackground}
        onValueChange={(value) => {
          setConfig({ keepAliveInBackground: value });
        }}
      />
      <Text variant='titleLarge'>{t('Preference.AutoOpenDefaultWiki')}</Text>
      <Text variant='titleLarge'>{t('Preference.AutoOpenDefaultWikiDescription')}</Text>
      <Switch
        value={autoOpenDefaultWiki}
        onValueChange={(value) => {
          setConfig({ autoOpenDefaultWiki: value });
        }}
      />
    </>
  );
}
