import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator, type StackScreenProps } from '@react-navigation/stack';
import { Buffer } from 'buffer';
import i18n from 'i18next';
import './i18n/index';
import { HeaderBackButton } from '@react-navigation/elements';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { useColorScheme } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import { ThemeProvider } from 'styled-components/native';
import { useShallow } from 'zustand/react/shallow';
import { darkTheme, lightTheme } from './constants/theme';
import { Config } from './pages/Config';
import { CreateWorkspace } from './pages/CreateWorkspace/Index';
import { PreviewWebView, type PreviewWebViewProps } from './pages/CreateWorkspace/PreviewWebView';
import { Importer, type ImporterProps } from './pages/Importer/Index';
import { type MainMenuProps } from './pages/MainMenu';
import { MainTabs } from './pages/MainTabs';
import { AgentManagement } from './pages/AgentManagement';
import { AuthScreen } from './pages/Auth';
import { SubscriptionScreen } from './pages/Subscription';
import { TaskMonitor } from './pages/TaskMonitor';
import { TerminalViewer } from './pages/Terminal';
import { PromptEditor } from './pages/AgentManagement/PromptEditor';
import { WikiManagement } from './pages/WikiManagement';
import { WikiWebView, type WikiWebViewProps } from './pages/WikiWebView';
import {
  WorkspaceAddServerPage,
  WorkspaceChangesPage,
  WorkspaceDetailPage,
  WorkspacePerformancePage,
  WorkspaceRoutingConfigPage,
  WorkspaceServerEditPage,
  WorkspaceSettingsPage,
  WorkspaceSubWikiManagerPage,
  WorkspaceSyncPage,
} from './pages/Workspace';

// Polyfill Buffer globally for isomorphic-git and other Node.js modules
if (typeof global.Buffer === 'undefined') {
  global.Buffer = Buffer;
}

import { initializeMobileLogger } from './services/LoggerService';
import { initializeMemeLoop } from './services/MemeLoopService';
import { useRegisterReceivingShareIntent } from './services/NativeService/hooks';
import { useConfigStore } from './store/config';
import { navigationReference } from './utils/RootNavigation';

export type RootStackParameterList = {
  AgentManagement: undefined;
  Auth: undefined;
  Config: undefined;
  CreateWorkspace: undefined;
  Importer: ImporterProps;
  MainMenu: MainMenuProps | undefined;
  PreviewWebView: PreviewWebViewProps;
  PromptEditor: { definitionId?: string };
  Subscription: undefined;
  TaskMonitor: undefined;
  Terminal: undefined;
  WikiManagement: undefined;
  WorkspaceAddServer: { id: string };
  WorkspaceChanges: { id: string };
  WorkspaceDetail: { id: string };
  WorkspacePerformance: { id: string };
  WorkspaceRoutingConfig: { id: string };
  WorkspaceServerEdit: { id: string; serverId: string };
  WorkspaceSettingsPage: { id: string };
  WorkspaceSubWikiManager: { id: string };
  WorkspaceSync: { id: string };
  WikiWebView: WikiWebViewProps;
};
const Stack = createStackNavigator<RootStackParameterList>();

function PromptEditorScreen({ route, navigation }: StackScreenProps<RootStackParameterList, 'PromptEditor'>): React.JSX.Element {
  return <PromptEditor definitionId={route.params?.definitionId} onBack={() => navigation.goBack()} onSave={() => navigation.goBack()} />;
}

export const App: React.FC = () => {
  const { t } = useTranslation();
  const themeConfig = useConfigStore(state => state.theme);
  const colorScheme = useColorScheme();
  const theme = (themeConfig === 'default' ? colorScheme : (themeConfig ?? colorScheme)) === 'light' ? lightTheme : darkTheme;
  const [translucentStatusBar, hideStatusBar] = useConfigStore(useShallow(state => [state.translucentStatusBar, state.hideStatusBar]));
  const { importSuccessSnackBar } = useRegisterReceivingShareIntent();

  useEffect(() => {
    initializeMobileLogger();
    void initializeMemeLoop();
  }, []);

  return (
    <I18nextProvider i18n={i18n}>
      <PaperProvider theme={theme}>
        <ThemeProvider theme={theme}>
          <StatusBar translucent={translucentStatusBar} hidden={hideStatusBar} />
          <NavigationContainer ref={navigationReference} theme={theme.reactNavigation}>
            <Stack.Navigator initialRouteName='MainMenu'>
              <Stack.Screen name='WikiWebView' component={WikiWebView} options={{ headerShown: false }} />
              <Stack.Screen
                name='Config'
                component={Config}
                options={({ navigation }) => ({
                  headerTitle: t('Preference.Title'),
                  headerTitleStyle: { color: theme.colors.primary },
                  headerLeft: () => (
                    <HeaderBackButton
                      label={t('Menu.Back')}
                      onPress={() => {
                        if (navigation.canGoBack()) {
                          navigation.goBack();
                          return;
                        }
                        navigation.navigate('MainMenu');
                      }}
                    />
                  ),
                })}
              />
              <Stack.Screen
                name='MainMenu'
                component={MainTabs}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name='Importer'
                options={() => ({
                  headerTitle: t('AddWorkspace.ImportWiki'),
                  headerTitleStyle: { color: theme.colors.primary },
                })}
                component={Importer}
              />
              <Stack.Screen
                name='CreateWorkspace'
                options={() => ({
                  headerTitle: t('AddWorkspace.AddWorkspace'),
                  headerTitleStyle: { color: theme.colors.primary },
                })}
                component={CreateWorkspace}
              />
              <Stack.Screen
                name='WorkspaceDetail'
                component={WorkspaceDetailPage}
                options={{ headerTitleStyle: { color: theme.colors.primary } }}
              />
              <Stack.Screen
                name='WorkspaceSync'
                component={WorkspaceSyncPage}
                options={{ headerTitleStyle: { color: theme.colors.primary } }}
              />
              <Stack.Screen
                name='WorkspaceChanges'
                component={WorkspaceChangesPage}
                options={{ headerTitleStyle: { color: theme.colors.primary } }}
              />
              <Stack.Screen
                name='WorkspaceSettingsPage'
                component={WorkspaceSettingsPage}
                options={{ headerTitleStyle: { color: theme.colors.primary } }}
              />
              <Stack.Screen
                name='WorkspaceSubWikiManager'
                component={WorkspaceSubWikiManagerPage}
                options={{ headerTitleStyle: { color: theme.colors.primary } }}
              />
              <Stack.Screen
                name='WorkspacePerformance'
                component={WorkspacePerformancePage}
                options={{ headerTitleStyle: { color: theme.colors.primary } }}
              />
              <Stack.Screen
                name='WorkspaceRoutingConfig'
                component={WorkspaceRoutingConfigPage}
                options={{ headerTitleStyle: { color: theme.colors.primary } }}
              />
              <Stack.Screen
                name='WorkspaceServerEdit'
                component={WorkspaceServerEditPage}
                options={{ headerTitleStyle: { color: theme.colors.primary } }}
              />
              <Stack.Screen
                name='WorkspaceAddServer'
                component={WorkspaceAddServerPage}
                options={{ headerTitleStyle: { color: theme.colors.primary } }}
              />
              <Stack.Screen
                name='PreviewWebView'
                options={() => ({
                  headerTitle: t('AddWorkspace.PreviewWebView'),
                  headerTitleStyle: { color: theme.colors.primary },
                })}
                component={PreviewWebView}
              />
              <Stack.Screen
                name='Auth'
                component={AuthScreen}
                options={{ headerTitle: t('Auth.Title'), headerTitleStyle: { color: theme.colors.primary } }}
              />
              <Stack.Screen
                name='Subscription'
                component={SubscriptionScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name='AgentManagement'
                component={AgentManagement}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name='TaskMonitor'
                component={TaskMonitor}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name='Terminal'
                component={TerminalViewer}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name='PromptEditor'
                component={PromptEditorScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name='WikiManagement'
                component={WikiManagement}
                options={{ headerShown: false }}
              />
            </Stack.Navigator>
            {importSuccessSnackBar}
          </NavigationContainer>
        </ThemeProvider>
      </PaperProvider>
    </I18nextProvider>
  );
};
