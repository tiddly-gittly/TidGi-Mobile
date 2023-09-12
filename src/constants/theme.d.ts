import 'styled-components/native';
import type { MD3DarkTheme, MD3LightTheme } from 'react-native-paper';
declare module 'styled-components/native' {
  export interface DefaultTheme {
    colors: typeof MD3DarkTheme['colors'] & typeof MD3LightTheme['colors'];
  }
}
