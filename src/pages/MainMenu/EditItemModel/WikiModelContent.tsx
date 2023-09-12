/* eslint-disable react-native/no-inline-styles */
/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/* eslint-disable unicorn/no-null */
import { Picker } from '@react-native-picker/picker';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Modal } from 'react-native';
import { Button, MD3Colors, Portal, Text, TextInput, useTheme } from 'react-native-paper';
import { styled, ThemeProvider } from 'styled-components/native';

import Collapsible from 'react-native-collapsible';
import { ServerList } from '../../../components/ServerList';
import { backgroundSyncService } from '../../../services/BackgroundSyncService';
import { useServerStore } from '../../../store/server';
import { IWikiWorkspace, useWorkspaceStore } from '../../../store/workspace';
import { deleteWikiFile } from '../../Config/Developer/useClearAllWikiData';
import { AddNewServerModelContent } from '../AddNewServerModelContent';
import { WikiChangesModelContent } from './WikiChangesModelContent';

interface WikiEditModalProps {
  id: string | undefined;
  onClose: () => void;
}

export function WikiEditModalContent({ id, onClose }: WikiEditModalProps): JSX.Element {
  const { t } = useTranslation();
  const theme = useTheme();
  const pickerStyle = { color: theme.colors.onSurface, backgroundColor: theme.colors.surface };
  const wiki = useWorkspaceStore(state =>
    id === undefined ? undefined : state.workspaces.find((w): w is IWikiWorkspace => w.id === id && (w.type === undefined || w.type === 'wiki'))
  );
  const [updateWiki, addServerToWiki, deleteWiki, setServerActive] = useWorkspaceStore(state => [state.update, state.addServer, state.remove, state.setServerActive]);
  const availableServersToPick = useServerStore(state => Object.entries(state.servers).map(([id, server]) => ({ id, label: `${server.name} (${server.uri})` })));

  const [editedName, setEditedName] = useState(wiki?.name ?? '');
  const [editedSelectiveSyncFilter, setEditedSelectiveSyncFilter] = useState(wiki?.selectiveSyncFilter ?? '');
  const [editedWikiFolderLocation, setEditedWikiFolderLocation] = useState(wiki?.wikiFolderLocation ?? '');
  const [newServerID, setNewServerID] = useState<string>('');
  const [addServerModelVisible, setAddServerModelVisible] = useState(false);
  const [wikiChangeLogModelVisible, setWikiChangeLogModelVisible] = useState(false);
  const [expandServerList, setExpandServerList] = useState(false);
  const [inSyncing, setInSyncing] = useState(false);
  const [isSyncSucceed, setIsSyncSucceed] = useState<boolean | undefined>(undefined);
  const [currentOnlineServerToSync, setCurrentOnlineServerToSync] = useState<undefined | Awaited<ReturnType<typeof backgroundSyncService.getOnlineServerForWiki>>>();
  useEffect(() => {
    if (wiki === undefined) return;
    void backgroundSyncService.getOnlineServerForWiki(wiki, true).then(server => {
      setCurrentOnlineServerToSync(server);
    });
  }, [wiki]);

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

  const handleAddServer = () => {
    if (newServerID) {
      addServerToWiki(id, newServerID);
      setNewServerID('');
    }
  };

  const handleRemoveServer = (serverIDToRemoveFromWiki: string) => {
    const updatedServers = wiki.syncedServers.filter(server => server.serverID !== serverIDToRemoveFromWiki);
    updateWiki(id, {
      syncedServers: updatedServers,
    });
  };

  return (
    <ModalContainer>
      <StyledTextInput label={t('EditWorkspace.Name')} value={editedName} onChangeText={setEditedName} />
      <StyledTextInput label={t('AddWorkspace.SelectiveSyncFilter')} value={editedSelectiveSyncFilter} onChangeText={setEditedSelectiveSyncFilter} />
      <StyledTextInput label={t('AddWorkspace.WorkspaceFolder')} value={editedWikiFolderLocation} onChangeText={setEditedWikiFolderLocation} />

      <Button
        mode='outlined'
        disabled={inSyncing}
        loading={inSyncing}
        buttonColor={isSyncSucceed === undefined ? undefined : (isSyncSucceed ? MD3Colors.secondary80 : MD3Colors.error80)}
        onPress={async () => {
          setInSyncing(true);
          try {
            const server = await backgroundSyncService.getOnlineServerForWiki(wiki, true);
            if (server !== undefined) {
              await backgroundSyncService.syncWikiWithServer(wiki, server);
              setIsSyncSucceed(true);
            }
          } catch {
            setIsSyncSucceed(false);
          } finally {
            setInSyncing(false);
          }
        }}
      >
        <Text>{currentOnlineServerToSync?.name ?? 'x'} {t('ContextMenu.SyncNow')}</Text>
      </Button>

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
            Alert.alert(
              t('ConfirmDelete'),
              t('ConfirmDeleteDescription'),
              [
                {
                  text: t('EditWorkspace.Cancel'),
                  onPress: () => {},
                  style: 'cancel',
                },
                {
                  text: t('Delete'),
                  onPress: () => {
                    handleRemoveServer(server.id);
                  },
                },
              ],
            );
          }}
        />
        <Picker
          style={pickerStyle}
          selectedValue={newServerID}
          onValueChange={(itemValue) => {
            setNewServerID(itemValue);
          }}
        >
          {availableServersToPick.map((server) => <Picker.Item key={server.id} label={server.label} value={server.id} style={pickerStyle} />)}
        </Picker>
        <Button onPress={handleAddServer}>
          <Text>{t('EditWorkspace.AddSelectedServer')}</Text>
        </Button>
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
