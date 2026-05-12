/**
 * Workspace settings UI - tidgi.config.json editor
 */

import React, { FC, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView } from 'react-native';
import { Button, Card, Checkbox, Dialog, ProgressBar, Text, TextInput } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { useShallow } from 'zustand/react/shallow';
import { IMigrationProgress, migrateWorkspaceStorage } from '../../services/WikiMigrationService';
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

const ProgressLabel = styled(Text)`
  margin-top: 8px;
  font-size: 12px;
  color: #666;
`;

const StorageHintText = styled(Text)`
  color: #888;
  margin-top: 4px;
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
  const [defaultWorkspaceId, setDefaultWorkspace, customWikiFolderPath, updateWorkspace] = useWorkspaceStore(
    useShallow(state => [state.defaultWorkspaceId, state.setDefaultWorkspace, state.customWikiFolderPath, state.update]),
  );
  const isDefault = defaultWorkspaceId === workspace.id;
  const externalStorageEnabled = customWikiFolderPath !== null;

  // Migration state
  const [migrationDialogVisible, setMigrationDialogVisible] = useState(false);
  const [migrationProgress, setMigrationProgress] = useState<IMigrationProgress | null>(null);
  const [pendingExternalValue, setPendingExternalValue] = useState<boolean>(false);
  const isMigratingReference = useRef(false);

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

  const handleToggleExternalStorage = useCallback((toExternal: boolean) => {
    setPendingExternalValue(toExternal);
    setMigrationDialogVisible(true);
  }, []);

  const handleConfirmMigration = useCallback(async () => {
    if (isMigratingReference.current) return;
    isMigratingReference.current = true;
    try {
      await migrateWorkspaceStorage(
        workspace,
        pendingExternalValue ? customWikiFolderPath : null,
        (progress) => {
          setMigrationProgress(progress);
        },
      );
    } catch (error) {
      console.error('[WorkspaceSettings] migration failed:', error);
    } finally {
      isMigratingReference.current = false;
      setMigrationDialogVisible(false);
      setMigrationProgress(null);
    }
  }, [workspace, pendingExternalValue, customWikiFolderPath]);

  const isCurrentlyExternal = workspace.useExternalStorage === true;

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

      <Section>
        <SectionTitle>{t('WorkspaceSettings.DefaultWorkspace')}</SectionTitle>
        <Checkbox.Item
          label={t('WorkspaceSettings.SetAsDefault')}
          status={isDefault ? 'checked' : 'unchecked'}
          onPress={() => {
            setDefaultWorkspace(isDefault ? null : workspace.id);
          }}
          mode='android'
        />
      </Section>

      {externalStorageEnabled && (
        <Section>
          <SectionTitle>{t('WorkspaceSettings.StorageType')}</SectionTitle>
          <Checkbox.Item
            label={t('WorkspaceSettings.UseExternalStorage')}
            status={isCurrentlyExternal ? 'checked' : 'unchecked'}
            onPress={() => {
              handleToggleExternalStorage(!isCurrentlyExternal);
            }}
            mode='android'
          />
          <StorageHintText variant='bodySmall'>
            {isCurrentlyExternal
              ? t('WorkspaceSettings.UseExternalStorageHintExternal')
              : t('WorkspaceSettings.UseExternalStorageHintInternal')}
          </StorageHintText>
        </Section>
      )}

      <Section>
        <SectionTitle>{t('WorkspaceSettings.Performance')}</SectionTitle>
        <Checkbox.Item
          label={t('WorkspaceSettings.EnableQuickLoad')}
          status={workspace.enableQuickLoad === true ? 'checked' : 'unchecked'}
          onPress={() => {
            updateWorkspace(workspace.id, { enableQuickLoad: !(workspace.enableQuickLoad === true) });
          }}
          mode='android'
        />
        <StorageHintText variant='bodySmall'>
          {t('WorkspaceSettings.EnableQuickLoadDescription')}
        </StorageHintText>
      </Section>

      <SaveButton
        mode='contained'
        onPress={handleSave}
        icon='content-save'
      >
        {t('Settings.Save')}
      </SaveButton>
      {OpenDirectoryResultSnackBar}

      <Dialog visible={migrationDialogVisible} dismissable={false}>
        <Dialog.Title>{t('WorkspaceSettings.MigratingStorage')}</Dialog.Title>
        <Dialog.Content>
          {migrationProgress === null
            ? <Text>{t('WorkspaceSettings.MigrationConfirm', { direction: pendingExternalValue ? t('WorkspaceSettings.ToExternal') : t('WorkspaceSettings.ToInternal') })}</Text>
            : (
              <>
                <ProgressBar progress={migrationProgress.fraction} />
                <ProgressLabel>{migrationProgress.phase}</ProgressLabel>
              </>
            )}
        </Dialog.Content>
        {migrationProgress === null && (
          <Dialog.Actions>
            <Button
              onPress={() => {
                setMigrationDialogVisible(false);
              }}
            >
              {t('Cancel')}
            </Button>
            <Button
              onPress={() => {
                void handleConfirmMigration();
              }}
            >
              {t('Common.Confirm')}
            </Button>
          </Dialog.Actions>
        )}
      </Dialog>
    </Container>
  );
};
