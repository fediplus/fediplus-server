import { Worker } from "bullmq";
import { redisConnection } from "./connection.js";
import {
  processFederationJob,
  type FederationJobData,
} from "./processors/federation.js";
import { processEmailJob, type EmailJobData } from "./processors/email.js";

const workers: Worker[] = [];

export function startWorkers() {
  const federationWorker = new Worker<FederationJobData>(
    "federation",
    processFederationJob,
    {
      connection: redisConnection,
      concurrency: 5,
    }
  );

  const emailWorker = new Worker<EmailJobData>("email", processEmailJob, {
    connection: redisConnection,
    concurrency: 2,
  });

  federationWorker.on("failed", (job, err) => {
    console.error(
      `[federation-worker] Job ${job?.id} (${job?.data?.type}) failed:`,
      err.message
    );
  });

  emailWorker.on("failed", (job, err) => {
    console.error(
      `[email-worker] Job ${job?.id} (${job?.data?.type}) failed:`,
      err.message
    );
  });

  workers.push(federationWorker, emailWorker);
  console.log("[jobs] Workers started: federation, email");
}

export async function stopWorkers() {
  await Promise.all(workers.map((w) => w.close()));
}
