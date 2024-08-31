const { Worker, isMainThread, parentPort } = require("node:worker_threads");
const { readFile } = require("node:fs/promises");
const fs = require("node:fs");
const { WASI } = require("@tybys/wasm-util");
const { argv, env } = require("node:process");
const { join } = require("node:path");

const wasi = new WASI({
  version: "preview1",
  args: argv,
  env,
  returnOnExit: true,
  preopens: {
    "./": "./",
  },
  fs,
});

let nextTid = 1;

const imports = wasi.getImportObject();
const file = readFile(
  join(
    __dirname,
    "./target/wasm32-wasip1-threads/release/wasp1-threads-example.wasm"
  )
);

if (isMainThread) {
  (async () => {
    const wasm = await WebAssembly.compile(await file);
    const opts = { initial: 17, maximum: 50, shared: true };
    const memory = new WebAssembly.Memory(opts);
    let instance = await WebAssembly.instantiate(wasm, {
      ...imports,
      wasi: {
        "thread-spawn": (arg, _threadId) => {
          const worker = new Worker(__filename, { trackUnmanagedFds: false });
          const tid = nextTid++;
          worker.postMessage({ arg, tid, memory });
          return tid;
        },
      },
      env: { memory },
    });
    wasi.start(instance);
    process.exit(0);
  })();
} else {
  const handler = async ({ arg: start_arg, tid, memory }) => {
    try {
      const wasm = await WebAssembly.compile(await file);
      let instance = await WebAssembly.instantiate(wasm, {
        ...imports,
        wasi: {
          "thread-spawn": (arg) => {
            // NOP: it is unnecessary in this example.
            return 1;
          },
        },
        env: { memory },
      });
      instance.exports.wasi_thread_start(tid, start_arg);
    } catch (e) {
      // NOP
      process.exit(0);
    }
  };
  parentPort.addListener("message", handler);
}

//
