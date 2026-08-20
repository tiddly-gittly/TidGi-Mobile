import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, ScrollView, View } from 'react-native';
import { ActivityIndicator, Button, Card, Dialog, IconButton, List, Menu, Modal, Portal, SegmentedButtons, Text, TextInput, useTheme } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { useShallow } from 'zustand/react/shallow';
import {
  gitCommit,
  gitDiffChangedFiles,
  gitDiscardFileChanges,
  gitGetChangedFilesForCommit,
  gitGetCommitHistory,
  gitGetFileContentAtReference,
  gitGetRemoteOids,
  gitResolveReference,
  IGitCommitFileDiffResult,
  IGitCommitInfo,
  IGitFileContent,
} from '../../../services/GitService';
import { IWikiWorkspace, useWorkspaceStore } from '../../../store/workspace';
import { getRelatedWikiWorkspaces } from '../../../utils/workspaceRelations';
import { GitFilePreviewModal } from './GitFilePreviewModal';
interface ModalProps {
  id: string | undefined;
  onClose: () => void;
  onSelectWorkspace?: (workspaceID: string) => void;
}

interface IUncommittedChangeItem {
  path: string;
  type: 'add' | 'modify' | 'delete';
  workspace: IWikiWorkspace;
}

export function WikiChangesModelContent({ id, onClose: _onClose, onSelectWorkspace }: ModalProps): JSX.Element {
  const { t } = useTranslation();
  const theme = useTheme();

  // Use useShallow + useMemo to avoid re-renders from .find() recreation
  const workspaces = useWorkspaceStore(useShallow(state => state.workspaces));
  const wiki = useMemo(
    () => id === undefined ? undefined : workspaces.find((w): w is IWikiWorkspace => w.id === id && (w.type === undefined || w.type === 'wiki')),
    [id, workspaces],
  );
  const [commits, setCommits] = useState<IGitCommitInfo[]>([]);
  const [uncommittedChanges, setUncommittedChanges] = useState<IUncommittedChangeItem[]>([]);
  const [selectedCommit, setSelectedCommit] = useState<IGitCommitInfo | undefined>();
  const [selectedFilePath, setSelectedFilePath] = useState<string | undefined>();
  const [filePreviewVisible, setFilePreviewVisible] = useState(false);
  const [changedFiles, setChangedFiles] = useState<Array<{ path: string; type: 'add' | 'modify' | 'delete' }>>([]);
  const [isShallowSnapshot, setIsShallowSnapshot] = useState(false);
  const [beforeContent, setBeforeContent] = useState<IGitFileContent>({ kind: 'missing' });
  const [afterContent, setAfterContent] = useState<IGitFileContent>({ kind: 'missing' });
  const [contentMode, setContentMode] = useState<'diff' | 'full'>('diff');
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loadingUncommitted, setLoadingUncommitted] = useState(false);
  const [loadingFilePreview, setLoadingFilePreview] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState<string | undefined>();
  const [_discardingFile, _setDiscardingFile] = useState<string | undefined>();
  const [selectedUncommittedItem, setSelectedUncommittedItem] = useState<IUncommittedChangeItem | undefined>();
  const [currentTab, setCurrentTab] = useState<'details' | 'actions'>('details');
  const [newCommitMessage, setNewCommitMessage] = useState(t('LOG.CommitBackupMessage'));
  const [isCommitting, setIsCommitting] = useState(false);
  const [isDiscardingAll, setIsDiscardingAll] = useState(false);
  const [confirmDiscardAllVisible, setConfirmDiscardAllVisible] = useState(false);
  const [remoteOids, setRemoteOids] = useState<Set<string>>(new Set());
  const [workspaceMenuVisible, setWorkspaceMenuVisible] = useState(false);

  const commitsData = useMemo(() => {
    if (uncommittedChanges.length === 0) return commits;
    return [
      {
        oid: '',
        message: t('GitHistory.UncommittedCount', { count: uncommittedChanges.length }),
        authorName: t('GitHistory.Uncommitted'),
        authorEmail: '',
        timestamp: Date.now(),
        parentOids: commits.length > 0 ? [commits[0].oid] : [],
      } satisfies IGitCommitInfo,
      ...commits,
    ];
  }, [commits, uncommittedChanges.length, t]);

  const relatedWorkspaces = useMemo(() => {
    if (wiki === undefined) return [] as IWikiWorkspace[];
    return getRelatedWikiWorkspaces(wiki, workspaces);
  }, [wiki, workspaces]);

  const refreshUncommitted = async () => {
    if (wiki === undefined) return;
    const uncommittedStartAt = Date.now();
    setLoadingUncommitted(true);
    console.log(`${new Date().toISOString()} [WikiChanges] loading uncommitted changes for ${wiki.id}`);
    const allChanges = await gitDiffChangedFiles(wiki);
    const uncommitted = allChanges.map(change => ({ ...change, workspace: wiki }));

    setUncommittedChanges(uncommitted);
    setLoadingUncommitted(false);
    console.log(`${new Date().toISOString()} [WikiChanges] uncommitted changes loaded in ${Date.now() - uncommittedStartAt}ms, count=${uncommitted.length}`);
  };

  useEffect(() => {
    if (wiki === undefined) {
      setCommits([]);
      return;
    }
    void (async () => {
      const historyStartAt = Date.now();
      setLoadingHistory(true);
      console.log(`${new Date().toISOString()} [WikiChanges] loading commit history for ${wiki.id}`);
      const [result, remotes] = await Promise.all([
        gitGetCommitHistory(wiki, 120),
        gitGetRemoteOids(wiki, 300),
      ]);
      setCommits(result);
      setRemoteOids(remotes);
      setLoadingHistory(false);
      console.log(`${new Date().toISOString()} [WikiChanges] commit history loaded in ${Date.now() - historyStartAt}ms, count=${result.length}, remoteOids=${remotes.size}`);
    })();
  }, [wiki?.id]);

  useEffect(() => {
    if (wiki === undefined) return;
    setSelectedCommit(undefined);
    setSelectedFilePath(undefined);
    setFilePreviewVisible(false);
    setChangedFiles([]);
    setWorkspaceMenuVisible(false);
    void refreshUncommitted();
  }, [wiki?.id]);

  const openFilePreview = async (
    filePath: string,
    type: 'add' | 'modify' | 'delete',
    commit?: IGitCommitInfo,
    targetWorkspace?: IWikiWorkspace,
  ) => {
    const workspaceForFile = targetWorkspace ?? wiki;
    if (workspaceForFile === undefined) return;
    setSelectedFilePath(filePath);
    setFilePreviewVisible(true);
    setLoadingFilePreview(true);
    if (commit) {
      const parentReference = commit.parentOids[0];
      const before = type === 'add' ? { kind: 'missing' as const } : await gitGetFileContentAtReference(workspaceForFile, filePath, parentReference);
      const after = type === 'delete' ? { kind: 'missing' as const } : await gitGetFileContentAtReference(workspaceForFile, filePath, commit.oid);
      console.log(
        `[FilePreview] commit ${commit.oid.substring(0, 8)} file=${filePath} before.kind=${before.kind} after.kind=${after.kind} afterTextLen=${
          'text' in after ? after.text?.length : 'N/A'
        }`,
      );
      setBeforeContent(before);
      setAfterContent(after);
    } else {
      const headReference = await gitResolveReference(workspaceForFile, 'HEAD');
      const before = type === 'add' ? { kind: 'missing' as const } : await gitGetFileContentAtReference(workspaceForFile, filePath, headReference);
      const after = type === 'delete' ? { kind: 'missing' as const } : await gitGetFileContentAtReference(workspaceForFile, filePath, undefined);
      console.log(`[FilePreview] uncommitted file=${filePath} before.kind=${before.kind} after.kind=${after.kind} afterTextLen=${'text' in after ? after.text?.length : 'N/A'}`);
      setBeforeContent(before);
      setAfterContent(after);
    }
    setLoadingFilePreview(false);
  };

  if (id === undefined || wiki === undefined) {
    return (
      <ModalContainer>
        <Text>{t('EditWorkspace.NotFound')}</Text>
      </ModalContainer>
    );
  }

  return (
    <ModalContainer>
      {relatedWorkspaces.length > 1 && (
        <WorkspaceSelectorRow>
          <Text variant='labelLarge'>{t('GitHistory.Workspace', '工作区')}</Text>
          <Menu
            visible={workspaceMenuVisible}
            onDismiss={() => {
              setWorkspaceMenuVisible(false);
            }}
            anchor={
              <WorkspaceSelectorButton
                $borderColor={theme.colors.outline}
                testID='workspace-changes-workspace-selector'
                onPress={() => {
                  setWorkspaceMenuVisible(true);
                }}
              >
                <WorkspaceSelectorText numberOfLines={1}>{wiki.name}</WorkspaceSelectorText>
                <Ionicons name='chevron-down' size={22} color={theme.colors.primary} />
              </WorkspaceSelectorButton>
            }
          >
            {relatedWorkspaces.map(relatedWorkspace => (
              <Menu.Item
                key={relatedWorkspace.id}
                testID={`workspace-changes-workspace-${relatedWorkspace.id}`}
                leadingIcon={relatedWorkspace.isSubWiki === true ? 'file-tree-outline' : 'home-outline'}
                title={relatedWorkspace.name}
                onPress={() => {
                  setWorkspaceMenuVisible(false);
                  if (relatedWorkspace.id !== wiki.id) onSelectWorkspace?.(relatedWorkspace.id);
                }}
              />
            ))}
          </Menu>
        </WorkspaceSelectorRow>
      )}
      <UncommittedHeader>
        <Text variant='titleMedium'>
          {t('GitHistory.Uncommitted')}
          {uncommittedChanges.length > 0 ? ` (${uncommittedChanges.length})` : ''}
        </Text>
        <HeaderActions>
          {loadingUncommitted && <SmallActivityIndicator />}
          <IconButton
            size={24}
            icon='refresh'
            disabled={loadingUncommitted}
            onPress={() => {
              void refreshUncommitted();
            }}
          />
        </HeaderActions>
      </UncommittedHeader>
      <FilesList
        data={uncommittedChanges}
        keyExtractor={(item) => `uncommitted-${item.workspace.id}-${item.type}-${item.path}`}
        renderItem={({ item }) => (
          <List.Item
            title={item.path}
            description={`${item.type.toUpperCase()} · ${item.workspace.name}`}
            left={(props) => <List.Icon {...props} icon='source-commit-local' />}
            right={(props) => <List.Icon {...props} icon='chevron-right' />}
            onPress={() => {
              setSelectedUncommittedItem(item);
              void openFilePreview(item.path, item.type, undefined, item.workspace);
            }}
          />
        )}
      />

      <UncommittedHeader>
        <Text variant='titleMedium'>{t('GitHistory.Commits')}</Text>
        <HeaderActions>
          {loadingHistory && <SmallActivityIndicator />}
          <IconButton
            size={24}
            icon='refresh'
            disabled={loadingHistory}
            onPress={() => {
              void (async () => {
                const historyStartAt = Date.now();
                setLoadingHistory(true);
                console.log(`${new Date().toISOString()} [WikiChanges] refreshing commit history for ${wiki.id}`);
                const [result, remotes] = await Promise.all([
                  gitGetCommitHistory(wiki, 120),
                  gitGetRemoteOids(wiki, 300),
                ]);
                setCommits(result);
                setRemoteOids(remotes);
                setLoadingHistory(false);
                console.log(`${new Date().toISOString()} [WikiChanges] commit history refreshed in ${Date.now() - historyStartAt}ms, count=${result.length}`);
              })();
            }}
          />
        </HeaderActions>
      </UncommittedHeader>
      <CommitsFlatList
        data={commitsData}
        initialNumToRender={20}
        keyExtractor={(item) => item.oid}
        maxToRenderPerBatch={20}
        removeClippedSubviews
        renderItem={({ item, index }) => (
          <HistoryCard
            testID={item.oid === '' ? 'commit-item-uncommitted' : `commit-item-${index}`}
            onPress={() => {
              setSelectedCommit(item);
              setCurrentTab('details');
              setLoadingDetails(true);
              setDetailsError(undefined);
              setIsShallowSnapshot(false);

              if (item.oid === '') {
                // Fake commit for uncommitted changes
                setChangedFiles(uncommittedChanges);
                setLoadingDetails(false);
                return;
              }

              void (async () => {
                const detailsStartAt = Date.now();
                console.log(`${new Date().toISOString()} [WikiChanges] loading changed files for ${item.oid}`);
                try {
                  const diffResult: IGitCommitFileDiffResult = await gitGetChangedFilesForCommit(wiki, item.oid, item.parentOids[0]);
                  setChangedFiles(diffResult.files);
                  setIsShallowSnapshot(diffResult.isShallowSnapshot);
                  console.log(
                    `${new Date().toISOString()} [WikiChanges] changed files loaded in ${Date.now() - detailsStartAt}ms, count=${diffResult.files.length}, shallow=${
                      String(diffResult.isShallowSnapshot)
                    }`,
                  );
                } catch (error) {
                  setChangedFiles([]);
                  setIsShallowSnapshot(false);
                  setDetailsError((error as Error).message);
                } finally {
                  setLoadingDetails(false);
                }
              })();
            }}
          >
            <Card.Title
              title={item.message.split('\n')[0] || '(no message)'}
              subtitle={`${new Date(item.timestamp).toLocaleString()} · ${item.authorName}`}
              left={(props) =>
                item.oid !== '' && !remoteOids.has(item.oid)
                  ? <Ionicons name='arrow-up-circle-outline' {...props} color={theme.colors.primary} />
                  : <Ionicons name='git-commit' {...props} />}
            />
            <Card.Content>
              <Text variant='bodySmall'>{item.oid.slice(0, 12)}</Text>
            </Card.Content>
          </HistoryCard>
        )}
        windowSize={5}
      />
      <Portal>
        <FullHeightModal
          visible={selectedCommit !== undefined}
          onDismiss={() => {
            setSelectedCommit(undefined);
            setChangedFiles([]);
            setIsShallowSnapshot(false);
            setDetailsError(undefined);
          }}
        >
          <ModalDismissArea
            onPress={() => {
              setSelectedCommit(undefined);
              setChangedFiles([]);
              setIsShallowSnapshot(false);
              setDetailsError(undefined);
            }}
          >
            <DetailsCard
              $backgroundColor={theme.colors.elevation.level2}
              testID='commit-details-card'
              onStartShouldSetResponder={() => true}
            >
              <Card.Title title={t('GitHistory.CommitDetails')} />
              <PaddedCardContent>
                <DetailSegmentedButtons
                  value={currentTab}
                  onValueChange={(value) => {
                    setCurrentTab(value as 'details' | 'actions');
                  }}
                  buttons={[
                    { value: 'details', label: t('GitHistory.Details', '详情') },
                    { value: 'actions', label: t('GitHistory.Actions', '操作') },
                  ]}
                />

                {currentTab === 'details' && (
                  <DetailsContentView>
                    <Text>{selectedCommit?.message}</Text>
                    <Text variant='bodySmall'>{selectedCommit?.authorName} &lt;{selectedCommit?.authorEmail}&gt;</Text>
                    <Text variant='bodySmall'>{selectedCommit?.oid ? new Date(selectedCommit.timestamp).toLocaleString() : ''}</Text>
                    <Text variant='bodySmall'>{selectedCommit?.oid}</Text>
                    <FilesTitleText variant='titleMedium'>
                      {t('GitHistory.Files')} {changedFiles.length > 0 ? `(${changedFiles.length})` : ''}
                    </FilesTitleText>
                    {loadingDetails && <Text>{t('Loading')}</Text>}
                    {!loadingDetails && detailsError && <Text variant='bodySmall'>{detailsError}</Text>}
                    {!loadingDetails && !detailsError && isShallowSnapshot && <Text variant='bodySmall'>{t('GitHistory.ShallowCloneSnapshot')}</Text>}
                    {!loadingDetails && !detailsError && !isShallowSnapshot && changedFiles.length === 0 && <Text>{t('GitHistory.NoFiles')}</Text>}
                    <ModalFilesScrollView>
                      {changedFiles.map((item, index) => (
                        <List.Item
                          key={`${item.type}-${item.path}`}
                          testID={`commit-detail-file-${index}`}
                          title={item.path}
                          description={item.type.toUpperCase()}
                          left={(props) => <List.Icon {...props} icon='file-document-outline' />}
                          onPress={() => {
                            void openFilePreview(item.path, item.type, selectedCommit);
                          }}
                        />
                      ))}
                    </ModalFilesScrollView>
                  </DetailsContentView>
                )}

                {currentTab === 'actions' && (
                  <ActionsView>
                    {selectedCommit?.oid === ''
                      ? (
                        <>
                          <MessageTextInput
                            label={t('GitHistory.CommitMessage', '留言')}
                            value={newCommitMessage}
                            onChangeText={setNewCommitMessage}
                            mode='outlined'
                          />
                          <Button
                            mode='contained'
                            loading={isCommitting}
                            disabled={isCommitting || isDiscardingAll}
                            onPress={() => {
                              setIsCommitting(true);
                              void gitCommit(wiki, newCommitMessage).then(() => {
                                setSelectedCommit(undefined);
                                void refreshUncommitted();
                              }).catch(console.error).finally(() => {
                                setIsCommitting(false);
                              });
                            }}
                          >
                            {t('ContextMenu.BackupNow', '立即提交')}
                          </Button>
                          <Button
                            mode='contained-tonal'
                            buttonColor={theme.colors.errorContainer}
                            loading={isDiscardingAll}
                            disabled={isCommitting || isDiscardingAll}
                            onPress={() => {
                              setConfirmDiscardAllVisible(true);
                            }}
                          >
                            {t('GitHistory.DiscardAll', '全部撤销')}
                          </Button>
                        </>
                      )
                      : (
                        <MutedText variant='bodyMedium'>
                          {t('GitHistory.NoActionsForCommit', '此提交暂无可用操作')}
                        </MutedText>
                      )}
                  </ActionsView>
                )}
              </PaddedCardContent>
            </DetailsCard>
          </ModalDismissArea>
        </FullHeightModal>
        <FullHeightModal
          visible={filePreviewVisible}
          onDismiss={() => {
            setFilePreviewVisible(false);
            setSelectedFilePath(undefined);
            setSelectedUncommittedItem(undefined);
          }}
        >
          <AbsoluteDismissArea
            onPress={() => {
              setFilePreviewVisible(false);
              setSelectedFilePath(undefined);
              setSelectedUncommittedItem(undefined);
            }}
          />
          <PreviewDetailsCard $backgroundColor={theme.colors.elevation.level2} pointerEvents='box-none'>
            <Card.Title title={t('GitHistory.FilePreview')} />
            <Card.Content>
              {loadingFilePreview && <LoadingIndicator />}
              {!loadingFilePreview && selectedFilePath && (
                <GitFilePreviewModal
                  filePath={selectedFilePath}
                  beforeContent={beforeContent}
                  afterContent={afterContent}
                  mode={contentMode}
                  onModeChange={setContentMode}
                  uncommittedWorkspace={selectedUncommittedItem?.workspace}
                  onDiscardSuccess={() => {
                    void refreshUncommitted();
                    setFilePreviewVisible(false);
                    setSelectedFilePath(undefined);
                    setSelectedUncommittedItem(undefined);
                  }}
                />
              )}
            </Card.Content>
          </PreviewDetailsCard>
        </FullHeightModal>
        <Dialog
          visible={confirmDiscardAllVisible}
          onDismiss={() => {
            setConfirmDiscardAllVisible(false);
          }}
        >
          <Dialog.Title>{t('GitHistory.DiscardAll', '全部撤销')}</Dialog.Title>
          <Dialog.Content>
            <Text>{t('GitHistory.DiscardAllConfirm', `确定要撤销所有 ${uncommittedChanges.length} 处未提交的变更吗？此操作不可恢复。`)}</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button
              onPress={() => {
                setConfirmDiscardAllVisible(false);
              }}
            >
              {t('Common.Cancel', '取消')}
            </Button>
            <Button
              textColor={theme.colors.error}
              loading={isDiscardingAll}
              onPress={() => {
                setConfirmDiscardAllVisible(false);
                setIsDiscardingAll(true);
                void Promise.all(
                  uncommittedChanges.map(item => gitDiscardFileChanges(item.workspace, item.path)),
                ).then(() => {
                  setSelectedCommit(undefined);
                  void refreshUncommitted();
                }).catch(console.error).finally(() => {
                  setIsDiscardingAll(false);
                });
              }}
            >
              {t('GitHistory.DiscardChanges', '确认撤销')}
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </ModalContainer>
  );
}

const ModalContainer = styled.View`
  background-color: ${({ theme }) => theme.colors.background};
  padding: 20px;
  height: 100%;
`;
const UncommittedHeader = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
  margin-bottom: 4px;
`;
const WorkspaceSelectorRow = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
`;
const WorkspaceSelectorButton = styled(Pressable)<{ $borderColor: string }>`
  width: 220px;
  height: 48px;
  padding-horizontal: 14px;
  border-width: 1px;
  border-color: ${({ $borderColor }) => $borderColor};
  border-radius: 24px;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
`;
const WorkspaceSelectorText = styled(Text)`
  flex: 1;
  margin-right: 8px;
  text-align: center;
`;
const HistoryCard = styled(Card)`
  margin-top: 8px;
`;
const DetailsCard = styled(Card)<{ $backgroundColor: string }>`
  max-height: 80%;
  background-color: ${({ $backgroundColor }) => $backgroundColor};
`;
const PreviewDetailsCard = styled(Card)<{ $backgroundColor: string }>`
  max-height: 80%;
  align-self: center;
  width: 92%;
  background-color: ${({ $backgroundColor }) => $backgroundColor};
`;
const FullHeightModal = styled(Modal).attrs({
  contentContainerStyle: {
    flex: 1,
    justifyContent: 'center',
  },
})``;
const ModalDismissArea = styled(Pressable)`
  flex: 1;
  justify-content: center;
  padding: 16px;
`;
const AbsoluteDismissArea = styled(Pressable)`
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
`;
const FilesList = styled(FlatList)`
  flex: 1;
  max-height: 80px;
` as typeof FlatList;
const CommitsFlatList = styled(FlatList)`
  flex: 1;
  min-height: 120px;
` as typeof FlatList;
const ModalFilesScrollView = styled(ScrollView)`
  max-height: 300px;
`;

const DetailsContentView = styled(View)`
`;

const LoadingIndicator = styled(ActivityIndicator)`
  margin-top: 10px;
`;

const HeaderActions = styled(View)`
  flex-direction: row;
  align-items: center;
`;

const SmallActivityIndicator = styled(ActivityIndicator).attrs({ size: 'small' })`
  margin-right: 8px;
`;

const PaddedCardContent = styled(Card.Content)`
  padding-top: 4px;
`;

const DetailSegmentedButtons = styled(SegmentedButtons)`
  margin-bottom: 12px;
`;

const FilesTitleText = styled(Text)`
  margin-top: 8px;
`;

const ActionsView = styled(View)`
  gap: 12px;
  padding-vertical: 8px;
`;

const MessageTextInput = styled(TextInput)`
  margin-bottom: 16px;
`;
const MutedText = styled(Text)`
  color: ${({ theme }) => theme.colors.outline};
`;
