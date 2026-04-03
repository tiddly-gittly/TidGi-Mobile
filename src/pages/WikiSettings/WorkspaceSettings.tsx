/**
 * Workspace settings UI - tidgi.config.json editor
 */

import React, { FC, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView } from 'react-native';
import { Button, Card, Text, TextInput } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { ITidgiConfig, readTidgiConfig, writeTidgiConfig } from '../../services/WikiStorageService/tidgiConfigManager';
import { IWikiWorkspace, useWorkspaceStore } from '../../store/workspace';
import { useOpenDirectory } from '../Config/Developer/useOpenDirectory';

const Container = styled(ScrollView)`
  flex: 1;
  padding: 16px;
`;

const SaveButton = styled(Button)`
  margin-top: 16px;
  margin-bottom: 32px;
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

export interface IWorkspaceSettingsProps {
  workspace: IWikiWorkspace;
}

export const WorkspaceSettings: FC<IWorkspaceSettingsProps> = ({ workspace }) => {
  const { t } = useTranslation();
  const [config, setConfig] = useState<ITidgiConfig>({
    name: workspace.name,
    tagNames: [],
    includeTagTree: false,
  });
  const { openDocumentDirectory, OpenDirectoryResultSnackBar } = useOpenDirectory();

  // Load config
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const loadedConfig = await readTidgiConfig(workspace);
        setConfig(loadedConfig);
      } catch (error) {
        console.error('Failed to load tidgi.config.json:', error);
      }
    };
    void loadConfig();
  }, [workspace]);

  // Save config
  const handleSave = useCallback(async () => {
    try {
      await writeTidgiConfig(workspace, {
        name: config.name,
      });

      // Also update workspace name in store
      if (config.name && config.name !== workspace.name) {
        useWorkspaceStore.getState().update(workspace.id, { name: config.name });
      }

      alert(t('Settings.SaveSuccess'));
    } catch (error) {
      console.error('Failed to save tidgi.config.json:', error);
      alert(t('Settings.SaveFailed'));
    }
  }, [config, workspace, t]);

  return (
    <Container>
      <Section>
        <SectionTitle>{t('WorkspaceSettings.BasicInfo')}</SectionTitle>

        <TextInput
          label={t('WorkspaceSettings.WorkspaceName')}
          value={config.name || ''}
          onChangeText={(text) => {
            setConfig({ ...config, name: text });
          }}
          mode='outlined'
        />
        <TextInput
          label={t('AddWorkspace.WorkspaceFolder')}
          value={workspace.wikiFolderLocation}
          mode='outlined'
          editable={false}
          right={
            <TextInput.Icon
              icon='folder-open'
              onPress={() => {
                void openDocumentDirectory(workspace.wikiFolderLocation);
              }}
            />
          }
        />
      </Section>

      <SaveButton
        mode='contained'
        onPress={handleSave}
        icon='content-save'
      >
        {t('Settings.Save')}
      </SaveButton>
      {OpenDirectoryResultSnackBar}
    </Container>
  );
};
