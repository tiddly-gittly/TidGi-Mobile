/**
 * Bottom tab navigator for the four main sections: Wikis, Agent, Nodes, Settings.
 * Sits inside the root StackNavigator so full-screen pages push on top.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { StackScreenProps } from '@react-navigation/stack';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from 'styled-components/native';
import type { RootStackParameterList } from '../../App';
import { AgentTab } from './AgentTab';
import { NodesTab } from './NodesTab';
import { SettingsTab } from './SettingsTab';
import { WikisTab } from './WikisTab';

export type MainTabParameterList = {
  WikisTab: undefined;
  AgentTab: undefined;
  NodesTab: undefined;
  SettingsTab: undefined;
};

const Tab = createBottomTabNavigator<MainTabParameterList>();

export function MainTabs({ navigation }: StackScreenProps<RootStackParameterList, 'MainMenu'>): React.JSX.Element {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.onSurfaceVariant ?? '#888',
        tabBarStyle: { backgroundColor: theme.colors.surface },
      }}
    >
      <Tab.Screen
        name="WikisTab"
        options={{
          tabBarLabel: t('Navigation.Wikis'),
          tabBarIcon: ({ color, size }) => <Ionicons name="library" size={size} color={color} />,
        }}
      >
        {() => <WikisTab rootNavigation={navigation} />}
      </Tab.Screen>
      <Tab.Screen
        name="AgentTab"
        options={{
          tabBarLabel: t('Navigation.Agent'),
          tabBarIcon: ({ color, size }) => <Ionicons name="chatbubbles" size={size} color={color} />,
        }}
      >
        {() => <AgentTab rootNavigation={navigation} />}
      </Tab.Screen>
      <Tab.Screen
        name="NodesTab"
        options={{
          tabBarLabel: t('Navigation.Nodes'),
          tabBarIcon: ({ color, size }) => <Ionicons name="git-network" size={size} color={color} />,
        }}
      >
        {() => <NodesTab />}
      </Tab.Screen>
      <Tab.Screen
        name="SettingsTab"
        options={{
          tabBarLabel: t('Navigation.Settings'),
          tabBarIcon: ({ color, size }) => <Ionicons name="settings" size={size} color={color} />,
        }}
      >
        {() => <SettingsTab rootNavigation={navigation} />}
      </Tab.Screen>
    </Tab.Navigator>
  );
}
