import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import i18n from 'i18next';
import React from 'react';
import './i18n/index';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { Button } from 'react-native';
import { Config } from './pages/Config';
import { MainMenu } from './pages/MainMenu';
import { WikiWebView } from './pages/WikiWebView';

const Stack = createStackNavigator();

export const App: React.FC = () => {
  const { t } = useTranslation();
  return (
    <I18nextProvider i18n={i18n}>
      <NavigationContainer>
        <Stack.Navigator initialRouteName='WikiWebView'>
          <Stack.Screen name='WikiWebView' component={WikiWebView} options={{ headerShown: false }} />
          <Stack.Screen
            name='Config'
            component={Config}
            options={({ navigation }) => ({
              presentation: 'modal',
              headerLeft: () => <Button title={t('Menu.Back')} onPress={navigation.goBack} />,
            })}
          />
          <Stack.Screen name='MainMenu' component={MainMenu} />
        </Stack.Navigator>
      </NavigationContainer>
    </I18nextProvider>
  );
};
