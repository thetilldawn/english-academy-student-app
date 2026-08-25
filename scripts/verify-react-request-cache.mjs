import assert from "node:assert/strict";
import { Writable } from "node:stream";

import React from "react";
import rscServer from "next/dist/compiled/react-server-dom-webpack/server.node.js";

const { renderToPipeableStream } = rscServer;

let calls = 0;
const readCatalog = React.cache(async (key) => {
  calls += 1;
  return key;
});

async function Probe() {
  await Promise.all([readCatalog("catalog"), readCatalog("catalog")]);
  return React.createElement("div", null, "ok");
}

function renderRequest() {
  return new Promise((resolve, reject) => {
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
      final(callback) {
        callback();
        resolve();
      },
    });
    output.on("error", reject);
    renderToPipeableStream(React.createElement(Probe), {}).pipe(output);
  });
}

try {
  await renderRequest();
  assert.equal(calls, 1, "same RSC request must deduplicate");

  await renderRequest();
  assert.equal(calls, 2, "a new RSC request must load again");

  process.stdout.write(`${JSON.stringify({ status: "ok", calls })}\n`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
