import { useNavigation } from '@react-navigation/native';
import { StackScreenProps } from '@react-navigation/stack';
import { useTranslation } from 'react-i18next';
import { Button, Text } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { RootStackParameterList } from '../App';

const MainFeatureButton = styled(Button)`
  margin: 10px;
`;
/** Can't reach the label from button's style-component. Need to defined using `labelStyle`. Can't set padding on button, otherwise padding can't trigger click. */
const ButtonLabelPadding = 15;
const ButtonMinHeight = 56;
const contentMinHeight = { minHeight: ButtonMinHeight } as const;
const labelPadding = { padding: ButtonLabelPadding } as const;

export function ImporterButton() {
  const { t } = useTranslation();
  const navigation = useNavigation<StackScreenProps<RootStackParameterList, 'MainMenu'>['navigation']>();

  return (
    <MainFeatureButton
      testID='import-wiki-button'
      contentStyle={contentMinHeight}
      mode='outlined'
      onPress={() => {
        navigation.navigate('Importer', {});
      }}
      labelStyle={labelPadding}
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
      testID='create-workspace-button'
      contentStyle={contentMinHeight}
      mode='outlined'
      onPress={() => {
        navigation.navigate('CreateWorkspace');
      }}
      labelStyle={labelPadding}
    >
      <Text>{t('AddWorkspace.AddWorkspace')}</Text>
    </MainFeatureButton>
  );
}
