import type { StackScreenProps } from '@react-navigation/stack';
import * as Clipboard from 'expo-clipboard';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';
import { Appbar, Button, Card, Divider, IconButton, Text, TextInput } from 'react-native-paper';
import { styled, useTheme } from 'styled-components/native';
import type { RootStackParameterList } from '../../App';
import * as MemeLoop from '../../services/MemeLoopService';
import { useMemeLoopStore } from '../../store/memeloop';

const Container = styled.View`
  flex: 1;
  background-color: ${({ theme }) => theme.colors.background};
`;

const ScrollContainer = styled.ScrollView`
  flex: 1;
`;

const Section = styled(Card)`
  margin: 12px 16px;
`;

const SectionContent = styled(Card.Content)`
  gap: 12px;
`;

const PinDisplay = styled.View`
  background-color: ${({ theme }) => theme.colors.surfaceVariant};
  border-radius: 12px;
  padding: 24px;
  align-items: center;
  gap: 8px;
`;

const PinText = styled(Text)`
  font-size: 48px;
  font-weight: 700;
  letter-spacing: 8px;
  font-family: monospace;
  color: ${({ theme }) => theme.colors.primary};
`;

const InstructionText = styled(Text)`
  text-align: center;
  color: ${({ theme }) => theme.colors.onSurfaceVariant};
  line-height: 20px;
`;

const PinInputContainer = styled.View`
  gap: 8px;
`;

const CenteredRow = styled.View`
  flex-direction: row;
  justify-content: center;
  align-items: center;
  gap: 8px;
`;

const SECTION_DIVIDER_STYLE = { marginVertical: 8 } as const;
const REMOTE_PIN_INPUT_STYLE = {
  textAlign: 'center',
  fontSize: 24,
  letterSpacing: 8,
  fontFamily: 'monospace',
} as const;
const CENTERED_TEXT_STYLE = { textAlign: 'center' } as const;

export function PinPairingScreen({
  route,
  navigation,
}: StackScreenProps<RootStackParameterList, 'PinPairing'>): React.JSX.Element {
  const { t } = useTranslation();
  const theme = useTheme();
  const hasKeypair = useMemeLoopStore((s) => s.hasKeypair);
  const connectedPeers = useMemeLoopStore((s) => s.connectedPeers);

  const [localPin, setLocalPin] = useState<string>('');
  const [remotePin, setRemotePin] = useState('');
  const [selectedPeerNodeId] = useState<string>(route.params?.nodeId ?? '');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const generateLocalPin = async () => {
      if (!hasKeypair) return;
      const keypair = await MemeLoop.getKeypair();
      if (!keypair) return;

      // Generate a display PIN from local public key
      const localPublicKey = keypair.x25519PublicKey;
      // For display purposes, we'll show a simplified version
      // In real pairing, both sides compute the same PIN from both public keys
      const displayPin = localPublicKey.slice(0, 6).toUpperCase();
      setLocalPin(displayPin);
    };

    void generateLocalPin();
  }, [hasKeypair]);

  const handleCopyPin = useCallback(() => {
    void Clipboard.setStringAsync(localPin);
    Alert.alert(t('Auth.PinCopied'));
  }, [localPin, t]);

  const handlePair = useCallback(async () => {
    if (!remotePin.trim() || remotePin.length !== 6) {
      Alert.alert(t('Auth.InvalidPin'));
      return;
    }

    if (!selectedPeerNodeId && connectedPeers.length === 0) {
      Alert.alert(t('Auth.NoPeerConnected'));
      return;
    }

    const targetNodeId = selectedPeerNodeId || connectedPeers[0]?.nodeId;
    if (!targetNodeId) return;

    setLoading(true);
    try {
      const result = await MemeLoop.confirmPeerPin(targetNodeId, remotePin);
      if (result.ok) {
        Alert.alert(t('Auth.PairSuccess'), '', [
          {
            text: t('Agent.OK'),
            onPress: () => {
              navigation.goBack();
            },
          },
        ]);
        setRemotePin('');
      } else {
        Alert.alert(t('Auth.PairFailed', { error: 'PIN mismatch' }));
      }
    } catch (error) {
      Alert.alert(
        t('Auth.PairFailed', {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    setLoading(false);
  }, [remotePin, selectedPeerNodeId, connectedPeers, t, navigation]);

  return (
    <Container>
      <Appbar.Header>
        <Appbar.BackAction
          onPress={() => {
            navigation.goBack();
          }}
        />
        <Appbar.Content title={t('Auth.PinPairing')} />
      </Appbar.Header>

      <ScrollContainer>
        {/* Local PIN Display */}
        <Section mode='outlined'>
          <Card.Title title={t('Auth.YourPin')} />
          <SectionContent>
            <InstructionText variant='bodyMedium'>
              {t('Auth.SharePinInstruction')}
            </InstructionText>
            <PinDisplay>
              <PinText>{localPin || '------'}</PinText>
              <CenteredRow>
                <IconButton
                  icon='content-copy'
                  size={20}
                  onPress={handleCopyPin}
                  disabled={!localPin}
                />
                <Text
                  variant='bodySmall'
                  style={{ color: theme.colors.onSurfaceVariant }}
                >
                  {t('Auth.TapToCopy')}
                </Text>
              </CenteredRow>
            </PinDisplay>
            {!hasKeypair && (
              <Button
                mode='outlined'
                onPress={() => void MemeLoop.ensureKeypair()}
              >
                {t('Auth.GenerateKeypair')}
              </Button>
            )}
          </SectionContent>
        </Section>

        <Divider style={SECTION_DIVIDER_STYLE} />

        {/* Remote PIN Input */}
        <Section mode='outlined'>
          <Card.Title title={t('Auth.EnterRemotePin')} />
          <SectionContent>
            <InstructionText variant='bodyMedium'>
              {t('Auth.EnterRemotePinInstruction')}
            </InstructionText>
            <PinInputContainer>
              <TextInput
                mode='outlined'
                label={t('Auth.RemotePin')}
                value={remotePin}
                onChangeText={(text) => {
                  setRemotePin(text.toUpperCase());
                }}
                keyboardType='default'
                maxLength={6}
                autoCapitalize='characters'
                style={REMOTE_PIN_INPUT_STYLE}
                dense={false}
              />
              {connectedPeers.length > 0 && (
                <Text
                  variant='bodySmall'
                  style={{
                    ...CENTERED_TEXT_STYLE,
                    color: theme.colors.onSurfaceVariant,
                  }}
                >
                  {t('Auth.PairingWith')}: {connectedPeers[0]?.name ||
                    connectedPeers[0]?.nodeId.slice(0, 12)}
                </Text>
              )}
            </PinInputContainer>
            <Button
              mode='contained'
              onPress={() => void handlePair()}
              loading={loading}
              disabled={loading || remotePin.length !== 6 || !hasKeypair}
            >
              {t('Auth.ConfirmPairing')}
            </Button>
          </SectionContent>
        </Section>

        {/* Instructions */}
        <Section mode='outlined'>
          <Card.Title title={t('Auth.HowItWorks')} />
          <SectionContent>
            <Text
              variant='bodySmall'
              style={{ color: theme.colors.onSurfaceVariant }}
            >
              {t('Auth.PinPairingExplanation')}
            </Text>
          </SectionContent>
        </Section>
      </ScrollContainer>
    </Container>
  );
}
