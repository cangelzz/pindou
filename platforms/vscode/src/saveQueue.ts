export class SaveQueue {
  private pending = 0;
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly setSaving: (saving: boolean) => void) {}

  run(operation: () => Promise<void>): Promise<void> {
    if (this.pending++ === 0) this.setSaving(true);
    const result = this.tail.then(operation);
    this.tail = result.catch(() => undefined).then(() => {
      if (--this.pending === 0) this.setSaving(false);
    });
    return result;
  }
}
