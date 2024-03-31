import { useNavigation } from '@react-navigation/native';
import { StackScreenProps } from '@react-navigation/stack';
import React, { useMemo } from 'react';
import { FlatList } from 'react-native';

import { useTranslation } from 'react-i18next';
import { ActivityIndicator, MD2Colors, Text } from 'react-native-paper';
import { RootStackParameterList } from '../../../App';
import { filterTemplate, ITemplateListItem, LoadingContainer, TemplateListItem } from '../../../components/TemplateList';
import { templateListCachePath } from '../../../constants/paths';
import wikiTemplates from '../templates/wikiTemplates.json';
import { useLoadOnlineSources } from './useLoadOnlineSources';

export const CreateFromTemplateTab = () => {
  const { t } = useTranslation();
  const navigation = useNavigation<StackScreenProps<RootStackParameterList, 'CreateWorkspace'>['navigation']>();

  const [webPages, loading] = useLoadOnlineSources(wikiTemplates.onlineSources, templateListCachePath);
  const serverHosts = wikiTemplates.onlineSources.map((url) => new URL(url).host);
  const renderItem = useMemo(() =>
    function CreateFromTemplateTabListItem({ item }: { item: ITemplateListItem }) {
      return (
        <TemplateListItem
          item={item}
          onPreviewPress={(uri: string) => {
            navigation.navigate('PreviewWebView', { uri });
          }}
          onUsePress={(uri: string) => {
            navigation.navigate('Importer', { uri, autoImportBinary: true, addAsServer: false });
          }}
        />
      );
    }, [navigation]);

  if (loading) {
    return (
      <LoadingContainer>
        <ActivityIndicator animating={true} color={MD2Colors.red800} />
        <Text>{t('AddWorkspace.LoadingFromServer')}</Text>
        {serverHosts.map((host) => <Text key={host}>{host}</Text>)}
      </LoadingContainer>
    );
  }
  return (
    <FlatList
      data={filterTemplate(webPages)}
      renderItem={renderItem}
      keyExtractor={(item, index) => `template-${index}`}
    />
  );
};
