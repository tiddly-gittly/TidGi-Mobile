/**
 * Shared log viewer dialog used by both Developer settings (app logs)
 * and WorkspaceDetailPage (workspace logs).
 *
 * Features:
 * - Date-based log file selector (dropdown cycling through same-type files)
 * - Three-dot menu with: Open File, Share, Clear Logs
 */
import { shareAsync } from 'expo-sharing';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, ScrollView } from 'react-native';
import { Button, Dialog, IconButton, Menu, Portal, Text } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { deleteLogFile, getLogFilePath, listAppLogFiles, listWorkspaceLogFiles, readLogFile } from '../services/LoggerService';

const LogScrollView = styled(ScrollView)`
  max-height: 420px;
  min-height: 220px;
`;

const LogText = styled(Text)`
  font-size: 12px;
  padding: 8px;
  font-family: monospace;
`;

const HeaderRow = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
`;

const LogFilePickerButton = styled(Button)`
  flex: 1;
  margin-right: 4px;
`;

export interface ILogViewerDialogProps {
  /** Scope: 'app' for developer tools, or a workspace ID string for per-wiki logs */
  scope: string;
  visible: boolean;
  onDismiss: () => void;
}

export function LogViewerDialog({ scope, visible, onDismiss }: ILogViewerDialogProps): React.JSX.Element {
  const { t } = useTranslation();
  const [logFileNames, setLogFileNames] = useState<string[]>([]);
  const [selectedLogFile, setSelectedLogFile] = useState<string | undefined>();
  const [logContent, setLogContent] = useState('');
  const [menuVisible, setMenuVisible] = useState(false);

  const loadLogFiles = useCallback(async () => {
    const files = scope === 'app'
      ? await listAppLogFiles()
      : await listWorkspaceLogFiles(scope);
    setLogFileNames(files);
    // Select the latest file by default
    if (files.length > 0) {
      const latest = files[files.length - 1];
      setSelectedLogFile(latest);
      const content = await readLogFile(latest);
      setLogContent(content ?? t('WorkspaceSettings.LogEmpty'));
    } else {
      setSelectedLogFile(undefined);
      setLogContent(t('WorkspaceSettings.LogEmpty'));
    }
  }, [scope, t]);

  useEffect(() => {
    if (visible) {
      void loadLogFiles();
    }
  }, [visible, loadLogFiles]);

  const selectLogFile = useCallback(async (fileName: string) => {
    setSelectedLogFile(fileName);
    const content = await readLogFile(fileName);
    setLogContent(content ?? t('WorkspaceSettings.LogEmpty'));
  }, [t]);

  const cycleToPreviousFile = useCallback(() => {
    if (logFileNames.length <= 1) return;
    const currentIndex = selectedLogFile ? logFileNames.indexOf(selectedLogFile) : logFileNames.length - 1;
    const nextIndex = (currentIndex - 1 + logFileNames.length) % logFileNames.length;
    void selectLogFile(logFileNames[nextIndex]);
  }, [logFileNames, selectedLogFile, selectLogFile]);

  const handleShare = useCallback(async () => {
    setMenuVisible(false);
    if (selectedLogFile === undefined) return;
    const filePath = getLogFilePath(selectedLogFile);
    try {
      // expo-sharing expects a file:// URI on both platforms
      const uri = filePath.startsWith('file://') ? filePath : `file://${filePath}`;
      await shareAsync(uri, {
        mimeType: 'text/plain',
        dialogTitle: selectedLogFile,
        UTI: 'public.plain-text',
      });
    } catch (error) {
      console.warn('Share failed:', error);
    }
  }, [selectedLogFile]);

  const handleOpenFile = useCallback(async () => {
    setMenuVisible(false);
    if (selectedLogFile === undefined) return;
    const filePath = getLogFilePath(selectedLogFile);
    try {
      const uri = filePath.startsWith('file://') ? filePath : `file://${filePath}`;
      await shareAsync(uri, {
        mimeType: 'text/plain',
        dialogTitle: selectedLogFile,
        UTI: 'public.plain-text',
      });
    } catch (error) {
      console.warn('Open file failed:', error);
    }
  }, [selectedLogFile]);

  const handleClearLogs = useCallback(async () => {
    setMenuVisible(false);
    if (scope === 'app') {
      // Clear only app logs
      for (const fileName of logFileNames) {
        await deleteLogFile(fileName);
      }
    } else {
      // Clear only this workspace's logs
      for (const fileName of logFileNames) {
        await deleteLogFile(fileName);
      }
    }
    setLogContent(t('WorkspaceSettings.LogEmpty'));
    setLogFileNames([]);
    setSelectedLogFile(undefined);
  }, [scope, logFileNames, t]);

  const title = scope === 'app' ? t('Preference.ViewAppLog') : t('WorkspaceSettings.ViewLog');

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onDismiss}>
        <Dialog.Title>{title}</Dialog.Title>
        <Dialog.Content>
          <HeaderRow>
            {logFileNames.length > 0
              ? (
                <LogFilePickerButton
                  mode='outlined'
                  compact
                  icon='calendar'
                  onPress={cycleToPreviousFile}
                >
                  {selectedLogFile ?? ''}
                </LogFilePickerButton>
              )
              : <Text>{t('WorkspaceSettings.LogEmpty')}</Text>}
            <Menu
              visible={menuVisible}
              onDismiss={() => {
                setMenuVisible(false);
              }}
              anchor={
                <IconButton
                  icon='dots-vertical'
                  onPress={() => {
                    setMenuVisible(true);
                  }}
                />
              }
            >
              {Platform.OS !== 'web' && (
                <Menu.Item
                  leadingIcon='share-variant'
                  onPress={() => {
                    void handleShare();
                  }}
                  title={t('WorkspaceSettings.ShareLog')}
                />
              )}
              <Menu.Item
                leadingIcon='file-document-outline'
                onPress={() => {
                  void handleOpenFile();
                }}
                title={t('WorkspaceSettings.OpenLogFile')}
              />
              <Menu.Item
                leadingIcon='delete-outline'
                onPress={() => {
                  void handleClearLogs();
                }}
                title={t('WorkspaceSettings.ClearLogs')}
              />
            </Menu>
          </HeaderRow>
        </Dialog.Content>
        <Dialog.ScrollArea>
          <LogScrollView>
            <LogText>{logContent}</LogText>
          </LogScrollView>
        </Dialog.ScrollArea>
        <Dialog.Actions>
          <Button onPress={onDismiss}>{t('Close')}</Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}
