import { emailQueue } from "../jobs/queues.js";

export async function sendVerificationEmail(to: string, token: string) {
  await emailQueue.add("verification", { type: "verification", to, token });
}

export async function sendPasswordResetEmail(to: string, token: string) {
  await emailQueue.add("passwordReset", { type: "passwordReset", to, token });
}
