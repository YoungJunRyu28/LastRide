/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    // Legacy aliases (kept for backward compatibility)
    text: '#112238',
    tint: '#F2A33A',

    // Core surfaces
    background: '#F5F7F5',
    foreground: '#112238',

    // Cards / elevated surfaces
    card: '#FFFFFF',
    cardForeground: '#112238',

    // Primary action color (buttons, links, active states)
    primary: '#F2A33A',
    primaryForeground: '#112238',

    // Secondary / less-emphasis interactive surfaces
    secondary: '#DDEBE5',
    secondaryForeground: '#163C42',

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: '#E8EFEC',
    mutedForeground: '#586766',

    // Accent highlights (badges, selected items, focus rings)
    accent: '#DCEBE8',
    accentForeground: '#163C42',

    // Destructive actions (delete, error states)
    destructive: '#B84B4B',
    destructiveForeground: '#FFFFFF',

    // Borders and input outlines
    border: '#D6E0DC',
    input: '#D6E0DC',
  },

  // Border radius (in px). Sync from the sibling web artifact's --radius
  // CSS variable. This value applies to cards, buttons, inputs, and modals.
  radius: 22,
};

export default colors;
