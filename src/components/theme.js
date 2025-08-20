// src/theme.js
import { createContext } from 'react';

export const themes = {
  light: {
    background: '#ffffff',
    text: '#000000',
    primary: '#1976d2'
  },
  dark: {
    background: '#121212',
    text: '#ffffff',
    primary: '#90caf9'
  }
};

export const ThemeContext = createContext({
  theme: themes.light,
  toggleTheme: () => {}
});