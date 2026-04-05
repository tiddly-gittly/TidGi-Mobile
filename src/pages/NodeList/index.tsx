import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, FlatList } from 'react-native';
import { Appbar, Button, Card, Chip, Dialog, Divider, List, Portal, Text, TextInput } from 'react-native-paper';
import { styled, useTheme } from 'styled-components/native';
import * as MemeLoop from '../../services/MemeLoopService';
import { useMemeLoopStore } from '../../store/memeloop';

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

const ChipRow = styled.View`
  flex-direction: row;
  gap: 4px;
  flex-wrap: wrap;
`;

export function NodeList(): React.JSX.Element {
  const { t } = useTranslation();
  const theme = useTheme();
  const peers = useMemeLoopStore((s) => s.connectedPeers);
  const knownNodes = useMemeLoopStore((s) => s.knownNodes);
  const discoveredNodes = useMemeLoopStore((s) => s.discoveredNodes);

  const [connectDialogVisible, setConnectDialogVisible] = useState(false);
  const [connectUrl, setConnectUrl] = useState('');
  const [pinDialogVisible, setPinDialogVisible] = useState(false);
  const [pinNodeId, setPinNodeId] = useState('');
  const [pinCode, setPinCode] = useState('');

  useEffect(() => {
    void MemeLoop.fetchPeers().catch(() => {});
  }, []);

  const handleConnect = useCallback(async () => {
    if (!connectUrl.trim()) return;
    try {
      await MemeLoop.addPeer(connectUrl.trim());
      setConnectUrl('');
      setConnectDialogVisible(false);
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : String(error));
    }
  }, [connectUrl]);

  const handlePinPairing = useCallback(async () => {
    if (!pinCode.trim() || !pinNodeId) return;
    try {
      const result = await MemeLoop.confirmPeerPin(pinNodeId, pinCode);
      if (result.ok) {
        Alert.alert(t('NodeList.PairSuccess'));
        setPinDialogVisible(false);
        setPinCode('');
      }
    } catch (error) {
      Alert.alert(t('NodeList.PairFailed', { error: error instanceof Error ? error.message : String(error) }));
    }
  }, [pinCode, pinNodeId, t]);

  const handleRemovePeer = useCallback(async (nodeId: string) => {
    Alert.alert(t('NodeList.RevokeConfirm'), '', [
      { text: t('Agent.Cancel'), style: 'cancel' },
      {
        text: t('NodeList.Revoke'),
        style: 'destructive',
        onPress: async () => {
          await MemeLoop.removePeer(nodeId).catch(() => {});
          useMemeLoopStore.getState().removeKnownNode(nodeId);
        },
      },
    ]);
  }, [t]);

  const showPinDialog = useCallback((nodeId: string) => {
    setPinNodeId(nodeId);
    setPinCode('');
    setPinDialogVisible(true);
  }, []);

  return (
    <Container>
      <Appbar.Header>
        <Appbar.Content title={t('NodeList.Title')} />
        <Appbar.Action icon="plus" onPress={() => setConnectDialogVisible(true)} />
        <Appbar.Action icon="refresh" onPress={() => void MemeLoop.fetchPeers().catch(() => {})} />
      </Appbar.Header>

      {peers.length === 0 && discoveredNodes.length === 0
        ? (
          <EmptyContainer>
            <Text style={{ color: theme.colors.onSurfaceVariant ?? '#888' }}>{t('NodeList.NoNodes')}</Text>
            <Text style={{ marginTop: 8, color: theme.colors.onSurfaceVariant ?? '#888', textAlign: 'center' }}>
              {t('NodeList.NoNodesDescription')}
            </Text>
            <Button mode="outlined" style={{ marginTop: 16 }} onPress={() => setConnectDialogVisible(true)}>
              {t('NodeList.ConnectManually')}
            </Button>
          </EmptyContainer>
        )
        : (
          <FlatList
            data={[
              ...peers.map((p) => ({ ...p, section: 'connected' as const })),
              ...discoveredNodes.filter((d) => !peers.some((p) => p.nodeId === d.nodeId)).map((d) => ({
                nodeId: d.nodeId,
                name: d.name,
                type: 'unknown' as const,
                host: d.host,
                port: d.port,
                capabilities: [],
                isLan: true,
                section: 'discovered' as const,
              })),
            ]}
            keyExtractor={(item) => `${item.section}-${item.nodeId}`}
            renderItem={({ item }) => (
              <>
                <List.Item
                  title={item.name || item.nodeId.slice(0, 12)}
                  description={`${item.host}:${item.port}`}
                  left={(props) => <List.Icon {...props} icon={item.section === 'connected' ? 'check-network' : 'access-point-network'} />}
                  right={() => (
                    <ChipRow>
                      <Chip compact textStyle={{ fontSize: 10 }}>
                        {item.section === 'connected' ? t('NodeList.Online') : t('NodeList.Discovered')}
                      </Chip>
                      {item.isLan && <Chip compact textStyle={{ fontSize: 10 }}>LAN</Chip>}
                    </ChipRow>
                  )}
                  onPress={() => showPinDialog(item.nodeId)}
                  onLongPress={() => void handleRemovePeer(item.nodeId)}
                />
                <Divider />
              </>
            )}
            ListHeaderComponent={
              knownNodes.length > 0
                ? (
                  <>
                    <SectionHeader variant="labelLarge">{t('Auth.KnownNodes')} ({knownNodes.length})</SectionHeader>
                    {knownNodes.map((node) => (
                      <React.Fragment key={node.nodeId}>
                        <List.Item
                          title={node.nodeId.slice(0, 16)}
                          description={`${t('Auth.TrustSource')}: ${node.trustSource} · ${t('Auth.LastConnected')}: ${new Date(node.lastConnected).toLocaleDateString()}`}
                          left={(props) => <List.Icon {...props} icon="shield-check" />}
                          onLongPress={() => void handleRemovePeer(node.nodeId)}
                        />
                        <Divider />
                      </React.Fragment>
                    ))}
                    <SectionHeader variant="labelLarge">{t('NodeList.Title')}</SectionHeader>
                  </>
                )
                : undefined
            }
          />
        )}

      {/* Connect dialog */}
      <Portal>
        <Dialog visible={connectDialogVisible} onDismiss={() => setConnectDialogVisible(false)}>
          <Dialog.Title>{t('NodeList.ConnectManually')}</Dialog.Title>
          <Dialog.Content>
            <TextInput
              mode="outlined"
              label={t('NodeList.EnterNodeUrl')}
              value={connectUrl}
              onChangeText={setConnectUrl}
              placeholder="ws://192.168.1.100:5200"
              autoCapitalize="none"
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setConnectDialogVisible(false)}>{t('Agent.Cancel')}</Button>
            <Button onPress={() => void handleConnect()}>{t('NodeList.Connect')}</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      {/* PIN pairing dialog */}
      <Portal>
        <Dialog visible={pinDialogVisible} onDismiss={() => setPinDialogVisible(false)}>
          <Dialog.Title>{t('NodeList.PinPairing')}</Dialog.Title>
          <Dialog.Content>
            <Text style={{ marginBottom: 16 }}>{t('NodeList.EnterPin')}</Text>
            <TextInput
              mode="outlined"
              value={pinCode}
              onChangeText={setPinCode}
              keyboardType="numeric"
              maxLength={6}
              style={{ textAlign: 'center', fontSize: 24, letterSpacing: 8 }}
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setPinDialogVisible(false)}>{t('Agent.Cancel')}</Button>
            <Button onPress={() => void handlePinPairing()} disabled={pinCode.length !== 6}>{t('NodeList.PairWithPin')}</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </Container>
  );
}
