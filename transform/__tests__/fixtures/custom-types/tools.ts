export class Tool {
  static from(value: string): Tool {
    return new Tool(value.length);
  }
  constructor(public length: i32) {}
}
