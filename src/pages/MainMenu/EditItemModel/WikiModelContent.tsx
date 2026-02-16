import * as Haptics from 'expo-haptics';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';
import { Button, Modal, Portal, Text, TextInput, useTheme } from 'react-native-paper';
import { styled, ThemeProvider } from 'styled-components/native';
import { useShallow } from 'zustand/react/shallow';

import Collapsible from 'react-native-collapsible';
import { ServerList } from '../../../components/ServerList';
import { SubWikiManager } from '../../../components/SubWikiManager';
import { SyncTextButton } from '../../../components/SyncButton';
import { gitBackgroundSyncService } from '../../../services/BackgroundSyncService';
import { gitGetUnsyncedCommitCount } from '../../../services/GitService';
import { IWikiWorkspace, useWorkspaceStore } from '../../../store/workspace';
import { deleteWikiFile } from '../../Config/Developer/useClearAllWikiData';
import { ServerEditModalContent } from '../../Config/ServerAndSync/ServerEditModal';
import { WorkspaceSettings } from '../../WikiSettings/WorkspaceSettings';
import { AddNewServerModelContent } from '../AddNewServerModelContent';
import { PerformanceToolsModelContent } from './PerformanceToolsModelContent';
import { WorkspaceSyncModalContent } from './WorkspaceSyncModalContent';

const getUnsyncedCommitCount = gitGetUnsyncedCommitCount as (workspace: IWikiWorkspace) => Promise<number>;

interface WikiEditModalProps {
  id: string | undefined;
  onClose: () => void;
}

export function WikiEditModalContent({ id, onClose }: WikiEditModalProps): JSX.Element {
  const { t } = useTranslation();
  const theme = useTheme();
  const wiki = useWorkspaceStore(state =>
    id === undefined ? undefined : state.workspaces.find((w): w is IWikiWorkspace => w.id === id && (w.type === undefined || w.type === 'wiki'))
  );
  const [updateWiki, deleteWiki, setServerActive] = useWorkspaceStore(useShallow(state => [state.update, state.remove, state.setServerActive]));

  const [editedName, setEditedName] = useState(wiki?.name ?? '');
  const [pendingChangesCount, setPendingChangesCount] = useState(0);
  const [selectedServerID, setSelectedServerID] = useState<string | undefined>();
  const [serverModalVisible, setServerModalVisible] = useState(false);
  const [addServerModelVisible, setAddServerModelVisible] = useState(false);
  const [performanceToolsModelVisible, setPerformanceToolsModelVisible] = useState(false);
  const [expandServerList, setExpandServerList] = useState(false);
  const [workspaceSyncModalVisible, setWorkspaceSyncModalVisible] = useState(false);
  const [workspaceSettingsModalVisible, setWorkspaceSettingsModalVisible] = useState(false);
  const [subWikiManagerModalVisible, setSubWikiManagerModalVisible] = useState(false);
  const [subWikiDetailModalVisible, setSubWikiDetailModalVisible] = useState(false);
  const [selectedSubWikiID, setSelectedSubWikiID] = useState<string | undefined>();

  useEffect(() => {
    if (wiki === undefined) return;
    const idleTask = globalThis.requestIdleCallback;
    if (typeof idleTask === 'function') {
      const idleHandle = idleTask(() => {
        void getUnsyncedCommitCount(wiki).then(setPendingChangesCount);
      });
      return () => {
        if (typeof globalThis.cancelIdleCallback === 'function') {
          globalThis.cancelIdleCallback(idleHandle);
        }
      };
    }

    const timeout = setTimeout(() => {
      void getUnsyncedCommitCount(wiki).then(setPendingChangesCount);
    }, 0);
    return () => {
      clearTimeout(timeout);
    };
  }, [wiki?.id]);

  if (id === undefined || wiki === undefined) {
    return (
      <ModalContainer>
        <Text>{t('EditWorkspace.NotFound')}</Text>
      </ModalContainer>
    );
  }

  return (
    <ModalContainer>
      <StyledTextInput
        label={t('EditWorkspace.Name')}
        value={editedName}
        onChangeText={(editedName) => {
          setEditedName(editedName);
          updateWiki(id, {
            name: editedName,
          });
        }}
      />

      <SyncTextButton workspaceID={id} />
      <Text variant='bodySmall'>{t('Sync.UnsyncedCommitCount', { count: pendingChangesCount })}</Text>
      <Button
        mode='text'
        icon='sync'
        onPress={() => {
          setWorkspaceSyncModalVisible(true);
        }}
      >
        <Text>{t('Sync.WorkspaceSync')}</Text>
      </Button>
      <Button
        mode='text'
        onPress={() => {
          void gitBackgroundSyncService.updateServerOnlineStatus();
          setExpandServerList(!expandServerList);
        }}
      >
        <Text>{t('AddWorkspace.ToggleServerList')}</Text>
      </Button>
      <Collapsible collapsed={!expandServerList}>
        <ServerList
          serverIDs={wiki.syncedServers.map(server => server.serverID)}
          activeIDs={wiki.syncedServers.filter(serverInfoInWiki => serverInfoInWiki.syncActive).map(server => server.serverID)}
          onPress={(server) => {
            const serverInWiki = wiki.syncedServers.find(serverInfoInWiki => serverInfoInWiki.serverID === server.id);
            if (serverInWiki !== undefined) {
              setServerActive(id, server.id, !serverInWiki.syncActive);
            }
          }}
          onLongPress={(server) => {
            void Haptics.selectionAsync();
            setSelectedServerID(server.id);
            setServerModalVisible(true);
          }}
        />
        <Button
          onPress={() => {
            setAddServerModelVisible(true);
          }}
        >
          <Text>{t('EditWorkspace.AddNewServer')}</Text>
        </Button>
      </Collapsible>

      {/* Workspace Settings Button */}
      <Button
        mode='text'
        icon='cog'
        onPress={() => {
          setWorkspaceSettingsModalVisible(true);
        }}
      >
        <Text>{t('WorkspaceSettings.Title')}</Text>
      </Button>

      {/* Sub-wiki Management */}
      <Button
        mode='text'
        icon='file-tree'
        onPress={() => {
          setSubWikiManagerModalVisible(true);
        }}
      >
        <Text>{t('SubWiki.ManageSubKnowledgeBases')}</Text>
      </Button>

      <Button
        mode='text'
        onPress={() => {
          setPerformanceToolsModelVisible(!performanceToolsModelVisible);
        }}
      >
        <Text>{t('AddWorkspace.OpenPerformanceTools')}</Text>
      </Button>

      <ButtonsContainer>
        <Button
          onPress={() => {
            Alert.alert(
              t('ConfirmDelete'),
              t('ConfirmDeleteDescription'),
              [
                {
                  text: t('Delete'),
                  onPress: () => {
                    deleteWikiFile(wiki);
                    deleteWiki(id);
                    onClose();
                  },
                },
                {
                  text: t('Cancel'),
                  onPress: () => {},
                  style: 'cancel',
                },
              ],
            );
          }}
        >
          {t('Delete')}
        </Button>
        <Button onPress={onClose}>{t('Close')}</Button>
      </ButtonsContainer>
      <Portal>
        <ThemeProvider theme={theme}>
          <Modal
            visible={addServerModelVisible}
            onDismiss={() => {
              setAddServerModelVisible(false);
            }}
          >
            <AddNewServerModelContent
              id={id}
              onClose={() => {
                setAddServerModelVisible(false);
              }}
            />
          </Modal>
          <Modal
            visible={workspaceSyncModalVisible}
            onDismiss={() => {
              setWorkspaceSyncModalVisible(false);
            }}
          >
            {workspaceSyncModalVisible && (
              <PanelModalContainer>
                <WorkspaceSyncModalContent
                  workspace={wiki}
                  onClose={() => {
                    setWorkspaceSyncModalVisible(false);
                  }}
                />
              </PanelModalContainer>
            )}
          </Modal>
          <Modal
            visible={performanceToolsModelVisible}
            onDismiss={() => {
              setPerformanceToolsModelVisible(false);
            }}
          >
            <PerformanceToolsModelContent
              id={id}
              onClose={() => {
                setPerformanceToolsModelVisible(false);
              }}
            />
          </Modal>
          <Modal
            visible={serverModalVisible}
            onDismiss={() => {
              setServerModalVisible(false);
            }}
          >
            <ServerEditModalContent
              id={selectedServerID}
              onClose={() => {
                setServerModalVisible(false);
              }}
            />
          </Modal>
          <Modal
            visible={workspaceSettingsModalVisible}
            onDismiss={() => {
              setWorkspaceSettingsModalVisible(false);
            }}
          >
            {workspaceSettingsModalVisible && (
              <PanelModalContainer>
                <WorkspaceSettings workspace={wiki} />
                <Button
                  onPress={() => {
                    setWorkspaceSettingsModalVisible(false);
                  }}
                >
                  {t('Close')}
                </Button>
              </PanelModalContainer>
            )}
          </Modal>
          <Modal
            visible={subWikiManagerModalVisible}
            onDismiss={() => {
              setSubWikiManagerModalVisible(false);
            }}
          >
            {subWikiManagerModalVisible && (
              <PanelModalContainer>
                <SubWikiManager
                  workspace={wiki}
                  onLongPressWorkspace={(subWorkspace: IWikiWorkspace) => {
                    setSelectedSubWikiID(subWorkspace.id);
                    setSubWikiManagerModalVisible(false);
                    setSubWikiDetailModalVisible(true);
                  }}
                />
                <Button
                  onPress={() => {
                    setSubWikiManagerModalVisible(false);
                  }}
                >
                  {t('Close')}
                </Button>
              </PanelModalContainer>
            )}
          </Modal>
          <Modal
            visible={subWikiDetailModalVisible}
            onDismiss={() => {
              setSubWikiDetailModalVisible(false);
            }}
          >
            {subWikiDetailModalVisible && (
              <PanelModalContainer>
                <WikiEditModalContent
                  id={selectedSubWikiID}
                  onClose={() => {
                    setSubWikiDetailModalVisible(false);
                  }}
                />
              </PanelModalContainer>
            )}
          </Modal>
        </ThemeProvider>
      </Portal>
    </ModalContainer>
  );
}

const ModalContainer = styled.View`
  background-color: #fff;
  padding: 20px;
  height: 100%;
`;

const PanelModalContainer = styled.View`
  background-color: #fff;
  margin: 8px;
  padding: 8px;
  height: 95%;
`;

const StyledTextInput = styled(TextInput)`
  margin-bottom: 10px;
`;

const ButtonsContainer = styled.View`
  flex-direction: row;
  justify-content: space-between;
  margin-top: 15px;
`;
