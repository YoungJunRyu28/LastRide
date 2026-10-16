/**
 * Design tokens for LastRide's night palette ("design 3": dark app, amber
 * accents, map card). The app is always dark; it is used at night.
 *
 * Every text/background pair used in the UI clears WCAG AA (4.5:1); the
 * weakest is mutedForeground on secondary at 5.5:1.
 */

const night = {
  // Legacy aliases (kept for backward compatibility)
  text: '#EAF0F7',
  tint: '#F5A93B',

  // Core surfaces
  background: '#0A1322',
  foreground: '#EAF0F7',

  // Cards / elevated surfaces
  card: '#111D31',
  cardForeground: '#EAF0F7',

  // Primary action color (buttons, active tab, countdown)
  primary: '#F5A93B',
  primaryForeground: '#0A1322',

  // Chips, inactive segments, icon tiles
  secondary: '#1B2A44',
  secondaryForeground: '#EAF0F7',

  // Raised strips (group strip, pinned banner)
  muted: '#16233A',
  mutedForeground: '#8FA2B8',

  // Accent highlights
  accent: '#1B2A44',
  accentForeground: '#F5A93B',

  // Destructive actions and "hurry" / missed states
  destructive: '#FF8A7A',
  destructiveForeground: '#0A1322',

  // Borders and input outlines
  border: '#1F2E48',
  input: '#263753',

  // Secondary body text on cards (subtitles that need more weight than muted)
  subtle: '#C9D4DE',

  // Map card ground, roads and water (placeholder until the Apple map lands)
  map: '#18212E',
  mapRoad: '#263244',
  mapWater: '#142A40',

  // Line colour used for the station tag on the map card
  line: '#8F76D6',

  // Counting to a train (the leave time is primary): timeline rail, countdown after leaving
  train: '#B9ADFF',
};

const colors = {
  light: night,
  dark: night,

  // Border radius (in px) for cards, buttons and inputs.
  radius: 20,
};

export default colors;
