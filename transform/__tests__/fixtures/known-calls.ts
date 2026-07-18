function viewLength(value: str): i32 {
  return value.length;
}

class Consumer {
  consume(value: str): i32 {
    return value.length;
  }
}

export function knownCallback(input: string): i32 {
  const callback = viewLength;
  const part = input.slice(1, 4);
  return callback(part);
}

export function knownMethod(input: string): i32 {
  const consumer = new Consumer();
  const part = input.substring(1, 4);
  return consumer.consume(part);
}
