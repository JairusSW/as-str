// Allocation instrumentation is deliberately separate from timed builds.
// RTrace load/store hooks must return the original pointer, and onvisit must
// permit the collector to trace live objects.
export async function instantiateRuntime(module) {
  let allocs = 0;
  let resizes = 0;
  let exports;
  const noop = () => {};
  const instance = await WebAssembly.instantiate(module, {
    env: {
      abort(pointer) {
        if (!exports || !pointer) throw new Error("AssemblyScript abort");
        const memory = exports.memory.buffer;
        const length = new DataView(memory).getUint32(pointer - 4, true) / 2;
        const units = new Uint16Array(memory, pointer, length);
        throw new Error(String.fromCharCode(...units));
      },
    },
    rtrace: {
      onalloc() {
        allocs++;
      },
      onresize() {
        resizes++;
      },
      onload: (pointer) => pointer,
      onstore: (pointer) => pointer,
      onvisit: () => 1,
      oninit: noop,
      onfree: noop,
      onmove: noop,
      oncollect: noop,
      oninterrupt: noop,
      onyield: noop,
    },
  });
  exports = instance.exports;
  return {
    exports,
    resetCounts() {
      allocs = 0;
      resizes = 0;
    },
    counts() {
      return { allocs, resizes };
    },
  };
}
