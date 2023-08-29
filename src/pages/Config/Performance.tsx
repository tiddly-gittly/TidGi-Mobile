import React from 'react';
import { useTranslation } from 'react-i18next';
import { Switch, Text } from 'react-native-paper';
import { useConfigStore } from '../../store/config';

export function Performance(): JSX.Element {
  const { t } = useTranslation();

  const runInBackground = useConfigStore(state => state.runInBackground);
  const setConfig = useConfigStore(state => state.set);

  return (
    <>
      <Text variant='headlineLarge'>{t('Preference.Performance')}</Text>
      <Text variant='titleLarge'>{t('Preference.RunInBackground')}</Text>
      <Text>{t('Preference.RunInBackgroundDescription')}</Text>
      <Switch
        value={runInBackground}
        onValueChange={(value) => {
          setConfig({ runInBackground: value });
        }}
      />
    </>
  );
}
