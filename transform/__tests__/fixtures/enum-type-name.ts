enum Str {
  Seven = 7,
  Nine = 9,
}
function echo(value: Str): Str {
  return value;
}
function identity<T>(value: T): T {
  return value;
}
class Holder {
  constructor(public values: Array<Str>) {}
  read(): Str {
    return this.values[0];
  }
}
export function run(): i32 {
  const values = new Array<Str>();
  values.push(echo(Str.Seven));
  values.push(identity<Str>(Str.Nine));
  return new Holder(values).read() + values[1];
}
