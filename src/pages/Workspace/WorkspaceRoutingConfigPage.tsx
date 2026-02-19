import { StackScreenProps } from '@react-navigation/stack';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Chip, List, Switch, Text, TextInput } from 'react-native-paper';
import { RootStackParameterList } from '../../App';
import { readTidgiConfig, writeTidgiConfig } from '../../services/WikiStorageService/tidgiConfigManager';
import { PageContainer, useWikiWorkspace, useWorkspaceTitle } from './shared';
import { PathFilterInput, RoutingDescription, SaveButton, TagInputField, TagsRow } from './workspaceStyles';

export function WorkspaceRoutingConfigPage({ route, navigation }: StackScreenProps<RootStackParameterList, 'WorkspaceRoutingConfig'>): JSX.Element {
  const { t } = useTranslation();
  const wiki = useWikiWorkspace(route.params.id);
  useWorkspaceTitle({ route, navigation } as StackScreenProps<RootStackParameterList, keyof RootStackParameterList>, wiki, t('WorkspaceSettings.SubWikiRouting'));

  const [tagNames, setTagNames] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [includeTagTree, setIncludeTagTree] = useState(false);
  const [pathFilterEnable, setPathFilterEnable] = useState(false);
  const [pathFilter, setPathFilter] = useState('');

  useEffect(() => {
    if (!wiki) return;
    void (async () => {
      try {
        const config = await readTidgiConfig(wiki);
        setTagNames(Array.isArray(config.tagNames) ? config.tagNames : []);
        setIncludeTagTree(config.includeTagTree === true);
        setPathFilterEnable(config.fileSystemPathFilterEnable === true);
        setPathFilter(typeof config.fileSystemPathFilter === 'string' ? config.fileSystemPathFilter : '');
      } catch (error) {
        console.error('Failed to load routing config:', error);
      }
    })();
  }, [wiki?.id]);

  const addTag = useCallback(() => {
    const trimmed = tagInput.trim();
    if (!trimmed || tagNames.includes(trimmed)) return;
    setTagNames(previous => [...previous, trimmed]);
    setTagInput('');
  }, [tagInput, tagNames]);

  const removeTag = useCallback((tag: string) => {
    setTagNames(previous => previous.filter(item => item !== tag));
  }, []);

  const handleSave = useCallback(async () => {
    if (!wiki) return;
    try {
      await writeTidgiConfig(wiki, {
        tagNames,
        includeTagTree,
        fileSystemPathFilterEnable: pathFilterEnable,
        fileSystemPathFilter: pathFilter.trim() === '' ? null : pathFilter,
      });
      navigation.goBack();
    } catch (error) {
      console.error('Failed to save routing config:', error);
    }
  }, [wiki, tagNames, includeTagTree, pathFilterEnable, pathFilter, navigation]);

  if (!wiki) {
    return (
      <PageContainer>
        <Text>{t('EditWorkspace.NotFound')}</Text>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <RoutingDescription variant='bodySmall'>
        {t('WorkspaceSettings.RoutingDescription')}
      </RoutingDescription>

      <TagInputField
        label={t('WorkspaceSettings.AddNewTag')}
        value={tagInput}
        onChangeText={setTagInput}
        mode='outlined'
        right={<TextInput.Icon icon='plus' onPress={addTag} />}
        onSubmitEditing={addTag}
      />

      {tagNames.length > 0 && (
        <TagsRow>
          {tagNames.map(tag => (
            <Chip
              key={tag}
              onClose={() => {
                removeTag(tag);
              }}
              mode='outlined'
            >
              {tag}
            </Chip>
          ))}
        </TagsRow>
      )}

      <List.Item
        title={t('WorkspaceSettings.IncludeTagTree')}
        description={t('WorkspaceSettings.IncludeTagTreeDescription')}
        right={() => <Switch value={includeTagTree} onValueChange={setIncludeTagTree} />}
      />

      <List.Item
        title={t('WorkspaceSettings.EnablePathFilter')}
        description={t('WorkspaceSettings.EnablePathFilterDescription')}
        right={() => <Switch value={pathFilterEnable} onValueChange={setPathFilterEnable} />}
      />

      {pathFilterEnable && (
        <PathFilterInput
          label={t('WorkspaceSettings.FileSystemPathFilter')}
          value={pathFilter}
          onChangeText={setPathFilter}
          mode='outlined'
          multiline
          numberOfLines={4}
        />
      )}

      <SaveButton
        mode='contained'
        onPress={() => {
          void handleSave();
        }}
      >
        {t('Common.Save')}
      </SaveButton>
    </PageContainer>
  );
}
