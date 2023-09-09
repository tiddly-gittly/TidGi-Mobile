import useDebouncedCallback from 'beautiful-react-hooks/useDebouncedCallback';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Switch, Text, TextInput } from 'react-native-paper';
import { FlexibleText, SwitchContainer } from '../../components/PreferenceWidgets';
import { useConfigStore } from '../../store/config';

export function TiddlyWiki(): JSX.Element {
  const { t } = useTranslation();

  const [initialUserName, rememberLastVisitState] = useConfigStore(state => [state.userName, state.rememberLastVisitState]);
  const [userName, userNameSetter] = useState(initialUserName);
  const setConfig = useConfigStore(state => state.set);

  const userNameTextFieldOnChange = useDebouncedCallback((newText: string) => {
    setConfig({ userName: newText });
  }, []);
  return (
    <>
      <Text variant='titleLarge'>{t('Preference.DefaultUserName')}</Text>
      <Text>{t('Preference.DefaultUserNameDetail')}</Text>
      <TextInput
        value={userName}
        onChangeText={(newText: string) => {
          userNameSetter(newText);
          userNameTextFieldOnChange(newText);
        }}
      />
      <SwitchContainer>
        <FlexibleText>{t('Preference.RememberLastVisitState')}</FlexibleText>
        <Switch
          value={rememberLastVisitState}
          onValueChange={(value) => {
            setConfig({ rememberLastVisitState: value });
          }}
        />
      </SwitchContainer>
    </>
  );
}
