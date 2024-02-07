import React from 'react';
import { useTranslation } from 'react-i18next';
import { SegmentedButtons, Text } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { defaultLanguage, detectedLanguage, supportedLanguages } from '../../i18n';
import { useConfigStore } from '../../store/config';

export function Language(): JSX.Element {
  const { t, i18n } = useTranslation();

  const currentLanguage = useConfigStore(state => state.preferredLanguage ?? detectedLanguage);
  const setConfig = useConfigStore(state => state.set);

  return (
    <>
      <Text variant='titleLarge'>{t('Preference.ChooseLanguage')}</Text>
      <SegmentedContainer>
        <SegmentedButtons
          value={currentLanguage ?? defaultLanguage}
          onValueChange={async (newValue) => {
            // when tap again, set to undefined
            const preferredLanguage = currentLanguage === newValue ? undefined : newValue;
            setConfig({ preferredLanguage });
            await i18n.changeLanguage(preferredLanguage ?? detectedLanguage ?? defaultLanguage);
          }}
          buttons={supportedLanguages}
        />
      </SegmentedContainer>
    </>
  );
}

export const SegmentedContainer = styled.View`
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
`;
