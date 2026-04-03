import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, Text } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { IWikiWorkspace, useWorkspaceStore } from '../../../store/workspace';

interface IWorkspaceSyncModalContentProps {
  onOpenChanges?: () => void;
  workspace: IWikiWorkspace;
  showCloseButton?: boolean;
  onClose: () => void;
}

export function WorkspaceSyncModalContent({ workspace, onClose, showCloseButton = true, onOpenChanges }: IWorkspaceSyncModalContentProps): React.JSX.Element {
  const { t } = useTranslation();
  const update = useWorkspaceStore(state => state.update);

  const lastSyncTimestamp = useMemo(() => {
    const syncedServers = workspace.syncedServers;
    if (syncedServers.length === 0) return undefined;
    return Math.max(...syncedServers.map(item => item.lastSync));
  }, [workspace.syncedServers]);

  return (
    <Container>
      <Text variant='titleLarge'>{t('Sync.WorkspaceSync')}</Text>
      <Text variant='bodyMedium' testID='last-sync-label'>
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
          onOpenChanges?.();
        }}
      >
        {t('AddWorkspace.OpenChangeLogList')}
      </Button>

      {showCloseButton && <Button mode='text' onPress={onClose}>{t('Close')}</Button>}
    </Container>
  );
}

const Container = styled.View`
  background-color: ${({ theme }) => theme.colors.background};
  margin: 16px;
  padding: 16px;
  max-height: 92%;
`;
