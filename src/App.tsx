/* eslint-disable react-native/no-inline-styles */
/* eslint-disable @typescript-eslint/consistent-type-definitions */
import { NavigationContainer, NavigationProp } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import i18n from 'i18next';
import './i18n/index';
import Ionicons from '@expo/vector-icons/Ionicons';
import { HeaderBackButton } from '@react-navigation/elements';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { useColorScheme } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import { ThemeProvider } from 'styled-components';
import { useShallow } from 'zustand/react/shallow';
import { darkTheme, lightTheme } from './constants/theme';
import { Config } from './pages/Config';
import { CreateWorkspace } from './pages/CreateWorkspace/Index';
import { PreviewWebView, type PreviewWebViewProps } from './pages/CreateWorkspace/PreviewWebView';
import { Importer, type ImporterProps } from './pages/Importer/Index';
import { MainMenu, type MainMenuProps } from './pages/MainMenu';
import { WikiWebView, type WikiWebViewProps } from './pages/WikiWebView';
import { useRegisterReceivingShareIntent } from './services/NativeService/hooks';
import { useConfigStore } from './store/config';
import { navigationReference } from './utils/RootNavigation';

export type RootStackParameterList = {
  Config: undefined;
  CreateWorkspace: undefined;
  Importer: ImporterProps;
  MainMenu: MainMenuProps;
  PreviewWebView: PreviewWebViewProps;
  WikiWebView: WikiWebViewProps;
};
const Stack = createStackNavigator<RootStackParameterList>();

export const App: React.FC = () => {
  const { t } = useTranslation();
  const themeConfig = useConfigStore(state => state.theme);
  const colorScheme = useColorScheme();
  const theme = (themeConfig === 'default' ? colorScheme : (themeConfig ?? colorScheme)) === 'light' ? lightTheme : darkTheme;
  const [translucentStatusBar, hideStatusBar] = useConfigStore(useShallow(state => [state.translucentStatusBar, state.hideStatusBar]));
  const { importSuccessSnackBar } = useRegisterReceivingShareIntent();

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
                  presentation: 'modal' as const,
                  headerTitle: t('Preference.Title'),
                  headerTitleStyle: { color: theme.colors.primary },
                  headerLeft: () => <HeaderBackButton label={t('Menu.Back')} onPress={navigation.goBack} />,
                })}
              />
              <Stack.Screen
                name='MainMenu'
                component={MainMenu}
                options={({ navigation }) => ({
                  headerTitle: t('Sidebar.Main'),
                  headerTitleStyle: { color: theme.colors.primary },
                  headerRight: () => (
                    <Ionicons
                      name='settings'
                      size={32}
                      color={theme.colors.primary}
                      style={{ marginRight: 10 }}
                      onPress={() => {
                        navigation.navigate('Config' as never);
                      }}
                    />
                  ),
                })}
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
                name='PreviewWebView'
                options={() => ({
                  headerTitle: t('AddWorkspace.PreviewWebView'),
                  headerTitleStyle: { color: theme.colors.primary },
                })}
                component={PreviewWebView}
              />
            </Stack.Navigator>
            {importSuccessSnackBar}
          </NavigationContainer>
        </ThemeProvider>
      </PaperProvider>
    </I18nextProvider>
  );
};
