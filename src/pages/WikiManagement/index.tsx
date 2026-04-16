import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SectionList } from 'react-native';
import { Appbar, Chip, Divider, List, Switch, Text } from 'react-native-paper';
import { styled, useTheme } from 'styled-components/native';
import * as MemeLoop from '../../services/MemeLoopService';
import { useMemeLoopStore } from '../../store/memeloop';
import { useWorkspaceStore } from '../../store/workspace';

const Container = styled.View`
  flex: 1;
  background-color: ${({ theme }) => theme.colors.background};
`;

const EmptyContainer = styled.View`
  flex: 1;
  justify-content: center;
  align-items: center;
  padding: 32px;
`;

const SectionHeader = styled(Text)`
  padding: 16px 16px 8px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.primary};
`;

const LOCAL_CHIP_TEXT_STYLE = { fontSize: 10 } as const;

interface RemoteWiki {
  wikiId: string;
  title: string;
}

export function WikiManagement(): React.JSX.Element {
  const { t } = useTranslation();
  const theme = useTheme();
  const localWorkspaces = useWorkspaceStore((s) => s.workspaces);
  const peers = useMemeLoopStore((s) => s.connectedPeers);
  const [remoteWikis, setRemoteWikis] = useState<RemoteWiki[]>([]);
  const [syncEnabled, setSyncEnabled] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!MemeLoop.isConnected()) return;
    void MemeLoop.listRemoteWikis()
      .then(setRemoteWikis)
      .catch(() => {
        setRemoteWikis([]);
      });
  }, [peers]);

  const toggleSync = useCallback((wikiId: string) => {
    setSyncEnabled((previous) => {
      const next = { ...previous, [wikiId]: !previous[wikiId] };
      // Persist the sync preference via RPC
      void MemeLoop.rpcCall('memeloop.wiki.setSyncPreference', {
        wikiId,
        enabled: next[wikiId],
      }).catch(() => {});
      return next;
    });
  }, []);

  type WikiListItem = {
    type: 'local' | 'remote';
    id: string;
    name: string;
    nodeId?: string;
  };

  const sections: Array<{ title: string; data: WikiListItem[] }> = [
    {
      title: t('WikiManagement.LocalWikis'),
      data: localWorkspaces.map((w) => ({
        type: 'local' as const,
        id: w.id,
        name: w.name,
      })),
    },
    {
      title: t('WikiManagement.RemoteWikis'),
      data: remoteWikis.map((w) => ({
        type: 'remote' as const,
        id: w.wikiId,
        name: w.title,
      })),
    },
  ];

  return (
    <Container>
      <Appbar.Header>
        <Appbar.Content title={t('WikiManagement.Title')} />
        <Appbar.Action
          icon='refresh'
          onPress={() => {
            void MemeLoop.listRemoteWikis()
              .then(setRemoteWikis)
              .catch(() => {});
          }}
        />
      </Appbar.Header>

      <SectionList
        sections={sections}
        keyExtractor={(item) => `${item.type}-${item.id}`}
        renderSectionHeader={({ section }) => <SectionHeader variant='labelLarge'>{section.title}</SectionHeader>}
        renderItem={({ item }) => {
          if (item.type === 'local') {
            return (
              <>
                <List.Item
                  title={item.name}
                  left={(props) => <List.Icon {...props} icon='notebook' />}
                  right={() => (
                    <Chip compact textStyle={LOCAL_CHIP_TEXT_STYLE}>
                      Local
                    </Chip>
                  )}
                />
                <Divider />
              </>
            );
          }
          // Remote wiki
          const firstPeer = peers.at(0);
          const nodeName = firstPeer ? firstPeer.name : 'Remote';
          return (
            <>
              <List.Item
                title={item.name}
                description={t('WikiManagement.NodeName', { name: nodeName })}
                left={(props) => <List.Icon {...props} icon='cloud-outline' />}
                right={() => (
                  <Switch
                    value={syncEnabled[item.id] || false}
                    onValueChange={() => {
                      toggleSync(item.id);
                    }}
                  />
                )}
              />
              <Divider />
            </>
          );
        }}
        ListEmptyComponent={
          <EmptyContainer>
            <Text style={{ color: theme.colors.onSurfaceVariant }}>
              {t('WikiManagement.NoLocalWikis')}
            </Text>
          </EmptyContainer>
        }
      />
    </Container>
  );
}
