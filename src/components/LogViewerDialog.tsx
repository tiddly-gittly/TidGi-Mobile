/**
 * Shared log viewer dialog used by both Developer settings (app logs)
 * and WorkspaceDetailPage (workspace logs).
 *
 * Features:
 * - Date-based log file selector
 * - Character-budget pagination for large files
 * - Three-dot menu with: Open File, Share, Clear Logs
 */
import { shareAsync } from 'expo-sharing';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, ScrollView } from 'react-native';
import { Button, Dialog, IconButton, Menu, Portal, Text } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { deleteLogFile, getLogFilePath, listAppLogFiles, listWorkspaceLogFiles, readLogFile } from '../services/LoggerService';
import { paginateLogContent } from './logPagination';

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

const PaginationRow = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: center;
  margin-top: 8px;
`;

const PageLabel = styled(Text)`
  min-width: 80px;
  text-align: center;
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
  const [actionsMenuVisible, setActionsMenuVisible] = useState(false);
  const [fileMenuVisible, setFileMenuVisible] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const contentRequestID = useRef(0);
  const logPages = useMemo(() => paginateLogContent(logContent), [logContent]);
  const visiblePageIndex = Math.min(pageIndex, logPages.length - 1);

  const loadLogFiles = useCallback(async () => {
    const requestID = ++contentRequestID.current;
    const files = scope === 'app'
      ? await listAppLogFiles()
      : await listWorkspaceLogFiles(scope);
    if (requestID !== contentRequestID.current) return;
    setLogFileNames(files);
    // Select the latest file by default
    if (files.length > 0) {
      const latest = files[files.length - 1];
      setSelectedLogFile(latest);
      const content = await readLogFile(latest);
      if (requestID !== contentRequestID.current) return;
      setLogContent(content ?? t('WorkspaceSettings.LogEmpty'));
      setPageIndex(0);
    } else {
      setSelectedLogFile(undefined);
      setLogContent(t('WorkspaceSettings.LogEmpty'));
    }
  }, [scope, t]);

  useEffect(() => {
    if (visible) {
      void loadLogFiles();
    }
    return () => {
      contentRequestID.current++;
    };
  }, [visible, loadLogFiles]);

  const selectLogFile = useCallback(async (fileName: string) => {
    const requestID = ++contentRequestID.current;
    setSelectedLogFile(fileName);
    const content = await readLogFile(fileName);
    if (requestID !== contentRequestID.current) return;
    setLogContent(content ?? t('WorkspaceSettings.LogEmpty'));
    setPageIndex(0);
  }, [t]);

  const handleShare = useCallback(async () => {
    setActionsMenuVisible(false);
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
    setActionsMenuVisible(false);
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
    setActionsMenuVisible(false);
    contentRequestID.current++;
    // `logFileNames` is already scoped to either app logs or this workspace.
    for (const fileName of logFileNames) {
      await deleteLogFile(fileName);
    }
    setLogContent(t('WorkspaceSettings.LogEmpty'));
    setLogFileNames([]);
    setSelectedLogFile(undefined);
    setPageIndex(0);
  }, [logFileNames, t]);

  const title = scope === 'app' ? t('Preference.ViewAppLog') : t('WorkspaceSettings.ViewLog');

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onDismiss}>
        <Dialog.Title>{title}</Dialog.Title>
        <Dialog.Content>
          <HeaderRow>
            {logFileNames.length > 0
              ? (
                <Menu
                  visible={fileMenuVisible}
                  onDismiss={() => {
                    setFileMenuVisible(false);
                  }}
                  anchor={
                    <LogFilePickerButton
                      testID='log-file-selector'
                      mode='outlined'
                      compact
                      icon='chevron-down'
                      onPress={() => {
                        setFileMenuVisible(true);
                      }}
                    >
                      {selectedLogFile ?? ''}
                    </LogFilePickerButton>
                  }
                >
                  {logFileNames.map(fileName => (
                    <Menu.Item
                      key={fileName}
                      testID={`log-file-option-${fileName}`}
                      leadingIcon={fileName === selectedLogFile ? 'check' : 'file-document-outline'}
                      title={fileName}
                      onPress={() => {
                        setFileMenuVisible(false);
                        void selectLogFile(fileName);
                      }}
                    />
                  ))}
                </Menu>
              )
              : <Text>{t('WorkspaceSettings.LogEmpty')}</Text>}
            <Menu
              visible={actionsMenuVisible}
              onDismiss={() => {
                setActionsMenuVisible(false);
              }}
              anchor={
                <IconButton
                  icon='dots-vertical'
                  onPress={() => {
                    setActionsMenuVisible(true);
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
          <LogScrollView key={`${selectedLogFile ?? 'empty'}-${visiblePageIndex}`} testID='log-content-page'>
            <LogText>{logPages[visiblePageIndex]}</LogText>
          </LogScrollView>
        </Dialog.ScrollArea>
        {logPages.length > 1 && (
          <PaginationRow>
            <IconButton
              testID='log-page-previous'
              icon='chevron-left'
              disabled={visiblePageIndex === 0}
              onPress={() => {
                setPageIndex(previous => Math.max(0, previous - 1));
              }}
            />
            <PageLabel testID='log-page-label'>
              {visiblePageIndex + 1} / {logPages.length}
            </PageLabel>
            <IconButton
              testID='log-page-next'
              icon='chevron-right'
              disabled={visiblePageIndex >= logPages.length - 1}
              onPress={() => {
                setPageIndex(previous => Math.min(logPages.length - 1, previous + 1));
              }}
            />
          </PaginationRow>
        )}
        <Dialog.Actions>
          <Button onPress={onDismiss}>{t('Close')}</Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}
