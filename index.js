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
    "./target/wasm32-wasip1-threads/release/wasp1-threads-rayon-example.wasm"
  )
);

if (isMainThread) {
  const workers = [];
  const spawn = (startArg, threadId, memory) => {
    const worker = new Worker("./index.js");
    worker.onmessage = (e) => {
      if (e.data.cmd === "loaded") {
        if (typeof worker.unref === "function") {
          worker.unref();
        }
        if (!e.data.success) {
          console.error(e.data.message);
          console.error(e.data.stack);
        }
      } else if (e.data.cmd === "thread-spawn") {
        spawn(e.data.startArg, e.data.threadId);
      }
    };

    worker.onerror = (e) => {
      throw e;
    };

    const tid = nextTid++;

    if (threadId) {
      Atomics.store(threadId, 0, tid);
      Atomics.notify(threadId, 0);
    }
    worker.postMessage({ startArg, tid, memory });
    workers.push(worker);
    return tid;
  };

  (async () => {
    const wasm = await WebAssembly.compile(await file);
    const opts = { initial: 17, maximum: 200, shared: true };
    const memory = new WebAssembly.Memory(opts);
    let instance = await WebAssembly.instantiate(wasm, {
      ...imports,
      wasi: {
        "thread-spawn": (startArg, threadId) =>
          spawn(startArg, threadId, memory),
      },
      env: { memory },
    });

    wasi.start(instance);

    setTimeout(() => {
      workers.map((w) => w.terminate());
    });
  })();
} else {
  const handler = async ({ startArg, tid, memory }) => {
    try {
      const wasm = await WebAssembly.compile(await file);
      let instance = await WebAssembly.instantiate(wasm, {
        ...imports,
        wasi: {
          "thread-spawn": (startArg) => {
            const threadIdBuffer = new SharedArrayBuffer(4);
            const id = new Int32Array(threadIdBuffer);
            Atomics.store(id, 0, -1);
            postMessage({ cmd: "thread-spawn", startArg, threadId: id });
            Atomics.wait(id, 0, -1);
            const tid = Atomics.load(id, 0);
            return tid;
          },
        },
        env: { memory },
      });
      // https://github.com/toyobayashi/emnapi/blob/5ab92c706c7cd4a0a30759e58f26eedfb0ded591/packages/wasi-threads/src/wasi-threads.ts#L288-L335
      const { createInstanceProxy } = require("./proxy.js");
      instance = createInstanceProxy(instance, memory);
      wasi.start(instance);
      try {
        const symbols = Object.getOwnPropertySymbols(wasi);
        const selectDescription = (description) => (s) => {
          if (s.description) {
            return s.description === description;
          }
          return s.toString() === `Symbol(${description})`;
        };
        if (Array.isArray(description)) {
          return description.map(
            (d) => symbols.filter(selectDescription(d))[0]
          );
        }
        const kStarted = symbols.filter(selectDescription("kStarted"))[0];
        wasi[kStarted] = false;
      } catch (_) {}
      instance.exports.wasi_thread_start(tid, startArg);
    } catch (e) {
      process.exit(0);
    }
  };
  parentPort.addListener("message", handler);
}
