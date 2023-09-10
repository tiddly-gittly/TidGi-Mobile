import { Picker } from '@react-native-picker/picker';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Text } from 'react-native-paper';
import { styled } from 'styled-components/native';

import { WikiUpdateList } from '../../components/WikiUpdateList';
import { useServerStore } from '../../store/server';
import { useWorkspaceStore } from '../../store/workspace';

interface WikiEditModalProps {
  id: string | undefined;
  onClose: () => void;
}

export function WikiChangesModelContent({ id, onClose }: WikiEditModalProps): JSX.Element {
  const { t } = useTranslation();
  const wiki = useWorkspaceStore(state => id === undefined ? undefined : state.workspaces.find(w => w.id === id));
  const availableServersToPick = useServerStore(state =>
    Object.entries(state.servers).filter(([id]) => wiki?.syncedServers?.map(item => item.serverID)?.includes?.(id)).map(([id, server]) => {
      const lastSync = wiki?.syncedServers?.find(item => item.serverID === id)?.lastSync;
      return ({
        id,
        label: `${server.name} (${lastSync === undefined ? '-' : new Date(lastSync).toLocaleString()})`,
      });
    })
  );
  const [serverIDToView, setServerIDToView] = useState<string | undefined>(availableServersToPick[0]?.id);

  const [lastSyncToFilterLogs, setLastSyncToFilterLogs] = useState<Date | undefined>();
  useEffect(() => {
    const lastSync = wiki?.syncedServers?.find(item => item.serverID === serverIDToView)?.lastSync;
    setLastSyncToFilterLogs(lastSync === undefined ? new Date(0) : new Date(lastSync));
  }, [serverIDToView, wiki?.syncedServers]);

  if (id === undefined || wiki === undefined) {
    return (
      <ModalContainer>
        <Text>{t('EditWorkspace.NotFound')}</Text>
      </ModalContainer>
    );
  }

  return (
    <ModalContainer>
      <Picker
        selectedValue={serverIDToView ?? 'all'}
        onValueChange={(itemValue) => {
          if (itemValue === 'all') {
            setServerIDToView(undefined);
          } else {
            setServerIDToView(itemValue);
          }
        }}
      >
        {availableServersToPick.map((server) => <Picker.Item key={server.id} label={server.label} value={server.id} />)}
        <Picker.Item key='all' label={t('All')} value='all' />
      </Picker>
      <Button onPress={onClose}>{t('Menu.Close')}</Button>
      <WikiUpdateList wiki={wiki} lastSyncDate={lastSyncToFilterLogs} />
    </ModalContainer>
  );
}

const ModalContainer = styled.View`
  background-color: white;
  padding: 20px;
`;
