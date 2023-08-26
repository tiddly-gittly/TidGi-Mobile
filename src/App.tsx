import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import i18n from 'i18next';
import React from 'react';
import './i18n/index';
import { I18nextProvider } from 'react-i18next';
import { Config } from './pages/Config';
import { WikiWebView } from './pages/WikiWebView';

const Stack = createStackNavigator();

export const App: React.FC = () => {
  return (
    <I18nextProvider i18n={i18n}>
      <NavigationContainer>
        <Stack.Navigator initialRouteName='WikiWebView'>
          <Stack.Screen name='WikiWebView' component={WikiWebView} />
          <Stack.Screen name='Config' component={Config} />
        </Stack.Navigator>
      </NavigationContainer>
    </I18nextProvider>
  );
};
