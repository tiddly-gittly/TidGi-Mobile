/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/* eslint-disable unicorn/no-null */
import { Picker } from '@react-native-picker/picker';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, FlatList } from 'react-native';
import { Button, Text, TextInput } from 'react-native-paper';
import { styled } from 'styled-components/native';

import { IServerInfo, useServerStore } from '../../store/server';
import { IWikiServerSync, useWikiStore } from '../../store/wiki';
import { deleteWikiFile } from '../Config/Developer/useClearAllWikiData';

interface WikiEditModalProps {
  id: string | undefined;
  onClose: () => void;
}

const ServerItemContainer = styled.View`
  flex-direction: row;
  justify-content: space-between;
  padding: 10px;
  border-bottom-width: 1px;
  border-color: #e0e0e0;
`;

const ServerIDText = styled.Text`
  font-size: 16px;
`;

export function WikiEditModalContent({ id, onClose }: WikiEditModalProps): JSX.Element {
  const { t } = useTranslation();
  const wiki = useWikiStore(state => id === undefined ? undefined : state.wikis.find(w => w.id === id));
  const updateWiki = useWikiStore(state => state.update);
  const deleteWiki = useWikiStore(state => state.remove);
  const getServer = useServerStore(state => (id: string) => state.servers[id] as IServerInfo | undefined);
  const availableServersToPick = useServerStore(state => Object.entries(state.servers).map(([id, server]) => ({ id, label: `${server.name} (${server.uri})` })));

  const [editedName, setEditedName] = useState(wiki?.name ?? '');
  const [editedSelectiveSyncFilter, setEditedSelectiveSyncFilter] = useState(wiki?.selectiveSyncFilter ?? '');
  const [editedWikiFolderLocation, setEditedWikiFolderLocation] = useState(wiki?.wikiFolderLocation ?? '');
  const [newServerID, setNewServerID] = useState<string>('');

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
      // TODO: use latest sync time of one of existing server
      const updatedServers = [...wiki.syncedServers, { serverID: newServerID, lastSync: Date.now() }];
      updateWiki(id, {
        syncedServers: updatedServers,
      });
      setNewServerID('');
    }
  };

  const handleRemoveServer = (serverIDToRemoveFromWiki: string) => {
    const updatedServers = wiki.syncedServers.filter(server => server.serverID !== serverIDToRemoveFromWiki);
    updateWiki(id, {
      syncedServers: updatedServers,
    });
  };

  const renderServerItem = ({ item }: { item: IWikiServerSync }) => {
    const server = getServer(item.serverID);
    return (
      <ServerItemContainer>
        <ServerIDText>{item.serverID}</ServerIDText>
        <ServerIDText>{server?.name ?? '-'}</ServerIDText>
        <ServerIDText>{new Date(item.lastSync).toLocaleString()}</ServerIDText>
        <Button
          onPress={() => {
            handleRemoveServer(item.serverID);
          }}
        >
          <Text>{t('Delete')}</Text>
        </Button>
      </ServerItemContainer>
    );
  };

  return (
    <ModalContainer>
      <StyledTextInput label={t('EditWorkspace.Name')} value={editedName} onChangeText={setEditedName} />
      <StyledTextInput label={t('AddWorkspace.SelectiveSyncFilter')} value={editedSelectiveSyncFilter} onChangeText={setEditedSelectiveSyncFilter} />
      <StyledTextInput label={t('AddWorkspace.WorkspaceFolder')} value={editedWikiFolderLocation} onChangeText={setEditedWikiFolderLocation} />

      <FlatList
        data={wiki.syncedServers}
        renderItem={renderServerItem}
        keyExtractor={(item) => item.serverID}
      />

      <Picker
        selectedValue={newServerID}
        onValueChange={(itemValue) => {
          setNewServerID(itemValue);
        }}
      >
        {availableServersToPick.map((server) => <Picker.Item key={server.id} label={server.label} value={server.id} />)}
      </Picker>
      <Button onPress={handleAddServer}>
        <Text>{t('EditWorkspace.AddServer')}</Text>
      </Button>

      <ButtonsContainer>
        <Button onPress={handleSave}>
          <Text>{t('EditWorkspace.Save')}</Text>
        </Button>
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
        <Button onPress={onClose}>{t('Cancel')}</Button>
      </ButtonsContainer>
    </ModalContainer>
  );
}

const ModalContainer = styled.View`
  background-color: white;
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
