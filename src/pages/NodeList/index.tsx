import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, FlatList } from 'react-native';
import { Appbar, Button, Card, Chip, Dialog, Divider, IconButton, List, Portal, Text, TextInput, useTheme as usePaperTheme } from 'react-native-paper';
import { styled } from 'styled-components/native';
import * as MemeLoop from '../../services/MemeLoopService';
import { switchToLocalMode, switchToRemoteMode, useAgentStore } from '../../store/agent';
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

const NodeCardContainer = styled(Card)`
  margin: 8px 16px;
  background-color: ${({ theme }) => theme.colors.surfaceVariant};
`;

const NodeCardContent = styled.View`
  padding: 12px;
`;

const NodeHeader = styled.View`
  flex-direction: row;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;
`;

const NodeTitle = styled(Text)`
  flex: 1;
  font-size: 16px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.onSurface};
`;

const StatusBadge = styled.View<{
  status: 'online' | 'offline' | 'discovered';
}>`
  flex-direction: row;
  align-items: center;
  padding: 4px 8px;
  border-radius: 12px;
  background-color: ${({ theme, status }) =>
  status === 'online'
    ? theme.colors.primaryContainer
    : status === 'discovered'
    ? theme.colors.secondaryContainer
    : theme.colors.errorContainer};
`;

const StatusDot = styled.View<{ status: 'online' | 'offline' | 'discovered' }>`
  width: 6px;
  height: 6px;
  margin-right: 4px;
  border-radius: 3px;
  background-color: ${({ theme, status }) =>
  status === 'online'
    ? theme.colors.primary
    : status === 'discovered'
    ? theme.colors.secondary
    : theme.colors.error};
`;

const StatusText = styled(Text)<{
  status: 'online' | 'offline' | 'discovered';
}>`
  font-size: 11px;
  font-weight: 500;
  color: ${({ theme, status }) =>
  status === 'online'
    ? theme.colors.onPrimaryContainer
    : status === 'discovered'
    ? theme.colors.onSecondaryContainer
    : theme.colors.onErrorContainer};
`;

const NodeInfo = styled.View`
  margin-bottom: 8px;
`;

const InfoRow = styled.View`
  flex-direction: row;
  align-items: center;
  margin-bottom: 4px;
`;

const InfoLabel = styled(Text)`
  margin-right: 4px;
  font-size: 12px;
  color: ${({ theme }) => theme.colors.onSurfaceVariant};
`;

const InfoValue = styled(Text)`
  font-size: 12px;
  font-weight: 500;
  color: ${({ theme }) => theme.colors.onSurface};
`;

const ChipRow = styled.View`
  flex-direction: row;
  gap: 4px;
  flex-wrap: wrap;
  margin-bottom: 8px;
`;

const CapabilitiesSection = styled.View`
  margin-top: 8px;
  padding-top: 8px;
  border-top-width: 1px;
  border-top-color: ${({ theme }) => theme.colors.outlineVariant};
`;

const CapabilityLabel = styled(Text)`
  margin-bottom: 4px;
  font-size: 11px;
  color: ${({ theme }) => theme.colors.onSurfaceVariant};
`;

const ActionButtons = styled.View`
  flex-direction: row;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
`;

const EmptyDescriptionText = styled(Text)`
  margin-top: 8px;
  color: ${({ theme }) => theme.colors.onSurfaceVariant};
  text-align: center;
`;

const PinInstructionText = styled(Text)`
  margin-bottom: 16px;
`;

const StyledPinInput = styled(TextInput)`
  text-align: center;
  font-size: 24px;
  letter-spacing: 8px;
`;

const CHIP_TEXT_STYLE = { fontSize: 10 } as const;
const CONNECT_MANUALLY_BUTTON_STYLE = { marginTop: 16 } as const;

const getNodeTestIdSuffix = (nodeId: string): string => nodeId.replace(/[^a-zA-Z0-9_-]/g, '-');

type MemeLoopStoreState = ReturnType<typeof useMemeLoopStore.getState>;
type ConnectedPeer = MemeLoopStoreState['connectedPeers'][number];
type KnownNode = MemeLoopStoreState['knownNodes'][number];
type DiscoveredNode = MemeLoopStoreState['discoveredNodes'][number];
type NodeStatus = 'online' | 'offline' | 'discovered';
type NodeConnectionType = 'lan' | 'frp' | 'cloud';
type NodeTrustSource = 'pin-pairing' | 'cloud-registry';

interface NodeCapabilities {
  tools?: string[];
  mcpServers?: string[];
  hasWiki?: boolean;
  imChannels?: string[];
}

type ConnectedNodeListItem = ConnectedPeer & {
  section: 'connected';
};

interface DiscoveredNodeListItem {
  section: 'discovered';
  nodeId: DiscoveredNode['nodeId'];
  name: DiscoveredNode['name'];
  type: 'unknown';
  host: DiscoveredNode['host'];
  port: DiscoveredNode['port'];
  capabilities: [];
  isLan: true;
}

type NodeListItem = ConnectedNodeListItem | DiscoveredNodeListItem;

const mapDiscoveredNodeToListItem = (
  node: DiscoveredNode,
): DiscoveredNodeListItem => ({
  nodeId: node.nodeId,
  name: node.name,
  type: 'unknown',
  host: node.host,
  port: node.port,
  capabilities: [],
  isLan: true,
  section: 'discovered',
});

const buildNodeListData = (
  peers: ConnectedPeer[],
  discoveredNodes: DiscoveredNode[],
): NodeListItem[] => {
  const connectedNodeIds = new Set(peers.map((peer) => peer.nodeId));

  return [
    ...peers.map((peer) => ({ ...peer, section: 'connected' as const })),
    ...discoveredNodes
      .filter((node) => !connectedNodeIds.has(node.nodeId))
      .map(mapDiscoveredNodeToListItem),
  ];
};

interface NodeCardProps {
  nodeId: string;
  testIdSuffix: string;
  name: string;
  status: NodeStatus;
  connectionType?: NodeConnectionType;
  host?: string;
  port?: number;
  frpAddress?: string;
  capabilities?: NodeCapabilities;
  trustSource?: NodeTrustSource;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onSelectForAgent?: () => void;
  onPair?: () => void;
  onRemove?: () => void;
  isActiveAgentTarget?: boolean;
}

const NodeCard: React.FC<NodeCardProps> = ({
  nodeId,
  testIdSuffix,
  name,
  status,
  connectionType,
  host,
  port,
  frpAddress,
  capabilities,
  trustSource,
  onConnect,
  onDisconnect,
  onSelectForAgent,
  onPair,
  onRemove,
  isActiveAgentTarget,
}) => {
  const { t } = useTranslation();

  return (
    <NodeCardContainer testID={`node-card-${testIdSuffix}`}>
      <NodeCardContent>
        <NodeHeader>
          <NodeTitle numberOfLines={1}>{name || nodeId.slice(0, 16)}</NodeTitle>
          <StatusBadge status={status}>
            <StatusDot status={status} />
            <StatusText status={status}>
              {status === 'online'
                ? t('NodeList.Online')
                : status === 'discovered'
                ? t('NodeList.Discovered')
                : t('NodeList.Offline')}
            </StatusText>
          </StatusBadge>
        </NodeHeader>

        <NodeInfo>
          <InfoRow>
            <InfoLabel>{t('NodeList.NodeId')}:</InfoLabel>
            <InfoValue numberOfLines={1}>{nodeId.slice(0, 16)}...</InfoValue>
          </InfoRow>

          {host && port && (
            <InfoRow>
              <InfoLabel>{t('NodeList.Address')}:</InfoLabel>
              <InfoValue>
                {host}:{port}
              </InfoValue>
            </InfoRow>
          )}

          {frpAddress && (
            <InfoRow>
              <InfoLabel>{t('NodeList.FrpAddress')}:</InfoLabel>
              <InfoValue>{frpAddress}</InfoValue>
            </InfoRow>
          )}
        </NodeInfo>

        <ChipRow>
          {connectionType && (
            <Chip compact mode='outlined' textStyle={CHIP_TEXT_STYLE}>
              {connectionType.toUpperCase()}
            </Chip>
          )}
          {trustSource && (
            <Chip compact mode='outlined' textStyle={CHIP_TEXT_STYLE}>
              {trustSource === 'pin-pairing'
                ? t('NodeList.PinPaired')
                : t('NodeList.CloudTrusted')}
            </Chip>
          )}
          {isActiveAgentTarget && (
            <Chip
              testID={`node-agent-target-chip-${testIdSuffix}`}
              compact
              mode='flat'
              icon='target'
              textStyle={CHIP_TEXT_STYLE}
            >
              Agent Target
            </Chip>
          )}
        </ChipRow>

        {capabilities && (
          <CapabilitiesSection>
            <CapabilityLabel>{t('NodeList.Capabilities')}:</CapabilityLabel>
            <ChipRow>
              {capabilities.hasWiki && (
                <Chip
                  compact
                  icon='book-open-variant'
                  textStyle={CHIP_TEXT_STYLE}
                >
                  {t('NodeList.Wiki')}
                </Chip>
              )}
              {capabilities.tools && capabilities.tools.length > 0 && (
                <Chip compact icon='tools' textStyle={CHIP_TEXT_STYLE}>
                  {t('NodeList.Tools')} ({capabilities.tools.length})
                </Chip>
              )}
              {capabilities.mcpServers &&
                capabilities.mcpServers.length > 0 && (
                <Chip compact icon='server' textStyle={CHIP_TEXT_STYLE}>
                  MCP ({capabilities.mcpServers.length})
                </Chip>
              )}
              {capabilities.imChannels &&
                capabilities.imChannels.length > 0 && (
                <Chip compact icon='message' textStyle={CHIP_TEXT_STYLE}>
                  IM ({capabilities.imChannels.length})
                </Chip>
              )}
            </ChipRow>
          </CapabilitiesSection>
        )}

        <ActionButtons>
          {status === 'discovered' && onPair && (
            <Button mode='contained' compact onPress={onPair}>
              {t('NodeList.Pair')}
            </Button>
          )}
          {status === 'online' && onDisconnect && (
            <Button mode='outlined' compact onPress={onDisconnect}>
              {t('NodeList.Disconnect')}
            </Button>
          )}
          {status === 'online' && onSelectForAgent && (
            <Button
              testID={`node-agent-target-button-${testIdSuffix}`}
              mode={isActiveAgentTarget ? 'contained' : 'text'}
              compact
              onPress={onSelectForAgent}
            >
              {isActiveAgentTarget ? 'Active Target' : 'Use for Agent'}
            </Button>
          )}
          {status === 'offline' && onConnect && (
            <Button mode='contained' compact onPress={onConnect}>
              {t('NodeList.Connect')}
            </Button>
          )}
          {onRemove && <IconButton icon='delete' size={20} onPress={onRemove} />}
        </ActionButtons>
      </NodeCardContent>
    </NodeCardContainer>
  );
};

interface EmptyNodeStateProps {
  descriptionColor: string;
  onConnectManually: () => void;
}

const EmptyNodeState: React.FC<EmptyNodeStateProps> = ({
  descriptionColor,
  onConnectManually,
}) => {
  const { t } = useTranslation();

  return (
    <EmptyContainer>
      <Text style={{ color: descriptionColor }}>{t('NodeList.NoNodes')}</Text>
      <EmptyDescriptionText>
        {t('NodeList.NoNodesDescription')}
      </EmptyDescriptionText>
      <Button
        mode='outlined'
        style={CONNECT_MANUALLY_BUTTON_STYLE}
        onPress={onConnectManually}
      >
        {t('NodeList.ConnectManually')}
      </Button>
    </EmptyContainer>
  );
};

interface KnownNodesHeaderProps {
  knownNodes: KnownNode[];
  onRemovePeer: (nodeId: string) => void;
}

const KnownNodesHeader: React.FC<KnownNodesHeaderProps> = ({
  knownNodes,
  onRemovePeer,
}) => {
  const { t } = useTranslation();

  if (knownNodes.length === 0) {
    return null;
  }

  return (
    <>
      <SectionHeader variant='labelLarge'>
        {t('Auth.KnownNodes')} ({knownNodes.length})
      </SectionHeader>
      {knownNodes.map((node) => (
        <React.Fragment key={node.nodeId}>
          <List.Item
            title={node.nodeId.slice(0, 16)}
            description={`${t('Auth.TrustSource')}: ${node.trustSource} · ${t('Auth.LastConnected')}: ${new Date(node.lastConnected).toLocaleDateString()}`}
            left={(props) => <List.Icon {...props} icon='shield-check' />}
            onLongPress={() => {
              onRemovePeer(node.nodeId);
            }}
          />
          <Divider />
        </React.Fragment>
      ))}
      <SectionHeader variant='labelLarge'>{t('NodeList.Title')}</SectionHeader>
    </>
  );
};

interface ConnectDialogProps {
  visible: boolean;
  connectUrl: string;
  onChangeConnectUrl: (value: string) => void;
  onClose: () => void;
  onConnect: () => void;
}

const ConnectDialog: React.FC<ConnectDialogProps> = ({
  visible,
  connectUrl,
  onChangeConnectUrl,
  onClose,
  onConnect,
}) => {
  const { t } = useTranslation();

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onClose}>
        <Dialog.Title>{t('NodeList.ConnectManually')}</Dialog.Title>
        <Dialog.Content>
          <TextInput
            mode='outlined'
            label={t('NodeList.EnterNodeUrl')}
            value={connectUrl}
            onChangeText={onChangeConnectUrl}
            placeholder='ws://192.168.1.100:5200'
            autoCapitalize='none'
          />
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={onClose}>{t('Agent.Cancel')}</Button>
          <Button onPress={onConnect}>{t('NodeList.Connect')}</Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
};

interface PinPairingDialogProps {
  visible: boolean;
  pinCode: string;
  onChangePinCode: (value: string) => void;
  onClose: () => void;
  onPair: () => void;
}

const PinPairingDialog: React.FC<PinPairingDialogProps> = ({
  visible,
  pinCode,
  onChangePinCode,
  onClose,
  onPair,
}) => {
  const { t } = useTranslation();

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onClose}>
        <Dialog.Title>{t('NodeList.PinPairing')}</Dialog.Title>
        <Dialog.Content>
          <PinInstructionText>{t('NodeList.EnterPin')}</PinInstructionText>
          <StyledPinInput
            mode='outlined'
            value={pinCode}
            onChangeText={onChangePinCode}
            keyboardType='numeric'
            maxLength={6}
          />
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={onClose}>{t('Agent.Cancel')}</Button>
          <Button onPress={onPair} disabled={pinCode.length !== 6}>
            {t('NodeList.PairWithPin')}
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
};

export function NodeList(): React.JSX.Element {
  const { t } = useTranslation();
  const theme = usePaperTheme();
  const peers = useMemeLoopStore((s) => s.connectedPeers);
  const selectedRemoteNodeId = useMemeLoopStore((s) => s.selectedRemoteNodeId);
  const knownNodes = useMemeLoopStore((s) => s.knownNodes);
  const discoveredNodes = useMemeLoopStore((s) => s.discoveredNodes);
  const agentRemoteNodeId = useAgentStore((s) => s.remoteNodeId);
  const agentDataSourceMode = useAgentStore((s) => s.dataSourceMode);
  const activeAgentTargetNodeId = agentDataSourceMode === 'remote'
    ? (agentRemoteNodeId ?? selectedRemoteNodeId)
    : selectedRemoteNodeId;

  const [connectDialogVisible, setConnectDialogVisible] = useState(false);
  const [connectUrl, setConnectUrl] = useState('');
  const [pinDialogVisible, setPinDialogVisible] = useState(false);
  const [pinNodeId, setPinNodeId] = useState('');
  const [pinCode, setPinCode] = useState('');

  const fetchData = useCallback(async () => {
    try {
      await MemeLoop.fetchPeers();
      // Cloud nodes would be fetched here if available
    } catch (error) {
      console.error('Failed to fetch nodes:', error);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const openConnectDialog = useCallback(() => {
    setConnectDialogVisible(true);
  }, []);

  const closeConnectDialog = useCallback(() => {
    setConnectDialogVisible(false);
  }, []);

  const closePinDialog = useCallback(() => {
    setPinDialogVisible(false);
  }, []);

  const handleConnect = useCallback(async () => {
    if (!connectUrl.trim()) return;

    try {
      await MemeLoop.addPeer(connectUrl.trim());
      setConnectUrl('');
      setConnectDialogVisible(false);
    } catch (error) {
      Alert.alert(
        'Error',
        error instanceof Error ? error.message : String(error),
      );
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
      Alert.alert(
        t('NodeList.PairFailed', {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }, [pinCode, pinNodeId, t]);

  const handleRemovePeer = useCallback(
    (nodeId: string) => {
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
    },
    [t],
  );

  const showPinDialog = useCallback((nodeId: string) => {
    setPinNodeId(nodeId);
    setPinCode('');
    setPinDialogVisible(true);
  }, []);

  const handleSelectAgentTarget = useCallback(async (nodeId: string) => {
    try {
      await switchToRemoteMode(nodeId);
    } catch (error) {
      Alert.alert(
        'Error',
        error instanceof Error ? error.message : String(error),
      );
    }
  }, []);

  const handleDisconnectPeer = useCallback(
    async (nodeId: string) => {
      const service = MemeLoop.getMemeLoopService();
      const connection = service.getConnection(nodeId);
      connection?.disconnect();

      const remainingPeers = useMemeLoopStore
        .getState()
        .connectedPeers.filter((peer) => peer.nodeId !== nodeId);

      if (
        selectedRemoteNodeId === nodeId ||
        (agentDataSourceMode === 'remote' && agentRemoteNodeId === nodeId)
      ) {
        useMemeLoopStore.getState().setSelectedRemoteNodeId(null);
        await switchToLocalMode();
      }

      if (remainingPeers.length === 0) {
        useMemeLoopStore.getState().setConnectionStatus('disconnected');
      }
    },
    [agentDataSourceMode, agentRemoteNodeId, selectedRemoteNodeId],
  );

  const handleRefresh = useCallback(() => {
    void MemeLoop.fetchPeers().catch(() => {});
  }, []);

  const hasVisibleNodes = peers.length > 0 || discoveredNodes.length > 0;

  const nodeListData = useMemo(
    () => buildNodeListData(peers, discoveredNodes),
    [discoveredNodes, peers],
  );

  const renderNodeItem = useCallback(
    ({ item }: { item: NodeListItem }) => {
      const isConnected = item.section === 'connected';

      return (
        <NodeCard
          nodeId={item.nodeId}
          testIdSuffix={getNodeTestIdSuffix(item.nodeId)}
          name={item.name}
          status={isConnected ? 'online' : 'discovered'}
          connectionType={item.isLan ? 'lan' : 'cloud'}
          host={item.host}
          port={item.port}
          onPair={!isConnected
            ? () => {
              showPinDialog(item.nodeId);
            }
            : undefined}
          onDisconnect={isConnected
            ? () => void handleDisconnectPeer(item.nodeId)
            : undefined}
          onRemove={() => {
            handleRemovePeer(item.nodeId);
          }}
          onSelectForAgent={isConnected
            ? () => void handleSelectAgentTarget(item.nodeId)
            : undefined}
          isActiveAgentTarget={activeAgentTargetNodeId === item.nodeId}
        />
      );
    },
    [
      activeAgentTargetNodeId,
      handleDisconnectPeer,
      handleRemovePeer,
      handleSelectAgentTarget,
      showPinDialog,
    ],
  );

  return (
    <Container testID='node-list-screen'>
      <Appbar.Header>
        <Appbar.Content title={t('NodeList.Title')} />
        <Appbar.Action icon='plus' onPress={openConnectDialog} />
        <Appbar.Action icon='refresh' onPress={handleRefresh} />
      </Appbar.Header>

      {hasVisibleNodes
        ? (
          <FlatList
            data={nodeListData}
            keyExtractor={(item) => `${item.section}-${item.nodeId}`}
            renderItem={renderNodeItem}
            ListHeaderComponent={knownNodes.length > 0
              ? (
                <KnownNodesHeader
                  knownNodes={knownNodes}
                  onRemovePeer={handleRemovePeer}
                />
              )
              : undefined}
          />
        )
        : (
          <EmptyNodeState
            descriptionColor={theme.colors.onSurfaceVariant}
            onConnectManually={openConnectDialog}
          />
        )}

      <ConnectDialog
        visible={connectDialogVisible}
        connectUrl={connectUrl}
        onChangeConnectUrl={setConnectUrl}
        onClose={closeConnectDialog}
        onConnect={() => {
          void handleConnect();
        }}
      />

      <PinPairingDialog
        visible={pinDialogVisible}
        pinCode={pinCode}
        onChangePinCode={setPinCode}
        onClose={closePinDialog}
        onPair={() => {
          void handlePinPairing();
        }}
      />
    </Container>
  );
}
