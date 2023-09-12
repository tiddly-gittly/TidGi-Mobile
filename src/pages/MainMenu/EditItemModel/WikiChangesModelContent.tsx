import { Picker } from '@react-native-picker/picker';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Text, useTheme } from 'react-native-paper';
import { styled } from 'styled-components/native';

import { WikiUpdateList } from '../../../components/WikiUpdateList';
import { useServerStore } from '../../../store/server';
import { IWikiWorkspace, useWorkspaceStore } from '../../../store/workspace';

interface WikiEditModalProps {
  id: string | undefined;
  onClose: () => void;
}

export function WikiChangesModelContent({ id, onClose }: WikiEditModalProps): JSX.Element {
  const { t } = useTranslation();
  const theme = useTheme();
  const pickerStyle = { color: theme.colors.onSurface, backgroundColor: theme.colors.surface };

  const wiki = useWorkspaceStore(state =>
    id === undefined ? undefined : state.workspaces.find((w): w is IWikiWorkspace => w.id === id && (w.type === undefined || w.type === 'wiki'))
  );
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
      <CloseButton mode='outlined' onPress={onClose}>{t('Menu.Close')}</CloseButton>
      <Picker
        selectionColor={theme.colors.primary}
        style={pickerStyle}
        selectedValue={serverIDToView ?? 'all'}
        onValueChange={(itemValue) => {
          if (itemValue === 'all') {
            setServerIDToView(undefined);
          } else {
            setServerIDToView(itemValue);
          }
        }}
      >
        {availableServersToPick.map((server) => <Picker.Item key={server.id} label={server.label} value={server.id} style={pickerStyle} />)}
        <Picker.Item key='all' label={t('All')} value='all' style={pickerStyle} />
      </Picker>
      <WikiUpdateList wiki={wiki} lastSyncDate={lastSyncToFilterLogs} />
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
