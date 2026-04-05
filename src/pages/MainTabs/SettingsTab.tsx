/**
 * Settings tab — auth, subscription, task monitor, app config.
 */
import type { StackNavigationProp } from '@react-navigation/stack';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView } from 'react-native';
import { Appbar, Divider, List } from 'react-native-paper';
import { styled, useTheme } from 'styled-components/native';
import type { RootStackParameterList } from '../../App';
import { useMemeLoopStore } from '../../store/memeloop';

const Container = styled.View`
  flex: 1;
  background-color: ${({ theme }) => theme.colors.background};
`;

interface SettingsTabProps {
  rootNavigation: StackNavigationProp<RootStackParameterList>;
}

export function SettingsTab({ rootNavigation }: SettingsTabProps): React.JSX.Element {
  const { t } = useTranslation();
  const theme = useTheme();
  const cloudLoggedIn = useMemeLoopStore((s) => s.cloudLoggedIn);
  const cloudEmail = useMemeLoopStore((s) => s.cloudEmail);

  return (
    <Container>
      <Appbar.Header>
        <Appbar.Content title={t('Navigation.Settings')} titleStyle={{ color: theme.colors.primary }} />
      </Appbar.Header>
      <ScrollView>
        <List.Section>
          <List.Item
            title={t('Auth.Title')}
            description={cloudLoggedIn ? cloudEmail : t('Auth.LocalMode')}
            left={(props) => <List.Icon {...props} icon="account-circle" />}
            onPress={() => rootNavigation.navigate('Auth')}
          />
          <Divider />
          <List.Item
            title={t('Subscription.Title')}
            left={(props) => <List.Icon {...props} icon="card-account-details" />}
            onPress={() => rootNavigation.navigate('Subscription')}
          />
          <Divider />
          <List.Item
            title={t('AgentManagement.Title')}
            left={(props) => <List.Icon {...props} icon="robot" />}
            onPress={() => rootNavigation.navigate('AgentManagement')}
          />
          <Divider />
          <List.Item
            title={t('TaskMonitor.Title')}
            left={(props) => <List.Icon {...props} icon="progress-check" />}
            onPress={() => rootNavigation.navigate('TaskMonitor')}
          />
          <Divider />
          <List.Item
            title={t('Terminal.Title')}
            left={(props) => <List.Icon {...props} icon="console" />}
            onPress={() => rootNavigation.navigate('Terminal')}
          />
          <Divider />
          <List.Item
            title={t('Preference.Title')}
            left={(props) => <List.Icon {...props} icon="cog" />}
            onPress={() => rootNavigation.navigate('Config')}
          />
          <Divider />
        </List.Section>
      </ScrollView>
    </Container>
  );
}
