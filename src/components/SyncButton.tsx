import { TFunction } from 'i18next';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, IconButton, MD3Colors, Text } from 'react-native-paper';
import { backgroundSyncService } from '../services/BackgroundSyncService';
import { IWikiWorkspace, useWorkspaceStore } from '../store/workspace';

export interface ISyncIconButtonProps {
  workspaceID: string;
}
export function SyncIconButton(props: ISyncIconButtonProps) {
  const { workspaceID } = props;
  const wiki = useWorkspaceStore(state =>
    workspaceID === undefined ? undefined : state.workspaces.find((w): w is IWikiWorkspace => w.id === workspaceID && (w.type === undefined || w.type === 'wiki'))
  );

  const [inSyncing, setInSyncing] = useState(false);
  const [isConnected, setIsConnected] = useState(true);
  const [isSyncSucceed, setIsSyncSucceed] = useState<boolean | undefined>(undefined);
  const iconName = getSyncIconName(isSyncSucceed, isConnected, inSyncing);

  return (
    <IconButton
      {...props}
      icon={iconName}
      iconColor={isSyncSucceed === undefined ? undefined : (isSyncSucceed ? MD3Colors.tertiary20 : MD3Colors.error80)}
      onPress={async () => {
        if (wiki === undefined) return;
        setInSyncing(true);
        try {
          await backgroundSyncService.updateServerOnlineStatus();
          const server = backgroundSyncService.getOnlineServerForWiki(wiki);
          if (server === undefined) {
            setIsConnected(false);
            return;
          }
          await backgroundSyncService.syncWikiWithServer(wiki, server);
          setIsSyncSucceed(true);
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
  const wiki = useWorkspaceStore(state =>
    workspaceID === undefined ? undefined : state.workspaces.find((w): w is IWikiWorkspace => w.id === workspaceID && (w.type === undefined || w.type === 'wiki'))
  );

  const [inSyncing, setInSyncing] = useState(false);
  const [isConnected, setIsConnected] = useState(true);
  const [isSyncSucceed, setIsSyncSucceed] = useState<boolean | undefined>(undefined);
  const [currentOnlineServerToSync, setCurrentOnlineServerToSync] = useState<undefined | Awaited<ReturnType<typeof backgroundSyncService.getOnlineServerForWiki>>>();
  useEffect(() => {
    if (wiki === undefined) {
      setIsConnected(false);
      return;
    }
    void backgroundSyncService.updateServerOnlineStatus().then(() => {
      const server = backgroundSyncService.getOnlineServerForWiki(wiki);
      if (server === undefined) {
        setIsConnected(false);
      }
      setCurrentOnlineServerToSync(server);
    });
  }, [wiki]);

  return (
    <Button
      mode='outlined'
      disabled={inSyncing}
      loading={inSyncing}
      buttonColor={isSyncSucceed === undefined ? undefined : (isSyncSucceed ? MD3Colors.secondary80 : MD3Colors.error80)}
      onPress={async () => {
        if (wiki === undefined) return;
        setInSyncing(true);
        try {
          await backgroundSyncService.updateServerOnlineStatus();
          const server = backgroundSyncService.getOnlineServerForWiki(wiki);
          if (server === undefined) {
            throw new Error('No server available');
          }
          await backgroundSyncService.syncWikiWithServer(wiki, server);
          setIsSyncSucceed(true);
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
          const { haveConnectedServer } = await backgroundSyncService.sync();
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
function getSyncLogText(t: TFunction<'translation', undefined>, isSyncSucceed: boolean | undefined, isConnected: boolean, inSyncing: boolean) {
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
