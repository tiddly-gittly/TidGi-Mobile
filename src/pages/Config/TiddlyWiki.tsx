import useDebouncedCallback from 'beautiful-react-hooks/useDebouncedCallback';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Text, TextInput } from 'react-native';
import { useConfigStore } from './useConfig';

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
      <Text>{t('Preference.TiddlyWiki')}</Text>
      <Text>{t('Preference.DefaultUserName')}</Text>
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
