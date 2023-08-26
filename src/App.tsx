import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import React from 'react';
import { Config } from './pages/Config';
import { WikiWebView } from './pages/WikiWebView';

const Stack = createStackNavigator();

export const App: React.FC = () => {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName='WikiWebView'>
        <Stack.Screen name='WikiWebView' component={WikiWebView} />
        <Stack.Screen name='Config' component={Config} />
      </Stack.Navigator>
    </NavigationContainer>
  );
};
