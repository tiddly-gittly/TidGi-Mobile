/* eslint-disable react-native/no-inline-styles */
import { useNavigation } from '@react-navigation/native';
import { StackScreenProps } from '@react-navigation/stack';
import { useTranslation } from 'react-i18next';
import { Button, Text } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { RootStackParameterList } from '../App';

const MainFeatureButton = styled(Button)`
  margin: 10px;
  /* Use height: 3em will cause label to disappear on iOS */
  min-height: 3em;
`;
/** Can't reach the label from button's style-component. Need to defined using `labelStyle`. Can't set padding on button, otherwise padding can't trigger click. */
const ButtonLabelPadding = 15;

export function ImporterButton() {
  const { t } = useTranslation();
  const navigation = useNavigation<StackScreenProps<RootStackParameterList, 'MainMenu'>['navigation']>();

  return (
    <MainFeatureButton
      mode='outlined'
      onPress={() => {
        navigation.navigate('Importer', {});
      }}
      labelStyle={{ padding: ButtonLabelPadding }}
    >
      <Text>{t('Menu.ScanQRToSync')}</Text>
    </MainFeatureButton>
  );
}

export function CreateWorkspaceButton() {
  const { t } = useTranslation();
  const navigation = useNavigation<StackScreenProps<RootStackParameterList, 'MainMenu'>['navigation']>();

  return (
    <MainFeatureButton
      mode='outlined'
      onPress={() => {
        navigation.navigate('CreateWorkspace');
      }}
      labelStyle={{ padding: ButtonLabelPadding }}
    >
      <Text>{t('AddWorkspace.AddWorkspace')}</Text>
    </MainFeatureButton>
  );
}
