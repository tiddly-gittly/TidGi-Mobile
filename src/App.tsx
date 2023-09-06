/* eslint-disable react-native/no-inline-styles */
/* eslint-disable @typescript-eslint/consistent-type-definitions */
import { NavigationContainer, NavigationProp } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import i18n from 'i18next';
import React from 'react';
import './i18n/index';
import Ionicons from '@expo/vector-icons/Ionicons';
import { HeaderBackButton } from '@react-navigation/elements';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { Config } from './pages/Config';
import { Importer } from './pages/Importer/Index';
import { MainMenu, type MainMenuProps } from './pages/MainMenu';
import { WikiWebView, type WikiWebViewProps } from './pages/WikiWebView';

export type RootStackParameterList = {
  Config: undefined;
  Importer: undefined;
  MainMenu: MainMenuProps;
  WikiWebView: WikiWebViewProps;
};
const Stack = createStackNavigator<RootStackParameterList>();

export const App: React.FC = () => {
  const { t } = useTranslation();

  return (
    <I18nextProvider i18n={i18n}>
      <NavigationContainer>
        <Stack.Navigator initialRouteName='MainMenu'>
          <Stack.Screen name='WikiWebView' component={WikiWebView} options={{ headerShown: false }} />
          <Stack.Screen
            name='Config'
            component={Config}
            options={({ navigation }) => ({
              presentation: 'modal',
              headerTitle: t('Preference.Title'),
              headerLeft: () => <HeaderBackButton label={t('Menu.Back')} onPress={(navigation as NavigationProp<ReactNavigation.RootParamList>).goBack} />,
            })}
          />
          <Stack.Screen
            name='MainMenu'
            component={MainMenu}
            options={({ navigation }) => ({
              headerTitle: t('Sidebar.Main'),
              headerRight: () => (
                <Ionicons
                  name='settings'
                  size={32}
                  color='black'
                  style={{ marginRight: 10 }}
                  onPress={() => {
                    (navigation as NavigationProp<ReactNavigation.RootParamList>).navigate('Config' as never);
                  }}
                />
              ),
            })}
          />
          <Stack.Screen name='Importer' component={Importer} />
        </Stack.Navigator>
      </NavigationContainer>
    </I18nextProvider>
  );
};
