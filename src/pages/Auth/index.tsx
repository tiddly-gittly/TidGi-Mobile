import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, ScrollView } from 'react-native';
import { Button, Card, Divider, Text, TextInput } from 'react-native-paper';
import { styled, useTheme } from 'styled-components/native';
import * as MemeLoop from '../../services/MemeLoopService';
import { useMemeLoopStore } from '../../store/memeloop';

const Container = styled.ScrollView`
  flex: 1;
  background-color: ${({ theme }) => theme.colors.background};
`;

const Section = styled(Card)`
  margin: 12px 16px;
`;

const SectionContent = styled(Card.Content)`
  gap: 12px;
`;

const Row = styled.View`
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
`;

export function AuthScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const theme = useTheme();
  const nodeId = useMemeLoopStore((s) => s.nodeId);
  const hasKeypair = useMemeLoopStore((s) => s.hasKeypair);
  const cloudLoggedIn = useMemeLoopStore((s) => s.cloudLoggedIn);
  const cloudEmail = useMemeLoopStore((s) => s.cloudEmail);
  const cloudNodeRegistered = useMemeLoopStore((s) => s.cloudNodeRegistered);
  const cloudUrl = useMemeLoopStore((s) => s.cloudUrl);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [customCloudUrl, setCustomCloudUrl] = useState(cloudUrl ?? 'https://cloud.memeloop.app');
  const [loading, setLoading] = useState(false);

  const handleLogin = useCallback(async () => {
    if (!email.trim() || !password.trim()) return;
    setLoading(true);
    try {
      const result = await MemeLoop.cloudLogin(customCloudUrl, email, password);
      if (result.ok) {
        Alert.alert(t('Auth.LoginSuccess'));
      } else {
        Alert.alert(t('Auth.LoginFailed', { error: result.error }));
      }
    } catch (error) {
      Alert.alert(t('Auth.LoginFailed', { error: error instanceof Error ? error.message : String(error) }));
    }
    setLoading(false);
  }, [email, password, customCloudUrl, t]);

  const handleLogout = useCallback(() => {
    MemeLoop.cloudLogout();
    setEmail('');
    setPassword('');
  }, []);

  const handleRequestOtp = useCallback(async () => {
    const jwt = useMemeLoopStore.getState().cloudJwt;
    if (!jwt) return;
    setLoading(true);
    try {
      await MemeLoop.requestNodeOtp(customCloudUrl, jwt);
      Alert.alert(t('Auth.OtpSent'));
    } catch (error) {
      Alert.alert(t('Auth.RegisterFailed', { error: error instanceof Error ? error.message : String(error) }));
    }
    setLoading(false);
  }, [customCloudUrl, t]);

  const handleRegisterWithOtp = useCallback(async () => {
    const jwt = useMemeLoopStore.getState().cloudJwt;
    if (!jwt || !otp.trim()) return;
    setLoading(true);
    try {
      await MemeLoop.registerNodeWithOtp(customCloudUrl, jwt, otp);
      Alert.alert(t('Auth.RegisterSuccess'));
      setOtp('');
    } catch (error) {
      Alert.alert(t('Auth.RegisterFailed', { error: error instanceof Error ? error.message : String(error) }));
    }
    setLoading(false);
  }, [customCloudUrl, otp, t]);

  return (
    <Container>
      {/* Node Identity */}
      <Section mode="outlined">
        <Card.Title title={t('Auth.Title')} />
        <SectionContent>
          <Row>
            <Text variant="bodyMedium">Node ID</Text>
            <Text variant="bodySmall" style={{ fontFamily: 'monospace' }}>{nodeId ? nodeId.slice(0, 16) + '…' : '—'}</Text>
          </Row>
          <Row>
            <Text variant="bodyMedium">Keypair</Text>
            <Text variant="bodySmall">{hasKeypair ? '✅' : '❌'}</Text>
          </Row>
          {!hasKeypair && (
            <Button mode="outlined" onPress={() => void MemeLoop.ensureKeypair()}>
              Generate Keypair
            </Button>
          )}
        </SectionContent>
      </Section>

      <Divider />

      {/* Cloud Login */}
      <Section mode="outlined">
        <Card.Title title={t('Auth.CloudLogin')} />
        <SectionContent>
          {cloudLoggedIn
            ? (
              <>
                <Row>
                  <Text variant="bodyMedium">{t('Auth.Email')}</Text>
                  <Text variant="bodySmall">{cloudEmail}</Text>
                </Row>
                <Row>
                  <Text variant="bodyMedium">{t('Auth.NodeRegistration')}</Text>
                  <Text variant="bodySmall">{cloudNodeRegistered ? '✅ Registered' : '❌ Not registered'}</Text>
                </Row>
                <Button mode="outlined" onPress={handleLogout}>{t('Auth.Logout')}</Button>
              </>
            )
            : (
              <>
                <TextInput
                  mode="outlined"
                  label="Cloud URL"
                  value={customCloudUrl}
                  onChangeText={setCustomCloudUrl}
                  autoCapitalize="none"
                  dense
                />
                <TextInput
                  mode="outlined"
                  label={t('Auth.Email')}
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  dense
                />
                <TextInput
                  mode="outlined"
                  label={t('Auth.Password')}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  dense
                />
                <Button mode="contained" onPress={() => void handleLogin()} loading={loading} disabled={loading}>
                  {t('Auth.Login')}
                </Button>
              </>
            )}
        </SectionContent>
      </Section>

      {/* Node Registration (only if logged in but not registered) */}
      {cloudLoggedIn && !cloudNodeRegistered && (
        <Section mode="outlined">
          <Card.Title title={t('Auth.NodeRegistration')} />
          <SectionContent>
            <Button mode="outlined" onPress={() => void handleRequestOtp()} loading={loading} disabled={loading}>
              {t('Auth.RequestOtp')}
            </Button>
            <TextInput
              mode="outlined"
              label={t('Auth.EnterOtp')}
              value={otp}
              onChangeText={setOtp}
              keyboardType="numeric"
              maxLength={6}
              dense
            />
            <Button mode="contained" onPress={() => void handleRegisterWithOtp()} loading={loading} disabled={loading || otp.length !== 6}>
              {t('Auth.RegisterNode')}
            </Button>
          </SectionContent>
        </Section>
      )}

      {/* Local Mode */}
      <Section mode="outlined">
        <Card.Title title={t('Auth.LocalMode')} />
        <SectionContent>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant ?? '#888' }}>
            {t('Auth.LocalModeDesc')}
          </Text>
        </SectionContent>
      </Section>
    </Container>
  );
}
