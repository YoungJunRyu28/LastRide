/**
 * The app's website (site/ in the repo, served at lastride.jp): legal pages
 * and support. Build-time variables can point them elsewhere for testing.
 */
const configured = (value: string | undefined) => value?.trim() || null;

export const SITE_URL = 'https://lastride.jp';
/** Where users with questions go — never the rail companies (ODPT licence condition). */
export const SUPPORT_EMAIL = configured(process.env.EXPO_PUBLIC_SUPPORT_CONTACT) ?? 'support@lastride.jp';
export const SUPPORT_URL = `${SITE_URL}/support/`;
export const PRIVACY_URL = `${SITE_URL}/privacy/`;
/** Required next to subscriptions (App Review); the app licence is Apple's standard EULA, linked from here. */
export const TERMS_URL = configured(process.env.EXPO_PUBLIC_TERMS_URL) ?? `${SITE_URL}/terms/`;
export const TOKUSHOHO_URL = configured(process.env.EXPO_PUBLIC_TOKUSHOHO_URL) ?? `${SITE_URL}/tokushoho/`;

/** The English version of a lastride.jp page lives under /en/; other URLs are returned unchanged. */
export function siteLink(url: string, ja: boolean): string {
  if (ja || !url.startsWith(`${SITE_URL}/`) || url.startsWith(`${SITE_URL}/en/`)) return url;
  return `${SITE_URL}/en${url.slice(SITE_URL.length)}`;
}
