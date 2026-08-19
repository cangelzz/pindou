export class LatestRequest {
  private generation = 0;
  begin(): number { return ++this.generation; }
  invalidate(): void { this.generation++; }
  current(ticket: number): boolean { return ticket === this.generation; }
}
