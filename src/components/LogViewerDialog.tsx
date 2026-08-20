/**
 * Shared log viewer dialog used by both Developer settings (app logs)
 * and WorkspaceDetailPage (workspace logs).
 *
 * Features:
 * - Date-based log file selector
 * - Character-budget pagination for large files
 * - Three-dot menu with: Open File, Share, Clear Logs
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { shareAsync } from 'expo-sharing';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Platform, Pressable, ScrollView, TouchableOpacity } from 'react-native';
import { Button, Dialog, IconButton, Menu, Portal, Text, useTheme } from 'react-native-paper';
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

const SelectorShell = styled.View`
  width: 100%;
  height: 48px;
  min-width: 0;
`;

const FileSelectorShell = styled(SelectorShell)`
  flex: 1;
`;

const SelectorButton = styled(Button)`
  width: 100%;
  height: 48px;
  justify-content: center;
  border-radius: 8px;
`;

const SelectorChevron = styled(Ionicons)`
  position: absolute;
  right: 14px;
  top: 15px;
`;

const SelectorColumn = styled.View`
  gap: 8px;
`;

const SourceLabel = styled(Text)`
  margin-bottom: 4px;
`;

const PickerBackdrop = styled(Pressable)`
  flex: 1;
  padding: 24px;
  align-items: center;
  justify-content: center;
  background-color: rgba(0, 0, 0, 0.42);
`;

const PickerCard = styled.View<{ $surfaceColor: string }>`
  width: 100%;
  max-height: 70%;
  padding-vertical: 8px;
  border-radius: 16px;
  background-color: ${({ $surfaceColor }) => $surfaceColor};
  elevation: 8;
`;

const PickerTitle = styled(Text)`
  padding: 12px 20px;
`;

const PickerOptions = styled(ScrollView)`
  flex-grow: 0;
`;

const PickerOption = styled(TouchableOpacity)`
  min-height: 52px;
  padding: 12px 20px;
  flex-direction: row;
  align-items: center;
`;

const PickerOptionText = styled(Text)`
  flex: 1;
  margin-left: 12px;
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
  onOpenChanges?: () => void;
  scope: string;
  visible: boolean;
  onDismiss: () => void;
  workspaceName?: string;
}

type LogSource = 'app' | 'workspace';

function getLogDate(fileName: string): string {
  return fileName.match(/\d{4}-\d{2}-\d{2}(?=\.log$)/)?.[0] ?? fileName;
}

export function LogViewerDialog({ scope, visible, onDismiss, onOpenChanges, workspaceName }: ILogViewerDialogProps): React.JSX.Element {
  const { t } = useTranslation();
  const theme = useTheme();
  const isWorkspaceScope = scope !== 'app';
  const [logSource, setLogSource] = useState<LogSource>(isWorkspaceScope ? 'workspace' : 'app');
  const [logFileNames, setLogFileNames] = useState<string[]>([]);
  const [selectedLogFile, setSelectedLogFile] = useState<string | undefined>();
  const [logContent, setLogContent] = useState('');
  const [actionsMenuVisible, setActionsMenuVisible] = useState(false);
  const [fileMenuVisible, setFileMenuVisible] = useState(false);
  const [sourceMenuVisible, setSourceMenuVisible] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const contentRequestID = useRef(0);
  const logPages = useMemo(() => paginateLogContent(logContent), [logContent]);
  const visiblePageIndex = Math.min(pageIndex, logPages.length - 1);

  const loadLogFiles = useCallback(async () => {
    const requestID = ++contentRequestID.current;
    const files = logSource === 'app'
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
  }, [logSource, scope, t]);

  useEffect(() => {
    if (visible) {
      void loadLogFiles();
    } else {
      setActionsMenuVisible(false);
      setFileMenuVisible(false);
      setSourceMenuVisible(false);
      setPageIndex(0);
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
  const sourceTitle = logSource === 'workspace'
    ? t('WorkspaceSettings.GitSyncLog', 'Git 同步日志')
    : t('WorkspaceSettings.AppAndServerLog', '应用与服务器日志');
  const selectedFileTitle = selectedLogFile === undefined
    ? t('WorkspaceSettings.LogEmpty')
    : t('WorkspaceSettings.LogDate', { defaultValue: '{{date}}', date: getLogDate(selectedLogFile) });

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onDismiss}>
        <Dialog.Title>{title}</Dialog.Title>
        <Dialog.Content>
          <SelectorColumn>
            {isWorkspaceScope && (
              <>
                <SourceLabel variant='labelMedium'>
                  {workspaceName ?? t('GitHistory.Workspace', '工作区')}
                </SourceLabel>
                <SelectorShell>
                  <SelectorButton
                    testID='log-source-selector'
                    mode='outlined'
                    compact
                    onPress={() => {
                      setSourceMenuVisible(true);
                    }}
                  >
                    {sourceTitle}
                  </SelectorButton>
                  <SelectorChevron pointerEvents='none' name='chevron-down' size={18} color={theme.colors.onSurface} />
                </SelectorShell>
              </>
            )}
            <HeaderRow>
              {logFileNames.length > 0
                ? (
                  <FileSelectorShell>
                    <SelectorButton
                      testID='log-file-selector'
                      mode='outlined'
                      compact
                      onPress={() => {
                        setFileMenuVisible(true);
                      }}
                    >
                      {selectedFileTitle}
                    </SelectorButton>
                    <SelectorChevron pointerEvents='none' name='chevron-down' size={18} color={theme.colors.onSurface} />
                  </FileSelectorShell>
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
          </SelectorColumn>
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
          {onOpenChanges !== undefined && (
            <Button
              testID='log-open-workspace-changes'
              onPress={() => {
                onDismiss();
                onOpenChanges();
              }}
            >
              {t('AddWorkspace.OpenChangeLogList')}
            </Button>
          )}
          <Button onPress={onDismiss}>{t('Close')}</Button>
        </Dialog.Actions>
      </Dialog>
      <Modal
        transparent
        animationType='fade'
        visible={visible && sourceMenuVisible}
        onRequestClose={() => {
          setSourceMenuVisible(false);
        }}
      >
        <PickerBackdrop
          testID='log-source-picker'
          onPress={() => {
            setSourceMenuVisible(false);
          }}
        >
          <PickerCard $surfaceColor={theme.colors.elevation.level3}>
            <PickerTitle variant='titleMedium'>
              {t('WorkspaceSettings.LogSource', '日志类型')}
            </PickerTitle>
            <PickerOption
              testID='log-source-workspace'
              onPress={() => {
                setSourceMenuVisible(false);
                setFileMenuVisible(false);
                setLogSource('workspace');
              }}
            >
              <Ionicons name={logSource === 'workspace' ? 'checkmark' : 'git-branch-outline'} size={22} color={theme.colors.onSurface} />
              <PickerOptionText numberOfLines={2}>
                {t('WorkspaceSettings.GitSyncLog', 'Git 同步日志')}
              </PickerOptionText>
            </PickerOption>
            <PickerOption
              testID='log-source-app'
              onPress={() => {
                setSourceMenuVisible(false);
                setFileMenuVisible(false);
                setLogSource('app');
              }}
            >
              <Ionicons name={logSource === 'app' ? 'checkmark' : 'settings-outline'} size={22} color={theme.colors.onSurface} />
              <PickerOptionText numberOfLines={2}>
                {t('WorkspaceSettings.AppAndServerLog', '应用与服务器日志')}
              </PickerOptionText>
            </PickerOption>
          </PickerCard>
        </PickerBackdrop>
      </Modal>
      <Modal
        transparent
        animationType='fade'
        visible={visible && fileMenuVisible}
        onRequestClose={() => {
          setFileMenuVisible(false);
        }}
      >
        <PickerBackdrop
          testID='log-file-picker'
          onPress={() => {
            setFileMenuVisible(false);
          }}
        >
          <PickerCard $surfaceColor={theme.colors.elevation.level3}>
            <PickerTitle variant='titleMedium'>
              {t('WorkspaceSettings.LogDateTitle', '日志日期')}
            </PickerTitle>
            <PickerOptions>
              {logFileNames.map(fileName => (
                <PickerOption
                  key={fileName}
                  testID={`log-file-option-${fileName}`}
                  onPress={() => {
                    setFileMenuVisible(false);
                    void selectLogFile(fileName);
                  }}
                >
                  <Ionicons
                    name={fileName === selectedLogFile ? 'checkmark' : 'document-text-outline'}
                    size={22}
                    color={theme.colors.onSurface}
                  />
                  <PickerOptionText numberOfLines={1}>{getLogDate(fileName)}</PickerOptionText>
                </PickerOption>
              ))}
            </PickerOptions>
          </PickerCard>
        </PickerBackdrop>
      </Modal>
    </Portal>
  );
}
