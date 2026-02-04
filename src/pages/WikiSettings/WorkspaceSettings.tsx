/**
 * Workspace settings UI - tidgi.config.json editor
 */

import React, { FC, useCallback, useEffect, useState } from 'react';
import { ScrollView } from 'react-native';
import { Button, Card, Chip, IconButton, List, Switch, Text, TextInput } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { useTranslation } from 'react-i18next';
import { IWikiWorkspace, useWorkspaceStore } from '../../store/workspace';
import { getTidgiConfig, saveTidgiConfig, ITidgiConfig } from '../../services/WikiStorageService/tidgiConfigManager';

const Container = styled(ScrollView)`
  flex: 1;
  padding: 16px;
`;

const Section = styled(Card)`
  margin-bottom: 16px;
  padding: 16px;
`;

const SectionTitle = styled(Text)`
  font-size: 18px;
  font-weight: bold;
  margin-bottom: 12px;
`;

const TagChipsContainer = styled.View`
  flex-direction: row;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
`;

const FilterInputContainer = styled.View`
  margin-top: 8px;
`;

export interface IWorkspaceSettingsProps {
  workspace: IWikiWorkspace;
}

export const WorkspaceSettings: FC<IWorkspaceSettingsProps> = ({ workspace }) => {
  const { t } = useTranslation();
  const [config, setConfig] = useState<ITidgiConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [newTagName, setNewTagName] = useState('');
  
  const workspaceStore = useWorkspaceStore();

  // Load config
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const loadedConfig = await getTidgiConfig(workspace.wikiFolderLocation);
        setConfig(loadedConfig);
      } catch (error) {
        console.error('Failed to load tidgi.config.json:', error);
        // Initialize with defaults
        setConfig({
          name: workspace.name,
          tagNames: [],
          includeTagTree: false,
        });
      } finally {
        setLoading(false);
      }
    };
    void loadConfig();
  }, [workspace]);

  // Save config
  const handleSave = useCallback(async () => {
    if (config === null) return;
    
    try {
      await saveTidgiConfig(workspace.wikiFolderLocation, config);
      
      // Also update workspace name in store
      if (config.name && config.name !== workspace.name) {
        workspaceStore.getState().update({ ...workspace, name: config.name });
      }
      
      alert(t('Settings.SaveSuccess'));
    } catch (error) {
      console.error('Failed to save tidgi.config.json:', error);
      alert(t('Settings.SaveFailed'));
    }
  }, [config, workspace, workspaceStore, t]);

  const handleAddTag = useCallback(() => {
    if (!newTagName.trim() || config === null) return;
    
    const tagNames = config.tagNames || [];
    if (!tagNames.includes(newTagName.trim())) {
      setConfig({
        ...config,
        tagNames: [...tagNames, newTagName.trim()],
      });
    }
    setNewTagName('');
  }, [newTagName, config]);

  const handleRemoveTag = useCallback((tag: string) => {
    if (config === null) return;
    
    setConfig({
      ...config,
      tagNames: (config.tagNames || []).filter(t => t !== tag),
    });
  }, [config]);

  if (loading || config === null) {
    return (
      <Container>
        <Text>{t('Loading')}</Text>
      </Container>
    );
  }

  return (
    <Container>
      <Section>
        <SectionTitle>{t('WorkspaceSettings.BasicInfo')}</SectionTitle>
        
        <TextInput
          label={t('WorkspaceSettings.WorkspaceName')}
          value={config.name || ''}
          onChangeText={(text) => setConfig({ ...config, name: text })}
          mode="outlined"
        />
      </Section>

      <Section>
        <SectionTitle>{t('WorkspaceSettings.SubWikiRouting')}</SectionTitle>
        <Text variant="bodySmall" style={{ marginBottom: 12 }}>
          {t('WorkspaceSettings.RoutingDescription')}
        </Text>

        <List.Item
          title={t('WorkspaceSettings.TagNames')}
          description={t('WorkspaceSettings.TagNamesDescription')}
          left={props => <List.Icon {...props} icon="tag-multiple" />}
        />
        
        <TagChipsContainer>
          {(config.tagNames || []).map(tag => (
            <Chip
              key={tag}
              onClose={() => handleRemoveTag(tag)}
              mode="outlined"
            >
              {tag}
            </Chip>
          ))}
        </TagChipsContainer>

        <FilterInputContainer>
          <TextInput
            label={t('WorkspaceSettings.AddNewTag')}
            value={newTagName}
            onChangeText={setNewTagName}
            mode="outlined"
            right={
              <TextInput.Icon
                icon="plus"
                onPress={handleAddTag}
                disabled={!newTagName.trim()}
              />
            }
            onSubmitEditing={handleAddTag}
          />
        </FilterInputContainer>

        <List.Item
          title={t('WorkspaceSettings.IncludeTagTree')}
          description={t('WorkspaceSettings.IncludeTagTreeDescription')}
          left={props => <List.Icon {...props} icon="file-tree" />}
          right={() => (
            <Switch
              value={config.includeTagTree || false}
              onValueChange={(value) => setConfig({ ...config, includeTagTree: value })}
            />
          )}
        />
      </Section>

      <Section>
        <SectionTitle>{t('WorkspaceSettings.AdvancedFilters')}</SectionTitle>
        <Text variant="bodySmall" style={{ marginBottom: 12 }}>
          {t('WorkspaceSettings.FiltersDescription')}
        </Text>

        <TextInput
          label={t('WorkspaceSettings.CustomFilters')}
          value={config.customFilters || ''}
          onChangeText={(text) => setConfig({ ...config, customFilters: text })}
          mode="outlined"
          multiline
          numberOfLines={4}
          placeholder="[tag[MyTag]]\n[prefix[$:/]]\n..."
        />

        <FilterInputContainer>
          <TextInput
            label={t('WorkspaceSettings.FileSystemPathFilters')}
            value={config.fileSystemPathFilters || ''}
            onChangeText={(text) => setConfig({ ...config, fileSystemPathFilters: text })}
            mode="outlined"
            multiline
            numberOfLines={3}
            placeholder="[addprefix[subfolder/]]"
          />
        </FilterInputContainer>
      </Section>

      <Button
        mode="contained"
        onPress={handleSave}
        icon="content-save"
        style={{ marginTop: 16, marginBottom: 32 }}
      >
        {t('Settings.Save')}
      </Button>
    </Container>
  );
};
