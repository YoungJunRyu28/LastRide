/**
 * Colour themes for the widgets and the Live Activity (part of Premium, like
 * them). Chosen in the app; the colours travel in the widget's props, since
 * the widget runs in WidgetKit's runtime and can't read app settings.
 */
export type WidgetThemeId =
  | 'amber'
  | 'night'
  | 'forest'
  | 'mono'
  | 'black'
  | 'white-mono'
  | 'white-amber'
  | 'white-blue'
  | 'paper';

export type WidgetPalette = {
  background: string;
  text: string;
  /** Secondary text. */
  muted: string;
  /** Passed stops and their labels. */
  faint: string;
  /** Counting to the leave time ("you"). */
  leave: string;
  /** Counting to a train. */
  train: string;
  /** The rail's empty track. */
  track: string;
  /** "Last train has left", "Location is off". */
  alert: string;
  dark: boolean;
};

type ThemeDef = { id: WidgetThemeId; ja: string; en: string; colors: [bg: string, text: string, muted: string, leave: string, train: string, track: string] };

/** In the order shown in Settings: the dark ones, then the white ones. */
export const WIDGET_THEMES: ThemeDef[] = [
  { id: 'amber', ja: '琥珀（標準）', en: 'Amber (default)', colors: ['#0a1322', '#ffffff', '#c9d4de', '#f5a93b', '#b9adff', '#26344d'] },
  { id: 'night', ja: '夜空', en: 'Night sky', colors: ['#0b1a2e', '#ffffff', '#c3d3e6', '#6fd0ff', '#ffb4a2', '#1f3552'] },
  { id: 'forest', ja: '森', en: 'Forest', colors: ['#0d1f17', '#ffffff', '#c4d8cc', '#7ce8ad', '#f7d774', '#1f3a2d'] },
  { id: 'mono', ja: 'モノクロ', en: 'Mono', colors: ['#121212', '#ffffff', '#b5b5b5', '#ffffff', '#9a9a9a', '#2e2e2e'] },
  { id: 'black', ja: 'ブラック', en: 'Black', colors: ['#000000', '#ffffff', '#b8c2cc', '#f5a93b', '#b9adff', '#262a30'] },
  { id: 'white-mono', ja: '白 · 白黒', en: 'White · black', colors: ['#ffffff', '#000000', '#505050', '#000000', '#707070', '#e3e3e3'] },
  { id: 'white-amber', ja: '白 · 琥珀と紫', en: 'White · amber & violet', colors: ['#ffffff', '#0a1322', '#4b5a6e', '#a85a00', '#4a3fc4', '#e2e7ee'] },
  { id: 'white-blue', ja: '白 · 青と赤茶', en: 'White · blue & rust', colors: ['#ffffff', '#0a1322', '#4b5a6e', '#0369a1', '#a63d22', '#e2e7ee'] },
  { id: 'paper', ja: '紙', en: 'Paper', colors: ['#faf6ee', '#2a2118', '#5e5245', '#a85a00', '#4a3fc4', '#ebe3d6'] },
];

export const DEFAULT_WIDGET_THEME: WidgetThemeId = 'amber';

function channel(hex: string, index: number): number {
  return parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
}

/** `a` mixed into `b` by `amount` (0–1), as #rrggbb. */
function mix(a: string, b: string, amount: number): string {
  return `#${[0, 1, 2]
    .map((i) => Math.round(channel(a, i) * amount + channel(b, i) * (1 - amount)).toString(16).padStart(2, '0'))
    .join('')}`;
}

export function isWidgetTheme(value: unknown): value is WidgetThemeId {
  return WIDGET_THEMES.some((theme) => theme.id === value);
}

export function widgetPalette(id: WidgetThemeId = DEFAULT_WIDGET_THEME): WidgetPalette {
  const theme = WIDGET_THEMES.find((entry) => entry.id === id) ?? WIDGET_THEMES[0];
  const [background, text, muted, leave, train, track] = theme.colors;
  const dark = channel(background, 0) + channel(background, 1) + channel(background, 2) < 3 * 128;
  return {
    background,
    text,
    muted,
    faint: mix(text, background, dark ? 0.38 : 0.45),
    leave,
    train,
    track,
    alert: dark ? '#ff9b8a' : '#b42318',
    dark,
  };
}
