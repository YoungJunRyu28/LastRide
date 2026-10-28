import { describe, expect, it, vi } from 'vitest';
import { shareLatestGroupInvite } from '@/lib/shareLatestGroupInvite';

describe('sharing group invitations after another member rotates their token', () => {
  it('shares only the freshly retrieved invite and updates stale UI metadata', async () => {
    const applied = vi.fn();
    const shared = vi.fn(async (_: string) => undefined);
    const cached = { invite: 'old-revoked-token' };
    const latest = { invite: 'new-active-token' };
    expect(await shareLatestGroupInvite(
      async () => latest,
      (value) => value.invite,
      applied,
      shared,
    )).toBe(true);
    expect(applied).toHaveBeenCalledWith(latest);
    expect(shared).toHaveBeenCalledWith('new-active-token');
    expect(shared).not.toHaveBeenCalledWith(cached.invite);
  });

  it('never opens the share sheet when the server cannot verify the invite', async () => {
    const shared = vi.fn();
    await expect(shareLatestGroupInvite(
      async (): Promise<{ invite: string }> => { throw new Error('offline'); },
      (value) => value.invite,
      vi.fn(),
      shared,
    )).rejects.toThrow('offline');
    expect(shared).not.toHaveBeenCalled();
  });

  it('does not share if the server removed the invitation', async () => {
    const shared = vi.fn();
    const applied = vi.fn();
    expect(await shareLatestGroupInvite(
      async () => ({ invite: null }),
      (value) => value.invite,
      applied,
      shared,
    )).toBe(false);
    expect(applied).toHaveBeenCalledOnce();
    expect(shared).not.toHaveBeenCalled();
  });

  it('does not open the share sheet before the fresh response resolves', async () => {
    let reply!: (fresh: { invite: string }) => void;
    const waiting = new Promise<{ invite: string }>((resolve) => { reply = resolve; });
    const shared = vi.fn(async (_: string) => undefined);
    const call = shareLatestGroupInvite(() => waiting, ({ invite }) => invite, vi.fn(), shared);
    await Promise.resolve();
    expect(shared).not.toHaveBeenCalled();
    reply({ invite: 'new' });
    await call;
    expect(shared).toHaveBeenCalledWith('new');
  });
});
