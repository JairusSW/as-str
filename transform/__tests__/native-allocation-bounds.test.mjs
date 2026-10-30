import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compileFixture } from "./harness.mjs";
function text(instance, pointer) {
  const memory = instance.exports.memory.buffer;
  return String.fromCharCode(
    ...new Uint16Array(
      memory,
      pointer,
      new DataView(memory).getUint32(pointer - 4, true) / 2,
    ),
  );
}
function create(module) {
  let instance;
  instance = new WebAssembly.Instance(module, {
    env: {
      abort(pointer) {
        throw new Error(text(instance, pointer));
      },
    },
  });
  return instance;
}
for (const [build, extra] of [
  ["debug", []],
  ["release", ["-O3", "--noAssert", "--enable", "simd"]],
]) {
  const modules = {};
  const instances = {};
  for (const mode of ["global", "auto", "single"]) {
    const { wasm } = compileFixture("native-allocation-bounds", {
      mode,
      suffix: `${mode}-${build}`,
      extra: [...extra, "--maximumMemory", "256"],
    });
    modules[mode] = await WebAssembly.compile(readFileSync(wasm));
    instances[mode] = create(modules[mode]);
  }
  function invoke(mode, method, args) {
    const instance = instances[mode];
    try {
      return {
        value: text(instance, instance.exports[method](...args)),
        order: instance.exports.getOrder(),
      };
    } catch {
      const order = instance.exports.getOrder();
      instances[mode] = create(modules[mode]);
      return { error: true, order };
    }
  }
  let checked = 0;
  for (let input = 0; input < 4; input++)
    for (let pad = 0; pad < 4; pad++)
      for (const count of [
        -2147483648, -2147483647, -2147483644, -8, -1, 0, 1, 2, 3, 8, 32,
      ])
        for (let operation = 0; operation < 6; operation++)
          for (const method of ["query", "explicit"]) {
            const args = [input, pad, count, operation];
            const expected = invoke("global", method, args);
            for (const mode of ["auto", "single"])
              assert.deepEqual(
                invoke(mode, method, args),
                expected,
                `${mode}/${build}/${method}/${args}`,
              );
            checked += 2;
          }
  for (const mode of ["global", "auto", "single"]) {
    const instance = create(modules[mode]);
    assert.throws(
      () => instance.exports.query(1, 0, 0x10000001, 0),
      /Invalid length/,
    );
  }
  for (const valid of [0, 1])
    for (const repeat of [0, 1]) {
      const expected = invoke("global", "effects", [valid, repeat]);
      for (const mode of ["auto", "single"])
        assert.deepEqual(
          invoke(mode, "effects", [valid, repeat]),
          expected,
          `${mode}/${build}/effects/${valid}/${repeat}`,
        );
    }
  console.log(
    `${build}: ${checked} native repeat/padding comparisons and evaluation-order checks passed`,
  );
}
