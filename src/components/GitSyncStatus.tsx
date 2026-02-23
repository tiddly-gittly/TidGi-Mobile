/**
 * Git Sync Status UI Component
 * Shows sync progress, conflicts, and allows manual sync
 */

import React, { FC, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { ActivityIndicator, Button, Card, Checkbox, Dialog, Portal, Snackbar, Text } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { gitBackgroundSyncService } from '../services/BackgroundSyncService';
import { IWikiWorkspace, useWorkspaceStore } from '../store/workspace';

const Container = styled(View)`
  padding: 8px;
`;

const StatusCard = styled(Card)`
  margin: 8px 0;
`;

const StatusRow = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
`;

const StatusText = styled(Text)`
  flex: 1;
`;

const ErrorText = styled(Text)`
  color: red;
`;

const SyncButton = styled(Button)`
  flex: 1;
`;

const ConflictBranchText = styled(Text)`
  margin-top: 8px;
  font-family: monospace;
`;

const ConflictInstructionsText = styled(Text)`
  margin-top: 12px;
`;

export interface IGitSyncStatusProps {
  workspace: IWikiWorkspace;
}

export const GitSyncStatus: FC<IGitSyncStatusProps> = ({ workspace }) => {
  const { t } = useTranslation();
  const [syncing, setSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<number | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [showConflictDialog, setShowConflictDialog] = useState(false);
  const [conflictBranch, setConflictBranch] = useState<string | null>(null);
  const [snackbarVisible, setSnackbarVisible] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');
  const updateWorkspace = useWorkspaceStore(state => state.update);
  const includeSubWikis = workspace.syncIncludeSubWikis === true;

  // Get last sync time from workspace
  useEffect(() => {
    if (workspace.syncedServers.length > 0) {
      const syncedServer = workspace.syncedServers[0];
      setLastSyncTime(syncedServer.lastSync);
    }
  }, [workspace]);

  // Handle manual sync
  const handleSync = useCallback(async () => {
    setSyncing(true);
    setSyncError(null);

    try {
      await gitBackgroundSyncService.updateServerOnlineStatus();
      const server = gitBackgroundSyncService.getOnlineServerForWiki(workspace);
      if (server === undefined) {
        setSnackbarMessage(t('Sync.NoServerConnected'));
        setSnackbarVisible(true);
        return;
      }

      const haveUpdate = await gitBackgroundSyncService.syncWikiWithServer({
        ...workspace,
        syncIncludeSubWikis: includeSubWikis,
      }, server);

      if (haveUpdate) {
        setSnackbarMessage(t('Sync.UpdateReceived'));
        setSnackbarVisible(true);
      } else {
        setSnackbarMessage(t('Sync.AlreadyUpToDate'));
        setSnackbarVisible(true);
      }

      // Update last sync time
      if (workspace.syncedServers.length > 0) {
        setLastSyncTime(Date.now());
      }
    } catch (error) {
      const errorMessage = (error as Error).message;
      setSyncError(errorMessage);
      setSnackbarMessage(t('Sync.SyncFailed'));
      setSnackbarVisible(true);
    } finally {
      setSyncing(false);
    }
  }, [workspace, t, includeSubWikis]);

  const formatLastSyncTime = useCallback((timestamp: number) => {
    const now = Date.now();
    const diffMs = now - timestamp;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) {
      return t('Sync.JustNow');
    } else if (diffMins < 60) {
      return t('Sync.MinutesAgo', { count: diffMins });
    } else if (diffHours < 24) {
      return t('Sync.HoursAgo', { count: diffHours });
    } else {
      return t('Sync.DaysAgo', { count: diffDays });
    }
  }, [t]);

  return (
    <Container>
      <StatusCard>
        <StatusRow>
          <StatusText variant='titleMedium'>
            {t('Sync.GitSynchronization')}
          </StatusText>
          {syncing && <ActivityIndicator size='small' />}
        </StatusRow>

        {lastSyncTime !== null && (
          <StatusRow>
            <StatusText variant='bodySmall'>
              {t('Sync.LastSync')}: {formatLastSyncTime(lastSyncTime)}
            </StatusText>
          </StatusRow>
        )}

        {syncError && (
          <StatusRow>
            <ErrorText variant='bodySmall'>
              {t('Sync.Error')}: {syncError}
            </ErrorText>
          </StatusRow>
        )}

        <StatusRow>
          <SyncButton
            mode='contained'
            onPress={handleSync}
            disabled={syncing}
            icon={syncing ? undefined : 'sync'}
          >
            {syncing ? t('Sync.Syncing') : t('Sync.SyncNow')}
          </SyncButton>
        </StatusRow>

        {!workspace.isSubWiki && gitBackgroundSyncService.getSubWikisForMainWorkspace(workspace).length > 0 && (
          <StatusRow>
            <Checkbox.Item
              label={t('Sync.IncludeSubWikis')}
              status={includeSubWikis ? 'checked' : 'unchecked'}
              onPress={() => {
                updateWorkspace(workspace.id, { syncIncludeSubWikis: !includeSubWikis });
              }}
            />
          </StatusRow>
        )}
      </StatusCard>

      {/* Conflict Dialog */}
      <Portal>
        <Dialog
          visible={showConflictDialog}
          onDismiss={() => {
            setShowConflictDialog(false);
          }}
        >
          <Dialog.Title>{t('Sync.ConflictDetected')}</Dialog.Title>
          <Dialog.Content>
            <Text variant='bodyMedium'>
              {t('Sync.ConflictDescription')}
            </Text>
            {conflictBranch && (
              <ConflictBranchText variant='bodySmall'>
                {t('Sync.ConflictBranch')}: {conflictBranch}
              </ConflictBranchText>
            )}
            <ConflictInstructionsText variant='bodySmall'>
              {t('Sync.ConflictInstructions')}
            </ConflictInstructionsText>
          </Dialog.Content>
          <Dialog.Actions>
            <Button
              onPress={() => {
                setShowConflictDialog(false);
              }}
            >
              {t('Common.OK')}
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      {/* Success/Error Snackbar */}
      <Snackbar
        visible={snackbarVisible}
        onDismiss={() => {
          setSnackbarVisible(false);
        }}
        duration={3000}
      >
        {snackbarMessage}
      </Snackbar>
    </Container>
  );
};
