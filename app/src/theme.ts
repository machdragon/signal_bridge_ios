import { MD3LightTheme } from 'react-native-paper';

export const T = {
  bg: '#F5F5F5',
  surface: '#FFFFFF',
  primary: '#D32F2F',
  text: '#212121',
  textMuted: '#757575',
  border: '#BDBDBD',
  green: '#4CAF50',
  amber: '#FF8F00',
  red: '#D32F2F',
};

export const paperTheme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: T.primary,
    onPrimary: '#FFFFFF',
    background: T.bg,
    surface: T.surface,
  },
};
