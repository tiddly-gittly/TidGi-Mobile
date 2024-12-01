import useDebouncedCallback from 'beautiful-react-hooks/useDebouncedCallback';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { styled } from 'styled-components/native';

import { Switch, Text, TextInput } from 'react-native-paper';
import { FlexibleText, SwitchContainer } from '../../components/PreferenceWidgets';
import { useConfigStore } from '../../store/config';

const StyledTextInput = styled(TextInput)`
  margin-top: 10px;
`;

export function Shared(): JSX.Element {
  const { t } = useTranslation();

  const [initialTagForSharedContent, fastImport] = useConfigStore(state => [state.tagForSharedContent, state.fastImport]);
  const [tagForSharedContent, tagForSharedContentSetter] = useState(initialTagForSharedContent);
  const setConfig = useConfigStore(state => state.set);

  const tagForSharedContentOnChange = useDebouncedCallback((newText: string) => {
    setConfig({ tagForSharedContent: newText });
  }, []);

  const fastImportOnChange = (value: boolean) => {
    setConfig({ fastImport: value });
  };

  return (
    <>
      <StyledTextInput
        label={t('Share.TagForSharedContent')}
        value={tagForSharedContent}
        defaultValue={t('Share.Clipped')}
        onChangeText={(newText: string) => {
          tagForSharedContentSetter(newText);
          tagForSharedContentOnChange(newText);
        }}
      />
      <Text>{t('Share.TagForSharedContentDescription')}</Text>
      <Text variant='titleLarge'>{t('Share.FastImport')}</Text>
      <SwitchContainer>
        <FlexibleText>{t('Share.FastImportDescription')}</FlexibleText>
        <Switch
          value={fastImport}
          onValueChange={fastImportOnChange}
        />
      </SwitchContainer>
    </>
  );
}
