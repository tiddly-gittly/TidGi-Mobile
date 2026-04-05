import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, SectionList } from 'react-native';
import { Appbar, Card, Chip, Divider, List, Switch, Text } from 'react-native-paper';
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

const Row = styled.View`
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  padding: 0 16px;
`;

interface RemoteWiki {
  wikiId: string;
  name: string;
  nodeId: string;
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
    void MemeLoop.listRemoteWikis().then(setRemoteWikis).catch(() => setRemoteWikis([]));
  }, [peers]);

  const toggleSync = useCallback((wikiId: string) => {
    setSyncEnabled((prev) => {
      const next = { ...prev, [wikiId]: !prev[wikiId] };
      // Persist the sync preference via RPC
      void MemeLoop.rpcCall('memeloop.wiki.setSyncPreference', { wikiId, enabled: next[wikiId] }).catch(() => {});
      return next;
    });
  }, []);

  type WikiListItem = { type: 'local' | 'remote'; id: string; name: string; nodeId?: string };

  const sections: Array<{ title: string; data: WikiListItem[] }> = [
    {
      title: t('WikiManagement.LocalWikis'),
      data: localWorkspaces.map((w) => ({ type: 'local' as const, id: w.id, name: w.name })),
    },
    {
      title: t('WikiManagement.RemoteWikis'),
      data: remoteWikis.map((w) => ({ type: 'remote' as const, id: w.wikiId, name: w.name, nodeId: w.nodeId })),
    },
  ];

  return (
    <Container>
      <Appbar.Header>
        <Appbar.Content title={t('WikiManagement.Title')} />
        <Appbar.Action icon="refresh" onPress={() => {
          void MemeLoop.listRemoteWikis().then(setRemoteWikis).catch(() => {});
        }} />
      </Appbar.Header>

      <SectionList
        sections={sections}
        keyExtractor={(item) => `${item.type}-${item.id}`}
        renderSectionHeader={({ section }) => (
          <SectionHeader variant="labelLarge">{section.title}</SectionHeader>
        )}
        renderItem={({ item }) => {
          if (item.type === 'local') {
            return (
              <>
                <List.Item
                  title={item.name}
                  left={(props) => <List.Icon {...props} icon="notebook" />}
                  right={() => <Chip compact textStyle={{ fontSize: 10 }}>Local</Chip>}
                />
                <Divider />
              </>
            );
          }
          // Remote wiki
          const nodeName = peers.find((p) => p.nodeId === item.nodeId)?.name ?? item.nodeId?.slice(0, 8);
          return (
            <>
              <List.Item
                title={item.name}
                description={t('WikiManagement.NodeName', { name: nodeName })}
                left={(props) => <List.Icon {...props} icon="cloud-outline" />}
                right={() => (
                  <Switch value={!!syncEnabled[item.id]} onValueChange={() => toggleSync(item.id)} />
                )}
              />
              <Divider />
            </>
          );
        }}
        ListEmptyComponent={
          <EmptyContainer>
            <Text style={{ color: theme.colors.onSurfaceVariant ?? '#888' }}>{t('WikiManagement.NoLocalWikis')}</Text>
          </EmptyContainer>
        }
      />
    </Container>
  );
}
