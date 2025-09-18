export class RingBuffer<T> {
  private buffer: T[] = [];
  constructor(private maxSize: number) {}

  push(item: T) {
    if (this.buffer.length >= this.maxSize) this.buffer.shift();
    this.buffer.push(item);
  }

  getAll() {
    return [...this.buffer];
  }
}

export const events = new RingBuffer<any>(500);
