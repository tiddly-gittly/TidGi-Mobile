import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet } from 'react-native';
import { ActivityIndicator, Button, Card, List, Modal, Portal, Text, useTheme } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { useShallow } from 'zustand/react/shallow';
import {
  gitDiffChangedFiles,
  gitDiscardFileChanges,
  gitGetChangedFilesForCommit,
  gitGetCommitHistory,
  gitGetFileContentAtReference,
  gitResolveReference,
  IGitCommitFileDiffResult,
  IGitCommitInfo,
  IGitFileContent,
} from '../../../services/GitService';
import { IWikiWorkspace, useWorkspaceStore } from '../../../store/workspace';
import { GitFilePreviewModal } from './GitFilePreviewModal';
interface ModalProps {
  id: string | undefined;
  onClose: () => void;
}

interface IUncommittedChangeItem {
  path: string;
  type: 'add' | 'modify' | 'delete';
  workspace: IWikiWorkspace;
}

export function WikiChangesModelContent({ id, onClose }: ModalProps): JSX.Element {
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
  const [discardingFile, setDiscardingFile] = useState<string | undefined>();

  const relatedWikisForUncommitted = useMemo(() => {
    if (wiki === undefined) return [] as IWikiWorkspace[];
    if (wiki.isSubWiki === true || wiki.syncIncludeSubWikis === false) return [wiki];
    return workspaces.filter((workspace): workspace is IWikiWorkspace =>
      (workspace.type === undefined || workspace.type === 'wiki') &&
      (workspace.id === wiki.id || workspace.mainWikiID === wiki.id)
    );
  }, [wiki, workspaces]);

  const refreshUncommitted = async () => {
    if (wiki === undefined) return;
    const uncommittedStartAt = Date.now();
    setLoadingUncommitted(true);
    console.log(`${new Date().toISOString()} [WikiChanges] loading uncommitted changes for ${wiki.id} across ${relatedWikisForUncommitted.map(item => item.id).join(',')}`);

    // All sub-wikis share the same git repo as the main wiki.
    // We must call gitDiffChangedFiles on the MAIN wiki (which is the git root),
    // not on sub-wikis (which are subdirectories without their own .git/).
    // Find the main wiki: it's the one that is NOT a sub-wiki.
    const mainWiki = relatedWikisForUncommitted.find(w => w.isSubWiki !== true) ?? wiki;
    console.log(`${new Date().toISOString()} [WikiChanges] using mainWiki=${mainWiki.id} (isSubWiki=${mainWiki.isSubWiki ?? false}) path=${mainWiki.wikiFolderLocation}`);
    const allChanges = await gitDiffChangedFiles(mainWiki);

    // Classify each changed path into the most specific workspace it belongs to.
    const uncommitted: IUncommittedChangeItem[] = [];
    for (const change of allChanges) {
      let bestMatch = mainWiki;
      for (const workspace of relatedWikisForUncommitted) {
        if (workspace.id === mainWiki.id) continue;
        // Sub-wiki tiddlers are under tiddlers/<subwiki-folder>/
        // The change.path is relative to the git root (= main wiki dir)
        const subFolderName = workspace.wikiFolderLocation.split('/').pop();
        if (subFolderName && change.path.startsWith(`tiddlers/${subFolderName}/`)) {
          bestMatch = workspace;
          break;
        }
      }
      uncommitted.push({ ...change, workspace: bestMatch });
    }

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
      const result = await gitGetCommitHistory(wiki, 120);
      setCommits(result);
      setLoadingHistory(false);
      console.log(`${new Date().toISOString()} [WikiChanges] commit history loaded in ${Date.now() - historyStartAt}ms, count=${result.length}`);
    })();
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
      console.log(`[FilePreview] commit ${commit.oid?.substring(0, 8)} file=${filePath} before.kind=${before.kind} after.kind=${after.kind} afterTextLen=${'text' in after ? after.text?.length : 'N/A'}`);
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
      <CloseButton mode='outlined' onPress={onClose}>{t('Menu.Close')}</CloseButton>
      <Button
        mode='outlined'
        onPress={() => {
          void (async () => {
            const historyStartAt = Date.now();
            setLoadingHistory(true);
            console.log(`${new Date().toISOString()} [WikiChanges] refreshing commit history for ${wiki.id}`);
            const result = await gitGetCommitHistory(wiki, 120);
            setCommits(result);
            setLoadingHistory(false);
            console.log(`${new Date().toISOString()} [WikiChanges] commit history refreshed in ${Date.now() - historyStartAt}ms, count=${result.length}`);
          })();
        }}
      >
        {t('GitHistory.Refresh')}
      </Button>

      <UncommittedHeader>
        <Text variant='titleMedium'>{t('GitHistory.Uncommitted')}</Text>
        <Button
          mode='outlined'
          compact
          loading={loadingUncommitted}
          onPress={() => {
            void refreshUncommitted();
          }}
        >
          {t('GitHistory.LoadUncommitted')}
        </Button>
      </UncommittedHeader>
      <FilesList
        data={uncommittedChanges}
        keyExtractor={(item) => `uncommitted-${item.workspace.id}-${item.type}-${item.path}`}
        renderItem={({ item }) => (
          <List.Item
            title={relatedWikisForUncommitted.length > 1 ? `[${item.workspace.name}] ${item.path}` : item.path}
            description={`${item.type.toUpperCase()} · ${item.workspace.name}`}
            left={(props) => <List.Icon {...props} icon='source-commit-local' />}
            right={(props) => (
              <Button
                {...props}
                mode='text'
                compact
                loading={discardingFile === `${item.workspace.id}:${item.path}`}
                disabled={discardingFile !== undefined}
                icon='undo-variant'
                onPress={() => {
                  setDiscardingFile(`${item.workspace.id}:${item.path}`);
                  void gitDiscardFileChanges(item.workspace, item.path)
                    .then(() => refreshUncommitted())
                    .catch((error: unknown) => {
                      console.error('Discard failed:', error);
                    })
                    .finally(() => {
                      setDiscardingFile(undefined);
                    });
                }}
              >
                {t('GitHistory.DiscardChanges')}
              </Button>
            )}
            onPress={() => {
              void openFilePreview(item.path, item.type, undefined, item.workspace);
            }}
          />
        )}
      />

      <Text variant='titleMedium'>{t('GitHistory.Commits')}</Text>
      {loadingHistory && <LoadingIndicator />}
      <FlatList
        data={commits}
        initialNumToRender={20}
        keyExtractor={(item) => item.oid}
        maxToRenderPerBatch={20}
        removeClippedSubviews
        renderItem={({ item }) => (
          <HistoryCard
            onPress={() => {
              setSelectedCommit(item);
              setLoadingDetails(true);
              setDetailsError(undefined);
              setIsShallowSnapshot(false);
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
              left={(props) => <Ionicons name='git-commit' {...props} />}
            />
            <Card.Content>
              <Text variant='bodySmall'>{item.oid.slice(0, 12)}</Text>
            </Card.Content>
          </HistoryCard>
        )}
        windowSize={5}
      />
      <Portal>
        <Modal
          contentContainerStyle={styles.modalContentFillContainer}
          visible={selectedCommit !== undefined}
          onDismiss={() => {
            setSelectedCommit(undefined);
            setChangedFiles([]);
            setIsShallowSnapshot(false);
            setDetailsError(undefined);
          }}
        >
          <Pressable
            style={styles.modalDismissArea}
            onPress={() => {
              setSelectedCommit(undefined);
              setChangedFiles([]);
              setIsShallowSnapshot(false);
              setDetailsError(undefined);
            }}
          >
            <DetailsCard style={{ backgroundColor: theme.colors.elevation.level2 }} onStartShouldSetResponder={() => true}>
              <Card.Title title={t('GitHistory.CommitDetails')} />
              <Card.Content style={{ paddingTop: 4 }}>
                <Text>{selectedCommit?.message}</Text>
                <Text variant='bodySmall'>{selectedCommit?.authorName} &lt;{selectedCommit?.authorEmail}&gt;</Text>
                <Text variant='bodySmall'>{selectedCommit ? new Date(selectedCommit.timestamp).toLocaleString() : ''}</Text>
                <Text variant='bodySmall'>{selectedCommit?.oid}</Text>
                <Text variant='titleMedium' style={{ marginTop: 8 }}>{t('GitHistory.Files')}</Text>
                {loadingDetails && <Text>{t('Loading')}</Text>}
                {!loadingDetails && detailsError && <Text variant='bodySmall'>{detailsError}</Text>}
                {
                  /* When a commit has parents but files is empty, it means the parent is not in
                  the local repo (shallow clone with depth:1). Show an informational note. */
                }
                {!loadingDetails && !detailsError && isShallowSnapshot && <Text variant='bodySmall'>{t('GitHistory.ShallowCloneSnapshot')}</Text>}
                {!loadingDetails && !detailsError && !isShallowSnapshot && changedFiles.length === 0 && <Text>{t('GitHistory.NoFiles')}</Text>}
                <ModalFilesList
                  data={changedFiles}
                  keyExtractor={(item) => `${item.type}-${item.path}`}
                  renderItem={({ item }) => (
                    <List.Item
                      title={item.path}
                      description={item.type.toUpperCase()}
                      left={(props) => <List.Icon {...props} icon='file-document-outline' />}
                      onPress={() => {
                        void openFilePreview(item.path, item.type, selectedCommit);
                      }}
                    />
                  )}
                />
              </Card.Content>
            </DetailsCard>
          </Pressable>
        </Modal>
        <Modal
          contentContainerStyle={styles.modalContentFillContainer}
          visible={filePreviewVisible}
          onDismiss={() => {
            setFilePreviewVisible(false);
            setSelectedFilePath(undefined);
          }}
        >
          <Pressable
            style={styles.modalDismissArea}
            onPress={() => {
              setFilePreviewVisible(false);
              setSelectedFilePath(undefined);
            }}
          >
            <DetailsCard style={{ backgroundColor: theme.colors.elevation.level2 }} onStartShouldSetResponder={() => true}>
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
                  />
                )}
              </Card.Content>
            </DetailsCard>
          </Pressable>
        </Modal>
      </Portal>
    </ModalContainer>
  );
}

const ModalContainer = styled.View`
  background-color: ${({ theme }) => theme.colors.background};
  padding: 20px;
  height: 100%;
`;
const CloseButton = styled(Button)`
  margin-bottom: 10px;
`;
const UncommittedHeader = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
  margin-bottom: 4px;
`;
const HistoryCard = styled(Card)`
  margin-top: 8px;
`;
const DetailsCard = styled(Card)`
  max-height: 80%;
  overflow: hidden;
`;
const FilesList = styled(FlatList)`
  max-height: 220px;
` as typeof FlatList;
const ModalFilesList = styled(FlatList)`
  max-height: 450px;
  flex-shrink: 1;
` as typeof FlatList;

const LoadingIndicator = styled(ActivityIndicator)`
  margin-top: 10px;
`;

const styles = StyleSheet.create({
  modalContentFillContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  modalDismissArea: {
    flex: 1,
    justifyContent: 'center',
    padding: 16,
  },
});
