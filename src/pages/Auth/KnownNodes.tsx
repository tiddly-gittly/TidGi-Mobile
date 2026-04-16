import type { StackScreenProps } from '@react-navigation/stack';
import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, FlatList } from 'react-native';
import { Appbar, Button, Card, Divider, Text } from 'react-native-paper';
import { styled, useTheme } from 'styled-components/native';
import type { RootStackParameterList } from '../../App';
import * as MemeLoop from '../../services/MemeLoopService';
import { type IKnownNode, useMemeLoopStore } from '../../store/memeloop';

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

const NodeCard = styled(Card)`
  margin: 8px 16px;
`;

const LIST_CONTENT_STYLE = { paddingVertical: 8 } as const;
const NODE_CARD_CONTENT_STYLE = { gap: 8 } as const;

const Fingerprint = styled(Text)`
  font-family: monospace;
  font-size: 12px;
  color: ${({ theme }) => theme.colors.onSurfaceVariant};
`;

function toFingerprint(value: string): string {
  return value
    .replace(/(.{4})/g, '$1 ')
    .trim()
    .slice(0, 23);
}

export function KnownNodesScreen({
  navigation,
}: StackScreenProps<RootStackParameterList, 'KnownNodes'>): React.JSX.Element {
  const { t } = useTranslation();
  const theme = useTheme();
  const knownNodes = useMemeLoopStore((s) => s.knownNodes);

  const handleRemove = useCallback(
    (node: IKnownNode) => {
      Alert.alert(t('NodeList.Revoke'), t('NodeList.RevokeConfirm'), [
        { text: t('Agent.Cancel'), style: 'cancel' },
        {
          text: t('NodeList.Revoke'),
          style: 'destructive',
          onPress: () => {
            void MemeLoop.removePeer(node.nodeId).catch(() => {});
          },
        },
      ]);
    },
    [t],
  );

  return (
    <Container>
      <Appbar.Header>
        <Appbar.BackAction
          onPress={() => {
            navigation.goBack();
          }}
        />
        <Appbar.Content title={t('Auth.KnownNodes')} />
      </Appbar.Header>

      {knownNodes.length === 0
        ? (
          <EmptyContainer>
            <Text style={{ color: theme.colors.onSurfaceVariant }}>
              {t('Auth.NoKnownNodes')}
            </Text>
          </EmptyContainer>
        )
        : (
          <FlatList
            data={knownNodes}
            keyExtractor={(item) => item.nodeId}
            contentContainerStyle={LIST_CONTENT_STYLE}
            renderItem={({ item }) => (
              <NodeCard mode='outlined'>
                <Card.Title
                  title={item.name || item.nodeId.slice(0, 16)}
                  subtitle={item.nodeId}
                  right={() => (
                    <Button
                      onPress={() => {
                        handleRemove(item);
                      }}
                      textColor={theme.colors.error}
                    >
                      {t('NodeList.Revoke')}
                    </Button>
                  )}
                />
                <Card.Content style={NODE_CARD_CONTENT_STYLE}>
                  <Text variant='bodySmall'>
                    {t('Auth.TrustSource')}: {item.trustSource}
                  </Text>
                  <Text variant='bodySmall'>
                    {t('Auth.FirstSeen')}: {new Date(item.firstSeen).toLocaleString()}
                  </Text>
                  <Text variant='bodySmall'>
                    {t('Auth.LastConnected')}: {new Date(item.lastConnected).toLocaleString()}
                  </Text>
                  <Divider />
                  <Text variant='labelSmall'>Public Key Fingerprint</Text>
                  <Fingerprint>{toFingerprint(item.staticPublicKey)}</Fingerprint>
                </Card.Content>
              </NodeCard>
            )}
          />
        )}
    </Container>
  );
}
