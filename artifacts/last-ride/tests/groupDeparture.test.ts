import { describe, expect, it, vi } from 'vitest';
import { completeGroupDeparture, forgetGroupLocalAccess } from '@/lib/groupDeparture';

describe('group departure must finish local credential cleanup before navigation', () => {
  it('leaves server, then removes local token, then navigates', async () => {
    const order: string[] = [];
    await completeGroupDeparture(
      async () => { order.push('remote'); },
      async () => { order.push('local'); },
      () => { order.push('navigate'); },
    );
    expect(order).toEqual(['remote', 'local', 'navigate']);
  });

  it('does not forget a still-valid local membership if server removal fails', async () => {
    const local = vi.fn();
    const navigate = vi.fn();
    await expect(completeGroupDeparture(
      async () => { throw new Error('offline'); },
      local,
      navigate,
    )).rejects.toThrow('offline');
    expect(local).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not navigate while a secure-store delete is pending or failed', async () => {
    const navigate = vi.fn();
    let complete!: () => void;
    const pending = new Promise<void>((resolve) => { complete = resolve; });
    const departure = completeGroupDeparture(async () => undefined, () => pending, navigate);
    await Promise.resolve();
    expect(navigate).not.toHaveBeenCalled();
    complete();
    await departure;
    expect(navigate).toHaveBeenCalledOnce();

    const failedNavigate = vi.fn();
    await expect(completeGroupDeparture(
      async () => undefined,
      async () => { throw new Error('Keychain inaccessible'); },
      failedNavigate,
    )).rejects.toThrow('Keychain inaccessible');
    expect(failedNavigate).not.toHaveBeenCalled();
  });
});

describe('local group cleanup after server departure', () => {
  it('stops the durable leave-time outbox before deleting the group credential', async () => {
    const order: string[] = [];
    await forgetGroupLocalAccess(
      async () => { order.push('stop-sharing'); },
      async () => { order.push('delete-capability'); },
    );
    expect(order).toEqual(['stop-sharing', 'delete-capability']);
  });

  it('retains the membership key if local outbox cleanup fails', async () => {
    const removeCredential = vi.fn();
    await expect(forgetGroupLocalAccess(
      async () => { throw new Error('outbox storage failure'); },
      removeCredential,
    )).rejects.toThrow('outbox storage failure');
    expect(removeCredential).not.toHaveBeenCalled();
  });
});
