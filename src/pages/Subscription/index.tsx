import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Linking, ScrollView } from 'react-native';
import { Appbar, Button, Card, Divider, IconButton, ProgressBar, Switch, Text, TextInput } from 'react-native-paper';
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

const ProviderCard = styled(Card)`
  margin: 4px 0;
`;

interface SubscriptionStatus {
  plan: string;
  status: string;
  tokenUsed: number;
  tokenTotal: number;
}

interface ProviderEntry {
  name: string;
  baseUrl: string;
  apiKey: string;
}

export function SubscriptionScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const theme = useTheme();
  const subscriptionMode = useMemeLoopStore((s) => s.subscriptionMode);
  const providers = useMemeLoopStore((s) => s.providers);

  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatus | null>(null);
  const [newProvider, setNewProvider] = useState<ProviderEntry>({ name: '', baseUrl: '', apiKey: '' });
  const [showAddForm, setShowAddForm] = useState(false);

  useEffect(() => {
    void MemeLoop.rpcCall<SubscriptionStatus>('memeloop.subscription.status')
      .then(setSubscriptionStatus)
      .catch(() => setSubscriptionStatus(null));
  }, []);

  const handleToggleSubscription = useCallback((value: boolean) => {
    useMemeLoopStore.getState().setSubscriptionMode(value);
  }, []);

  const handleAddProvider = useCallback(() => {
    if (!newProvider.name.trim() || !newProvider.baseUrl.trim()) return;
    useMemeLoopStore.getState().setProviders([
      ...providers,
      { name: newProvider.name, baseUrl: newProvider.baseUrl, hasApiKey: !!newProvider.apiKey },
    ]);
    // Store via RPC
    void MemeLoop.rpcCall('memeloop.provider.add', {
      name: newProvider.name,
      baseUrl: newProvider.baseUrl,
      apiKey: newProvider.apiKey,
    }).catch(() => {});
    setNewProvider({ name: '', baseUrl: '', apiKey: '' });
    setShowAddForm(false);
  }, [newProvider, providers]);

  const handleDeleteProvider = useCallback((name: string) => {
    Alert.alert(t('Subscription.Delete'), '', [
      { text: t('Agent.Cancel'), style: 'cancel' },
      {
        text: t('Subscription.Delete'),
        style: 'destructive',
        onPress: () => {
          useMemeLoopStore.getState().setProviders(providers.filter((p) => p.name !== name));
          void MemeLoop.rpcCall('memeloop.provider.delete', { name }).catch(() => {});
        },
      },
    ]);
  }, [providers, t]);

  const tokenProgress = subscriptionStatus
    ? subscriptionStatus.tokenTotal > 0 ? subscriptionStatus.tokenUsed / subscriptionStatus.tokenTotal : 0
    : 0;

  return (
    <Container>
      <Appbar.Header>
        <Appbar.Content title={t('Subscription.Title')} />
      </Appbar.Header>

      {/* Subscription mode toggle */}
      <Section mode="outlined">
        <SectionContent>
          <Row>
            <Text variant="bodyLarge">{t('Subscription.SubscriptionMode')}</Text>
            <Switch value={subscriptionMode} onValueChange={handleToggleSubscription} />
          </Row>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant ?? '#888' }}>
            {t('Subscription.SubscriptionModeDesc')}
          </Text>
        </SectionContent>
      </Section>

      {/* Subscription status */}
      {subscriptionStatus && (
        <Section mode="outlined">
          <Card.Title title={t('Subscription.CurrentPlan')} subtitle={`${subscriptionStatus.plan} — ${subscriptionStatus.status}`} />
          <SectionContent>
            <Text variant="labelMedium">{t('Subscription.TokenUsage')}</Text>
            <ProgressBar progress={tokenProgress} color={tokenProgress > 0.9 ? theme.colors.error : theme.colors.primary} />
            <Text variant="bodySmall">
              {subscriptionStatus.tokenTotal > 0
                ? t('Subscription.TokensUsed', { used: subscriptionStatus.tokenUsed, total: subscriptionStatus.tokenTotal })
                : t('Subscription.Unlimited')}
            </Text>
            <Button mode="outlined" onPress={() => void MemeLoop.rpcCall<{ url: string }>('memeloop.subscription.billingUrl').then(
              (r) => Linking.openURL(r.url),
            ).catch(() => {})}>
              {t('Subscription.ManageBilling')}
            </Button>
          </SectionContent>
        </Section>
      )}

      <Divider style={{ marginHorizontal: 16 }} />

      {/* Custom providers */}
      <Section mode="outlined">
        <Card.Title
          title={t('Subscription.Providers')}
          right={() => (
            <IconButton icon="plus" onPress={() => setShowAddForm(true)} />
          )}
        />
        <SectionContent>
          {providers.length === 0 && !showAddForm && (
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant ?? '#888' }}>
              {t('Subscription.NoProviders')}
            </Text>
          )}
          {providers.map((provider) => (
            <ProviderCard key={provider.name} mode="outlined">
              <Card.Title
                title={provider.name}
                subtitle={provider.baseUrl}
                right={() => (
                  <IconButton icon="delete" onPress={() => handleDeleteProvider(provider.name)} />
                )}
              />
            </ProviderCard>
          ))}

          {showAddForm && (
            <>
              <Divider />
              <TextInput mode="outlined" label={t('Subscription.ProviderName')} value={newProvider.name} onChangeText={(v) => setNewProvider((p) => ({ ...p, name: v }))} dense />
              <TextInput mode="outlined" label={t('Subscription.BaseUrl')} value={newProvider.baseUrl} onChangeText={(v) => setNewProvider((p) => ({ ...p, baseUrl: v }))} autoCapitalize="none" dense />
              <TextInput mode="outlined" label={t('Subscription.ApiKey')} value={newProvider.apiKey} onChangeText={(v) => setNewProvider((p) => ({ ...p, apiKey: v }))} secureTextEntry dense />
              <Row>
                <Button onPress={() => setShowAddForm(false)}>{t('Agent.Cancel')}</Button>
                <Button mode="contained" onPress={handleAddProvider}>{t('Subscription.Save')}</Button>
              </Row>
            </>
          )}
        </SectionContent>
      </Section>
    </Container>
  );
}
