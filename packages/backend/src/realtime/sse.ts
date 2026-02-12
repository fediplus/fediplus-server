import type { FastifyReply } from "fastify";

type SSEClient = {
  userId: string;
  reply: FastifyReply;
};

const clients = new Map<string, Set<SSEClient>>();

export function addClient(userId: string, reply: FastifyReply) {
  if (!clients.has(userId)) {
    clients.set(userId, new Set());
  }

  const client: SSEClient = { userId, reply };
  clients.get(userId)!.add(client);

  // Send initial connection event
  reply.raw.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);

  // Remove client on disconnect
  reply.raw.on("close", () => {
    clients.get(userId)?.delete(client);
    if (clients.get(userId)?.size === 0) {
      clients.delete(userId);
    }
  });
}

export function sendEvent(userId: string, event: string, data: unknown) {
  const userClients = clients.get(userId);
  if (!userClients) return;

  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of userClients) {
    try {
      client.reply.raw.write(payload);
    } catch {
      userClients.delete(client);
    }
  }
}

export function broadcastToUsers(
  userIds: string[],
  event: string,
  data: unknown
) {
  for (const userId of userIds) {
    sendEvent(userId, event, data);
  }
}

export function getConnectedUserCount(): number {
  return clients.size;
}
