import { useColorScheme } from 'react-native';

/** Koto's colour tokens, dark first. */
const darkColors = {
  backgroundPrimary: '#000000',
  backgroundSecondary: '#0a0a0a',
  backgroundTertiary: '#121212',
  borderSubtle: '#1c1c1c',
  borderDefault: '#2a2a2a',
  borderStrong: '#3d3d3d',
  textPrimary: '#f0f0f0',
  textSecondary: '#9a9a9a',
  textTertiary: '#636363',
  textDisabled: '#3a3a3a',
  accent: '#ff5a1f',
  accentHover: '#ff7a45',
  accentMuted: '#3a1c0e',
  onAccent: '#ffffff',
  success: '#00b34a',
  warning: '#ffab00',
  error: '#f0384a',
};

export type ColorTokens = typeof darkColors;

const lightColors: ColorTokens = {
  backgroundPrimary: '#ffffff',
  backgroundSecondary: '#fafafa',
  backgroundTertiary: '#f2f2f2',
  borderSubtle: '#e9e9e9',
  borderDefault: '#d6d6d6',
  borderStrong: '#b8b8b8',
  textPrimary: '#121212',
  textSecondary: '#565656',
  textTertiary: '#8f8f8f',
  textDisabled: '#cfcfcf',
  accent: '#d84515',
  accentHover: '#b8390f',
  accentMuted: '#fdece3',
  onAccent: '#ffffff',
  success: '#0a8a3d',
  warning: '#b9740a',
  error: '#c62233',
};

/** Fonts every Windows 10 and 11 PC has, so nothing needs to ship with Koto. */
export const fonts = {
  sans: 'Segoe UI',
  mono: 'Consolas',
};

export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48, xxxl: 80 } as const;
export const radius = { sm: 10, md: 16, lg: 24, xl: 32, full: 9999 } as const;
export const controlHeight = { sm: 36, md: 40, lg: 44 } as const;
/** Minimum interactive size for any control, independent of its visible size. */
export const MINIMUM_HIT_SIZE = 44;

export const typography = {
  title: { fontFamily: fonts.sans, fontSize: 28, lineHeight: 34, fontWeight: '600', letterSpacing: -0.28 },
  heading: { fontFamily: fonts.sans, fontSize: 18, lineHeight: 24, fontWeight: '600' },
  lede: { fontFamily: fonts.sans, fontSize: 17, lineHeight: 26, fontWeight: '400' },
  body: { fontFamily: fonts.sans, fontSize: 15, lineHeight: 23, fontWeight: '400' },
  label: { fontFamily: fonts.sans, fontSize: 14, lineHeight: 18, fontWeight: '500', letterSpacing: 0.14 },
  mono: { fontFamily: fonts.mono, fontSize: 13, lineHeight: 19, fontWeight: '400', fontVariant: ['tabular-nums'] },
  monoLarge: { fontFamily: fonts.mono, fontSize: 30, lineHeight: 38, fontWeight: '400', letterSpacing: 2.4, fontVariant: ['tabular-nums'] },
} as const;

export const motion = { fast: 120, interface: 150 } as const;

export function useColors(): ColorTokens {
  return useColorScheme() === 'light' ? lightColors : darkColors;
}
