/**
 * Invite links. With EXPO_PUBLIC_APP_JOIN_BASE_URL set (https://lastride.jp),
 * links are https: they open the app when it's installed (universal links, via
 * site/.well-known/apple-app-site-association) and a page saying how to get it
 * otherwise, and they show as links in every messaging app. Without it (dev
 * builds), the last-ride:// scheme.
 */
import * as Linking from 'expo-linking';

function base(): string | null {
  return process.env.EXPO_PUBLIC_APP_JOIN_BASE_URL?.trim().replace(/\/+$/, '') || null;
}

/** Business event invite: /join?token=… */
export function eventJoinLink(token: string): string {
  const configured = base();
  return `${configured ? `${configured}/join` : 'last-ride://join'}?token=${encodeURIComponent(token)}`;
}

/** Group invite: /group-join?invite=… */
export function groupInviteLink(inviteToken: string): string {
  const configured = base();
  return configured
    ? `${configured}/group-join?invite=${encodeURIComponent(inviteToken)}`
    : Linking.createURL('group-join', { queryParams: { invite: inviteToken } });
}
