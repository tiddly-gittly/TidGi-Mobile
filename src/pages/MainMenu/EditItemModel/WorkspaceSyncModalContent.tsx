import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, Modal, Portal, Text } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { IWikiWorkspace, useWorkspaceStore } from '../../../store/workspace';
import { WikiChangesModelContent } from './WikiChangesModelContent';

interface IWorkspaceSyncModalContentProps {
  workspace: IWikiWorkspace;
  onClose: () => void;
}

export function WorkspaceSyncModalContent({ workspace, onClose }: IWorkspaceSyncModalContentProps): React.JSX.Element {
  const { t } = useTranslation();
  const update = useWorkspaceStore(state => state.update);
  const [changesModalVisible, setChangesModalVisible] = useState(false);

  const lastSyncTimestamp = useMemo(() => {
    const syncedServers = workspace.syncedServers;
    if (syncedServers.length === 0) return undefined;
    return Math.max(...syncedServers.map(item => item.lastSync));
  }, [workspace.syncedServers]);

  return (
    <Container>
      <Text variant='titleLarge'>{t('Sync.WorkspaceSync')}</Text>
      <Text variant='bodyMedium'>
        {t('Sync.LastSync')}: {lastSyncTimestamp ? new Date(lastSyncTimestamp).toLocaleString() : '-'}
      </Text>

      {!workspace.isSubWiki && (
        <Checkbox.Item
          label={t('Sync.IncludeSubWikis')}
          status={workspace.syncIncludeSubWikis !== false ? 'checked' : 'unchecked'}
          onPress={() => {
            update(workspace.id, { syncIncludeSubWikis: workspace.syncIncludeSubWikis === false });
          }}
        />
      )}

      <Button
        mode='outlined'
        onPress={() => {
          setChangesModalVisible(true);
        }}
      >
        {t('AddWorkspace.OpenChangeLogList')}
      </Button>

      <Button mode='text' onPress={onClose}>{t('Close')}</Button>

      <Portal>
        <Modal
          visible={changesModalVisible}
          onDismiss={() => {
            setChangesModalVisible(false);
          }}
        >
          <WikiChangesModelContent
            id={workspace.id}
            onClose={() => {
              setChangesModalVisible(false);
            }}
          />
        </Modal>
      </Portal>
    </Container>
  );
}

const Container = styled.View`
  background-color: #fff;
  margin: 16px;
  padding: 16px;
  max-height: 92%;
`;
