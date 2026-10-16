/**
 * Protects group details against out-of-order network replies. A successful
 * local mutation or removal invalidates every GET started before it. Only
 * the newest GET is allowed to apply if no mutation has happened since.
 */
export class GroupRefreshGuard {
  private readonly versions = new Map<string, number>();
  private readonly requests = new Map<string, number>();

  begin(groupId: string): { groupId: string; version: number; request: number } {
    const request = (this.requests.get(groupId) ?? 0) + 1;
    this.requests.set(groupId, request);
    return { groupId, version: this.versions.get(groupId) ?? 0, request };
  }

  changed(groupId: string): void {
    this.versions.set(groupId, (this.versions.get(groupId) ?? 0) + 1);
  }

  isCurrent(ticket: ReturnType<GroupRefreshGuard["begin"]>): boolean {
    return (
      this.requests.get(ticket.groupId) === ticket.request &&
      (this.versions.get(ticket.groupId) ?? 0) === ticket.version
    );
  }
}
