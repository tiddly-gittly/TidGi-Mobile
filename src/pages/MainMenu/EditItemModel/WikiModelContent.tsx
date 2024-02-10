/* eslint-disable react-native/no-inline-styles */
/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/* eslint-disable unicorn/no-null */
import * as Haptics from 'expo-haptics';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';
import { Button, Modal, Portal, Text, TextInput, useTheme } from 'react-native-paper';
import { styled, ThemeProvider } from 'styled-components/native';

import Collapsible from 'react-native-collapsible';
import { ServerList } from '../../../components/ServerList';
import { SyncTextButton } from '../../../components/SyncButton';
import { backgroundSyncService } from '../../../services/BackgroundSyncService';
import { useServerStore } from '../../../store/server';
import { IWikiWorkspace, useWorkspaceStore } from '../../../store/workspace';
import { deleteWikiFile } from '../../Config/Developer/useClearAllWikiData';
import { ServerEditModalContent } from '../../Config/ServerAndSync/ServerEditModal';
import { AddNewServerModelContent } from '../AddNewServerModelContent';
import { PerformanceToolsModelContent } from './PerformanceToolsModelContent';
import { WikiChangesModelContent } from './WikiChangesModelContent';

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
  const [updateWiki, deleteWiki, setServerActive] = useWorkspaceStore(state => [state.update, state.remove, state.setServerActive]);

  const [editedName, setEditedName] = useState(wiki?.name ?? '');
  const [editedSelectiveSyncFilter, setEditedSelectiveSyncFilter] = useState(wiki?.selectiveSyncFilter ?? '');
  const [editedWikiFolderLocation, setEditedWikiFolderLocation] = useState(wiki?.wikiFolderLocation ?? '');
  const [selectedServerID, setSelectedServerID] = useState<string | undefined>();
  const [serverModalVisible, setServerModalVisible] = useState(false);
  const [addServerModelVisible, setAddServerModelVisible] = useState(false);
  const [wikiChangeLogModelVisible, setWikiChangeLogModelVisible] = useState(false);
  const [performanceToolsModelVisible, setPerformanceToolsModelVisible] = useState(false);
  const [expandServerList, setExpandServerList] = useState(false);

  if (id === undefined || wiki === undefined) {
    return (
      <ModalContainer>
        <Text>{t('EditWorkspace.NotFound')}</Text>
      </ModalContainer>
    );
  }

  const handleSave = () => {
    updateWiki(id, {
      name: editedName,
      selectiveSyncFilter: editedSelectiveSyncFilter,
    });
    onClose();
  };

  return (
    <ModalContainer>
      <StyledTextInput label={t('EditWorkspace.Name')} value={editedName} onChangeText={setEditedName} />
      <StyledTextInput label={t('AddWorkspace.SelectiveSyncFilter')} value={editedSelectiveSyncFilter} onChangeText={setEditedSelectiveSyncFilter} />
      <StyledTextInput label={t('AddWorkspace.WorkspaceFolder')} value={editedWikiFolderLocation} onChangeText={setEditedWikiFolderLocation} />

      <SyncTextButton workspaceID={id} />
      <Button
        mode='text'
        onPress={() => {
          void backgroundSyncService.updateServerOnlineStatus();
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

      <Button
        mode='text'
        onPress={() => {
          setWikiChangeLogModelVisible(!wikiChangeLogModelVisible);
        }}
      >
        <Text>{t('AddWorkspace.OpenChangeLogList')}</Text>
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
        <Button onPress={onClose}>{t('Cancel')}</Button>
        <Button
          onPress={() => {
            Alert.alert(
              t('ConfirmDelete'),
              t('ConfirmDeleteDescription'),
              [
                {
                  text: t('Cancel'),
                  onPress: () => {},
                  style: 'cancel',
                },
                {
                  text: t('Delete'),
                  onPress: async () => {
                    await deleteWikiFile(wiki);
                    deleteWiki(id);
                    onClose();
                  },
                },
              ],
            );
          }}
        >
          {t('Delete')}
        </Button>
        <Button onPress={handleSave}>
          <Text>{t('EditWorkspace.Save')}</Text>
        </Button>
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
            visible={wikiChangeLogModelVisible}
            onDismiss={() => {
              setWikiChangeLogModelVisible(false);
            }}
          >
            <WikiChangesModelContent
              id={id}
              onClose={() => {
                setWikiChangeLogModelVisible(false);
              }}
            />
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
        </ThemeProvider>
      </Portal>
    </ModalContainer>
  );
}

const ModalContainer = styled.View`
  background-color: ${({ theme }) => theme.colors.background};
  padding: 20px;
`;

const StyledTextInput = styled(TextInput)`
  margin-bottom: 10px;
`;

const ButtonsContainer = styled.View`
  flex-direction: row;
  justify-content: space-between;
  margin-top: 15px;
`;
