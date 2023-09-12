import React from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { LIN_ONETWO_WIKI } from '../../constants/webview';

export function About(): JSX.Element {
  const { t } = useTranslation();

  return (
    <SegmentedContainer>
      <Text variant='titleLarge'>{t('Dialog.MadeWithLove')}</Text>
      <TouchableOpacity
        onPress={async () => {
          try {
            const supported = await Linking.canOpenURL(LIN_ONETWO_WIKI);
            if (supported) {
              await Linking.openURL(LIN_ONETWO_WIKI);
            } else {
              console.log("Don't know how to open URI: " + LIN_ONETWO_WIKI);
            }
          } catch (error) {
            console.error(`An error occurred while opening ${LIN_ONETWO_WIKI}: ${(error as Error).message}`);
          }
        }}
      >
        <Text variant='titleLarge'>{t('LinOnetwo')}</Text>
      </TouchableOpacity>
    </SegmentedContainer>
  );
}

const SegmentedContainer = styled.View`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
`;
