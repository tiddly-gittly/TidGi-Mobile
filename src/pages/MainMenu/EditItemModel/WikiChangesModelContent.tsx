import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList } from 'react-native';
import { ActivityIndicator, Button, Card, List, Modal, Portal, Text } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { useShallow } from 'zustand/react/shallow';
import {
  gitDiffChangedFiles,
  gitDiscardFileChanges,
  gitGetChangedFilesForCommit,
  gitGetCommitHistory,
  gitGetFileContentAtReference,
  gitResolveReference,
  IGitCommitInfo,
  IGitFileContent,
} from '../../../services/GitService';
import { IWikiWorkspace, useWorkspaceStore } from '../../../store/workspace';
import { GitFilePreviewModal } from './GitFilePreviewModal';
interface ModalProps {
  id: string | undefined;
  onClose: () => void;
}

export function WikiChangesModelContent({ id, onClose }: ModalProps): JSX.Element {
  const { t } = useTranslation();

  // Use useShallow + useMemo to avoid re-renders from .find() recreation
  const workspaces = useWorkspaceStore(useShallow(state => state.workspaces));
  const wiki = useMemo(
    () => id === undefined ? undefined : workspaces.find((w): w is IWikiWorkspace => w.id === id && (w.type === undefined || w.type === 'wiki')),
    [id, workspaces],
  );
  const [commits, setCommits] = useState<IGitCommitInfo[]>([]);
  const [uncommittedChanges, setUncommittedChanges] = useState<Array<{ path: string; type: 'add' | 'modify' | 'delete' }>>([]);
  const [selectedCommit, setSelectedCommit] = useState<IGitCommitInfo | undefined>();
  const [selectedFilePath, setSelectedFilePath] = useState<string | undefined>();
  const [filePreviewVisible, setFilePreviewVisible] = useState(false);
  const [changedFiles, setChangedFiles] = useState<Array<{ path: string; type: 'add' | 'modify' | 'delete' }>>([]);
  const [beforeContent, setBeforeContent] = useState<IGitFileContent>({ kind: 'missing' });
  const [afterContent, setAfterContent] = useState<IGitFileContent>({ kind: 'missing' });
  const [contentMode, setContentMode] = useState<'diff' | 'full'>('diff');
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loadingFilePreview, setLoadingFilePreview] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [discardingFile, setDiscardingFile] = useState<string | undefined>();

  const refreshUncommitted = async () => {
    if (wiki === undefined) return;
    const uncommitted = await gitDiffChangedFiles(wiki);
    setUncommittedChanges(uncommitted);
  };

  useEffect(() => {
    if (wiki === undefined) {
      setCommits([]);
      return;
    }
    void (async () => {
      setLoadingHistory(true);
      const result = await gitGetCommitHistory(wiki, 120);
      setCommits(result);
      const uncommitted = await gitDiffChangedFiles(wiki);
      setUncommittedChanges(uncommitted);
      setLoadingHistory(false);
    })();
  }, [wiki?.id]);

  const openFilePreview = async (filePath: string, type: 'add' | 'modify' | 'delete', commit?: IGitCommitInfo) => {
    if (wiki === undefined) return;
    setSelectedFilePath(filePath);
    setFilePreviewVisible(true);
    setLoadingFilePreview(true);
    if (commit) {
      const parentReference = commit.parentOids[0];
      const before = type === 'add' ? { kind: 'missing' as const } : await gitGetFileContentAtReference(wiki, filePath, parentReference);
      const after = type === 'delete' ? { kind: 'missing' as const } : await gitGetFileContentAtReference(wiki, filePath, commit.oid);
      setBeforeContent(before);
      setAfterContent(after);
    } else {
      const headReference = await gitResolveReference(wiki, 'HEAD');
      const before = type === 'add' ? { kind: 'missing' as const } : await gitGetFileContentAtReference(wiki, filePath, headReference);
      const after = type === 'delete' ? { kind: 'missing' as const } : await gitGetFileContentAtReference(wiki, filePath, undefined);
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
            setLoadingHistory(true);
            const result = await gitGetCommitHistory(wiki, 120);
            setCommits(result);
            const uncommitted = await gitDiffChangedFiles(wiki);
            setUncommittedChanges(uncommitted);
            setLoadingHistory(false);
          })();
        }}
      >
        {t('GitHistory.Refresh')}
      </Button>
      {loadingHistory && <LoadingIndicator />}

      <Text variant='titleMedium'>{t('GitHistory.Uncommitted')}</Text>
      <FilesList
        data={uncommittedChanges}
        keyExtractor={(item) => `uncommitted-${item.type}-${item.path}`}
        renderItem={({ item }) => (
          <List.Item
            title={item.path}
            description={item.type.toUpperCase()}
            left={(props) => <List.Icon {...props} icon='source-commit-local' />}
            right={(props) => (
              <Button
                {...props}
                mode='text'
                compact
                loading={discardingFile === item.path}
                disabled={discardingFile !== undefined}
                icon='undo-variant'
                onPress={() => {
                  setDiscardingFile(item.path);
                  void gitDiscardFileChanges(wiki, item.path)
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
              void openFilePreview(item.path, item.type);
            }}
          />
        )}
      />

      <Text variant='titleMedium'>{t('GitHistory.Commits')}</Text>
      <FlatList
        data={commits}
        keyExtractor={(item) => item.oid}
        renderItem={({ item }) => (
          <HistoryCard
            onPress={() => {
              setSelectedCommit(item);
              setLoadingDetails(true);
              void (async () => {
                const files = await gitGetChangedFilesForCommit(wiki, item.oid, item.parentOids[0]);
                setChangedFiles(files);
                setLoadingDetails(false);
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
      />
      <Portal>
        <Modal
          visible={selectedCommit !== undefined}
          onDismiss={() => {
            setSelectedCommit(undefined);
            setChangedFiles([]);
          }}
        >
          <DetailsCard>
            <Card.Title title={t('GitHistory.CommitDetails')} />
            <Card.Content>
              <Text>{selectedCommit?.message}</Text>
              <Text variant='bodySmall'>{selectedCommit?.authorName} &lt;{selectedCommit?.authorEmail}&gt;</Text>
              <Text variant='bodySmall'>{selectedCommit ? new Date(selectedCommit.timestamp).toLocaleString() : ''}</Text>
              <Text variant='bodySmall'>{selectedCommit?.oid}</Text>
              <Text variant='titleMedium'>{t('GitHistory.Files')}</Text>
              {loadingDetails && <Text>{t('Loading')}</Text>}
              {
                /* When a commit has parents but files is empty, it means the parent is not in
                  the local repo (shallow clone with depth:1). Show an informational note. */
              }
              {!loadingDetails && changedFiles.length === 0 && selectedCommit !== undefined && selectedCommit.parentOids.length > 0 && (
                <Text variant='bodySmall'>{t('GitHistory.ShallowCloneSnapshot')}</Text>
              )}
              {!loadingDetails && changedFiles.length === 0 && (selectedCommit === undefined || selectedCommit.parentOids.length === 0) && <Text>{t('GitHistory.NoFiles')}</Text>}
              <FilesList
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
            <Card.Actions>
              <Button
                onPress={() => {
                  setSelectedCommit(undefined);
                  setChangedFiles([]);
                }}
              >
                {t('Close')}
              </Button>
            </Card.Actions>
          </DetailsCard>
        </Modal>
        <Modal
          visible={filePreviewVisible}
          onDismiss={() => {
            setFilePreviewVisible(false);
            setSelectedFilePath(undefined);
          }}
        >
          <DetailsCard>
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
            <Card.Actions>
              <Button
                onPress={() => {
                  setFilePreviewVisible(false);
                  setSelectedFilePath(undefined);
                }}
              >
                {t('Close')}
              </Button>
            </Card.Actions>
          </DetailsCard>
        </Modal>
      </Portal>
    </ModalContainer>
  );
}

const ModalContainer = styled.View`
  background-color: #fff;
  padding: 20px;
  height: 100%;
`;
const CloseButton = styled(Button)`
  margin-bottom: 10px;
`;
const HistoryCard = styled(Card)`
  margin-top: 8px;
`;
const DetailsCard = styled(Card)`
  margin: 16px;
  max-height: 85%;
`;
const FilesList = styled(FlatList)`
  max-height: 220px;
` as typeof FlatList;

const LoadingIndicator = styled(ActivityIndicator)`
  margin-top: 10px;
`;
