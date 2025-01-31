import useDebouncedCallback from 'beautiful-react-hooks/useDebouncedCallback';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { styled } from 'styled-components/native';
import { useShallow } from 'zustand/react/shallow';

import { Switch, Text, TextInput } from 'react-native-paper';
import { FlexibleText, SwitchContainer } from '../../components/PreferenceWidgets';
import { useConfigStore } from '../../store/config';

const StyledTextInput = styled(TextInput)`
  margin-top: 10px;
`;

export function TiddlyWiki(): JSX.Element {
  const { t } = useTranslation();

  const [initialUserName, rememberLastVisitState] = useConfigStore(useShallow(state => [state.userName, state.rememberLastVisitState]));
  const [userName, userNameSetter] = useState(initialUserName);
  const setConfig = useConfigStore(state => state.set);

  const userNameTextFieldOnChange = useDebouncedCallback((newText: string) => {
    setConfig({ userName: newText });
  }, []);
  return (
    <>
      <StyledTextInput
        label={t('Preference.DefaultUserName')}
        value={userName}
        onChangeText={(newText: string) => {
          userNameSetter(newText);
          userNameTextFieldOnChange(newText);
        }}
      />
      <Text>{t('Preference.DefaultUserNameDetail')}</Text>
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
