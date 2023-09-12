/* eslint-disable @typescript-eslint/triple-slash-reference */
/// <reference path="./theme.d.ts" />

import { DarkTheme as reactNavigationDarkTheme, DefaultTheme as reactNavigationLightTheme } from '@react-navigation/native';
import { MD3DarkTheme, MD3LightTheme } from 'react-native-paper';

export const lightTheme = {
  ...MD3LightTheme,
  reactNavigation: reactNavigationLightTheme,
};
export const darkTheme = {
  ...MD3DarkTheme,
  reactNavigation: reactNavigationDarkTheme,
};
