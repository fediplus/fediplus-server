import * as mediasoup from "mediasoup";
import type { Worker } from "mediasoup/types";
import { config } from "../config.js";

const workers: Worker[] = [];
let nextWorkerIndex = 0;

export async function initializeWorkers(): Promise<void> {
  const numWorkers = Math.min(2, (await import("node:os")).cpus().length);

  for (let i = 0; i < numWorkers; i++) {
    const worker = await mediasoup.createWorker({
      rtcMinPort: config.mediasoup.rtcMinPort,
      rtcMaxPort: config.mediasoup.rtcMaxPort,
      logLevel: "warn",
    });

    worker.on("died", () => {
      console.error(`mediasoup Worker ${worker.pid} died, exiting...`);
      process.exit(1);
    });

    workers.push(worker);
    console.log(`mediasoup Worker ${worker.pid} started`);
  }
}

export function getNextWorker(): Worker {
  if (workers.length === 0) {
    throw new Error("mediasoup workers not initialized");
  }
  const worker = workers[nextWorkerIndex];
  nextWorkerIndex = (nextWorkerIndex + 1) % workers.length;
  return worker;
}

export async function closeWorkers(): Promise<void> {
  for (const worker of workers) {
    worker.close();
  }
  workers.length = 0;
}
