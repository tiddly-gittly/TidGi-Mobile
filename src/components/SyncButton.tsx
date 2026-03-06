import { TFunction } from 'i18next';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, IconButton, MD3Colors, Text } from 'react-native-paper';
import { gitBackgroundSyncService } from '../services/BackgroundSyncService';
import { IWikiWorkspace, useWorkspaceStore } from '../store/workspace';

export interface ISyncIconButtonProps {
  workspaceID: string;
}
export function SyncIconButton(props: ISyncIconButtonProps) {
  const { workspaceID } = props;
  const wiki = useWorkspaceStore(state => state.workspaces.find(w => w.id === workspaceID && w.type === 'wiki') as IWikiWorkspace | undefined);

  const [inSyncing, setInSyncing] = useState(false);
  const [isConnected, setIsConnected] = useState(true);
  const [isSyncSucceed, setIsSyncSucceed] = useState<boolean | undefined>(undefined);
  const iconName = getSyncIconName(isSyncSucceed, isConnected, inSyncing);
  // Dynamic testID encodes sync result so E2E tests can detect outcome without a toast:
  //   sync-icon-button-{id}         → initial / syncing state
  //   sync-result-success-{id}      → last sync succeeded
  //   sync-result-failed-{id}       → last sync failed
  const buttonTestID = isSyncSucceed === true
    ? `sync-result-success-${workspaceID}`
    : isSyncSucceed === false
    ? `sync-result-failed-${workspaceID}`
    : `sync-icon-button-${workspaceID}`;

  return (
    <IconButton
      {...props}
      testID={buttonTestID}
      accessibilityLabel='sync-icon-button'
      icon={iconName}
      iconColor={isSyncSucceed !== undefined ? (isSyncSucceed ? MD3Colors.tertiary20 : MD3Colors.error80) : undefined}
      onPress={async () => {
        if (wiki === undefined) return;
        setInSyncing(true);
        try {
          await gitBackgroundSyncService.updateServerOnlineStatus();
          const server = gitBackgroundSyncService.getOnlineServerForWiki(wiki);
          if (server === undefined) {
            setIsConnected(false);
            return;
          }
          setIsSyncSucceed(await gitBackgroundSyncService.syncWikiWithServer(wiki, server));
        } catch {
          setIsSyncSucceed(false);
        } finally {
          setInSyncing(false);
        }
      }}
    />
  );
}

export function SyncTextButton(props: ISyncIconButtonProps) {
  const { t } = useTranslation();
  const { workspaceID } = props;
  const wiki = useWorkspaceStore(state => state.workspaces.find(w => w.id === workspaceID && w.type === 'wiki') as IWikiWorkspace | undefined);

  const [inSyncing, setInSyncing] = useState(false);
  const [isConnected, setIsConnected] = useState(true);
  const [isSyncSucceed, setIsSyncSucceed] = useState<boolean | undefined>(undefined);
  const [currentOnlineServerToSync, setCurrentOnlineServerToSync] = useState<undefined | Awaited<ReturnType<typeof gitBackgroundSyncService.getOnlineServerForWiki>>>();
  useEffect(() => {
    if (!wiki) {
      setIsConnected(false);
      return;
    }
    void gitBackgroundSyncService.updateServerOnlineStatus().then(() => {
      const server = gitBackgroundSyncService.getOnlineServerForWiki(wiki);
      if (server === undefined) {
        setIsConnected(false);
      } else {
        setIsConnected(true);
      }
      setCurrentOnlineServerToSync(server);
    });
  }, [wiki]);

  return (
    <Button
      mode='outlined'
      disabled={inSyncing}
      loading={inSyncing}
      buttonColor={isSyncSucceed !== undefined ? (isSyncSucceed ? MD3Colors.secondary80 : MD3Colors.error80) : undefined}
      onPress={async () => {
        if (wiki === undefined) return;
        setInSyncing(true);
        try {
          await gitBackgroundSyncService.updateServerOnlineStatus();
          const server = gitBackgroundSyncService.getOnlineServerForWiki(wiki);
          if (server === undefined) {
            throw new Error('No server available');
          }
          setIsSyncSucceed(await gitBackgroundSyncService.syncWikiWithServer(wiki, server));
        } catch {
          setIsSyncSucceed(false);
        } finally {
          setInSyncing(false);
        }
      }}
    >
      <Text>
        {currentOnlineServerToSync?.name ?? 'x'} {getSyncLogText(t, isSyncSucceed, isConnected, inSyncing)}
      </Text>
    </Button>
  );
}

export function SyncAllTextButton() {
  const { t } = useTranslation();
  const [inSyncing, setInSyncing] = useState(false);
  const [isConnected, setIsConnected] = useState(true);
  const [isSyncSucceed, setIsSyncSucceed] = useState<boolean | undefined>(undefined);

  return (
    <Button
      mode='elevated'
      disabled={inSyncing}
      loading={inSyncing}
      onPress={async () => {
        setInSyncing(true);
        try {
          const { haveConnectedServer } = await gitBackgroundSyncService.sync();
          if (haveConnectedServer) {
            setIsSyncSucceed(true);
          } else {
            setIsConnected(false);
          }
        } catch {
          setIsSyncSucceed(false);
        } finally {
          setInSyncing(false);
        }
      }}
    >
      {getSyncLogText(t, isSyncSucceed, isConnected, inSyncing)}
    </Button>
  );
}

function getSyncIconName(isSyncSucceed: boolean | undefined, isConnected: boolean, inSyncing: boolean) {
  let iconName: string;
  switch (isSyncSucceed) {
    case true: {
      iconName = 'cloud-sync';
      break;
    }
    case undefined: {
      // haven't try sync yet
      iconName = 'sync';
      break;
    }
    case false: {
      iconName = 'sync-alert';
      break;
    }
  }
  if (!isConnected) {
    iconName = 'sync-off';
  }
  if (inSyncing) {
    iconName = 'cog-sync';
  }
  return iconName;
}
function getSyncLogText(t: TFunction, isSyncSucceed: boolean | undefined, isConnected: boolean, inSyncing: boolean) {
  let syncLogText: string;
  switch (isSyncSucceed) {
    case true: {
      syncLogText = t('Log.SynchronizationFinish');
      break;
    }
    case undefined: {
      // haven't try sync yet
      syncLogText = t('ContextMenu.SyncNow');
      break;
    }
    case false: {
      syncLogText = t('Log.SynchronizationFailed');
      break;
    }
  }
  if (!isConnected) {
    syncLogText = t('ContextMenu.NoNetworkConnection');
  }
  if (inSyncing) {
    syncLogText = t('AddWorkspace.Processing');
  }
  return syncLogText;
}
