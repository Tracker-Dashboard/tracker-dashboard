/** Regroupe les appels concurrents portant sur la meme cle autour d'une seule promesse. */
export class SingleFlight<T> {
  private readonly inFlight = new Map<string, Promise<T>>();

  run(key: string, task: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const current = Promise.resolve().then(task);
    this.inFlight.set(key, current);
    void current.finally(() => {
      if (this.inFlight.get(key) === current) this.inFlight.delete(key);
    }).catch(() => {});
    return current;
  }
}
