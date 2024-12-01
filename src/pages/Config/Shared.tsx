import useDebouncedCallback from 'beautiful-react-hooks/useDebouncedCallback';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { styled } from 'styled-components/native';

import { TextInput, Text } from 'react-native-paper';
import { useConfigStore } from '../../store/config';

const StyledTextInput = styled(TextInput)`
  margin-top: 10px;
`;

export function Shared(): JSX.Element {
  const { t } = useTranslation();

  const [initialTagForSharedContent] = useConfigStore(state => [state.tagForSharedContent]);
  const [tagForSharedContent, tagForSharedContentSetter] = useState(initialTagForSharedContent);
  const setConfig = useConfigStore(state => state.set);

  const tagForSharedContentOnChange = useDebouncedCallback((newText: string) => {
    setConfig({ tagForSharedContent: newText });
  }, []);

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
    </>
  );
}
