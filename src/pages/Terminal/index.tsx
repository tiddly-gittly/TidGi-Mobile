import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, ScrollView } from 'react-native';
import { Appbar, Button, Chip, Divider, List, Text } from 'react-native-paper';
import { styled, useTheme } from 'styled-components/native';
import * as MemeLoop from '../../services/MemeLoopService';
import { useMemeLoopStore } from '../../store/memeloop';

const Container = styled.View`
  flex: 1;
  background-color: ${({ theme }) => theme.colors.background};
`;

const OutputText = styled.Text`
  font-family: monospace;
  font-size: 13px;
  line-height: 18px;
  color: #d4d4d4;
`;

const InputRow = styled.View`
  flex-direction: row;
  align-items: center;
  padding: 8px;
  border-top-width: 1px;
  border-top-color: ${({ theme }) => theme.colors.outlineVariant ?? '#e0e0e0'};
  background-color: ${({ theme }) => theme.colors.surface};
`;

const StyledInput = styled.TextInput`
  flex: 1;
  height: 40px;
  border-radius: 8px;
  padding: 0 12px;
  font-family: monospace;
  font-size: 14px;
  background-color: #2d2d2d;
  color: #d4d4d4;
`;

const EmptyContainer = styled.View`
  flex: 1;
  justify-content: center;
  align-items: center;
  padding: 32px;
`;

const NodeSelector = styled.View`
  padding: 8px 16px;
  flex-direction: row;
  gap: 8px;
  flex-wrap: wrap;
`;

interface TerminalSession {
  sessionId: string;
  status: 'running' | 'exited';
  exitCode?: number;
  command?: string;
}

export function TerminalViewer(): React.JSX.Element {
  const { t } = useTranslation();
  const theme = useTheme();
  const outputRef = useRef<ScrollView>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [output, setOutput] = useState('');
  const [inputText, setInputText] = useState('');

  const peers = useMemeLoopStore((s) => s.connectedPeers);

  // Load sessions when node selected
  useEffect(() => {
    if (!selectedNodeId) return;
    void MemeLoop.listTerminalSessions(selectedNodeId).then((s) => {
      setSessions(s as TerminalSession[]);
    }).catch(() => setSessions([]));
  }, [selectedNodeId]);

  // Load output when session selected
  useEffect(() => {
    if (!selectedNodeId || !selectedSession) return;
    const pollInterval = setInterval(() => {
      void MemeLoop.getTerminalOutput(selectedNodeId, selectedSession, 200).then((result) => {
        setOutput(result.output);
        setTimeout(() => outputRef.current?.scrollToEnd({ animated: true }), 100);
      }).catch(() => {});
    }, 2000);

    // Initial load
    void MemeLoop.getTerminalOutput(selectedNodeId, selectedSession).then((result) => {
      setOutput(result.output);
    }).catch(() => {});

    return () => clearInterval(pollInterval);
  }, [selectedNodeId, selectedSession]);

  const handleSendInput = useCallback(async () => {
    if (!selectedNodeId || !selectedSession || !inputText.trim()) return;
    await MemeLoop.respondToTerminal(selectedNodeId, selectedSession, inputText).catch(() => {});
    setInputText('');
  }, [selectedNodeId, selectedSession, inputText]);

  // Session list view
  if (!selectedSession) {
    return (
      <Container>
        <Appbar.Header>
          <Appbar.Content title={t('Terminal.Title')} />
        </Appbar.Header>

        {peers.length > 0 && (
          <NodeSelector>
            {peers.map((peer) => (
              <Chip
                key={peer.nodeId}
                selected={selectedNodeId === peer.nodeId}
                onPress={() => setSelectedNodeId(peer.nodeId)}
              >
                {peer.name}
              </Chip>
            ))}
          </NodeSelector>
        )}

        {!selectedNodeId
          ? (
            <EmptyContainer>
              <Text style={{ color: theme.colors.onSurfaceVariant ?? '#888' }}>{t('Terminal.SelectNode')}</Text>
            </EmptyContainer>
          )
          : sessions.length === 0
            ? (
              <EmptyContainer>
                <Text style={{ color: theme.colors.onSurfaceVariant ?? '#888' }}>{t('Terminal.NoSessions')}</Text>
              </EmptyContainer>
            )
            : (
              <FlatList
                data={sessions}
                keyExtractor={(item) => item.sessionId}
                renderItem={({ item }) => (
                  <>
                    <List.Item
                      title={`${t('Terminal.SessionId')}: ${item.sessionId.slice(0, 12)}`}
                      description={item.command}
                      left={(props) => <List.Icon {...props} icon="console" />}
                      right={() => (
                        <Chip compact textStyle={{ fontSize: 11 }}>
                          {item.status === 'running' ? t('Terminal.Running') : t('Terminal.Exited', { code: item.exitCode ?? '?' })}
                        </Chip>
                      )}
                      onPress={() => setSelectedSession(item.sessionId)}
                    />
                    <Divider />
                  </>
                )}
              />
            )}
      </Container>
    );
  }

  // Terminal output view
  return (
    <Container>
      <Appbar.Header>
        <Appbar.BackAction onPress={() => setSelectedSession(null)} />
        <Appbar.Content title={`${t('Terminal.SessionId')}: ${selectedSession.slice(0, 12)}`} />
      </Appbar.Header>

      <ScrollView ref={outputRef} style={{ flex: 1, padding: 8, backgroundColor: '#1e1e1e' }}>
        <OutputText selectable>{output || '(no output)'}</OutputText>
      </ScrollView>

      <InputRow>
        <StyledInput
          value={inputText}
          onChangeText={setInputText}
          placeholder={t('Terminal.SendInput')}
          returnKeyType="send"
          onSubmitEditing={() => void handleSendInput()}
        />
        <Button mode="text" onPress={() => void handleSendInput()}>{t('Terminal.Send')}</Button>
      </InputRow>
    </Container>
  );
}
