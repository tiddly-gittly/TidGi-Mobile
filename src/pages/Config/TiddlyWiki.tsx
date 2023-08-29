import useDebouncedCallback from 'beautiful-react-hooks/useDebouncedCallback';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Text, TextInput } from 'react-native-paper';
import { useConfigStore } from '../../store/config';

export function TiddlyWiki(): JSX.Element {
  const { t } = useTranslation();

  const initialUserName = useConfigStore(state => state.userName);
  const [userName, userNameSetter] = useState(initialUserName);
  const setConfig = useConfigStore(state => state.set);

  const userNameTextFieldOnChange = useDebouncedCallback((newText: string) => {
    setConfig({ userName: newText });
  }, []);
  return (
    <>
      <Text variant='headlineLarge'>{t('Preference.TiddlyWiki')}</Text>
      <Text variant='titleLarge'>{t('Preference.DefaultUserName')}</Text>
      <Text>{t('Preference.DefaultUserNameDetail')}</Text>
      <TextInput
        value={userName}
        onChangeText={(newText: string) => {
          userNameSetter(newText);
          userNameTextFieldOnChange(newText);
        }}
      />
    </>
  );
}
