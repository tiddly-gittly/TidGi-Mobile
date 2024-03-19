import { useNavigation } from '@react-navigation/native';
import { StackScreenProps } from '@react-navigation/stack';
import { useTranslation } from 'react-i18next';
import { Button } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { RootStackParameterList } from '../App';

const MainFeatureButton = styled(Button)`
  margin: 10px;
  padding: 20px;
  height: 3em;
`;

export function ImporterButton() {
  const { t } = useTranslation();
  const navigation = useNavigation<StackScreenProps<RootStackParameterList, 'MainMenu'>['navigation']>();

  return (
    <MainFeatureButton
      mode='outlined'
      onPress={() => {
        navigation.navigate('Importer', {});
      }}
    >
      {t('Menu.ScanQRToSync')}
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
    >
      {t('AddWorkspace.AddWorkspace')}
    </MainFeatureButton>
  );
}
