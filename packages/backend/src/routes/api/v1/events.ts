import type { FastifyInstance } from "fastify";
import {
  createEventSchema,
  updateEventSchema,
  rsvpSchema,
  inviteToEventSchema,
  cursorPaginationSchema,
} from "@fediplus/shared";
import { z } from "zod";
import { authMiddleware } from "../../../middleware/auth.js";
import {
  createEvent,
  getEvent,
  listEvents,
  getUserEvents,
  updateEvent,
  deleteEvent,
  rsvpEvent,
  getEventRsvps,
  inviteCircles,
  addEventPhoto,
  getEventPhotos,
  generateIcal,
} from "../../../services/events.js";

const photoUploadSchema = z.object({
  mediaId: z.string().uuid(),
});

export async function eventRoutes(app: FastifyInstance) {
  // List upcoming public events
  app.get("/api/v1/events", async (request) => {
    const { cursor, limit } = cursorPaginationSchema.parse(request.query);
    return listEvents(cursor, limit);
  });

  // My events (created + RSVP'd)
  app.get(
    "/api/v1/events/mine",
    { preHandler: [authMiddleware] },
    async (request) => {
      return getUserEvents(request.user!.userId);
    }
  );

  // Get event detail
  app.get("/api/v1/events/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const event = await getEvent(id);
    if (!event) {
      return reply.status(404).send({ error: "Event not found" });
    }
    return event;
  });

  // Create event
  app.post(
    "/api/v1/events",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const input = createEventSchema.parse(request.body);
      const event = await createEvent(request.user!.userId, input);
      return reply.status(201).send(event);
    }
  );

  // Update event
  app.patch(
    "/api/v1/events/:id",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const input = updateEventSchema.parse(request.body);
      const event = await updateEvent(id, request.user!.userId, input);
      if (!event) {
        return reply.status(404).send({ error: "Event not found" });
      }
      return event;
    }
  );

  // Delete event
  app.delete(
    "/api/v1/events/:id",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const deleted = await deleteEvent(id, request.user!.userId);
      if (!deleted) {
        return reply.status(404).send({ error: "Event not found" });
      }
      return { ok: true };
    }
  );

  // RSVP to event
  app.post(
    "/api/v1/events/:id/rsvp",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { status } = rsvpSchema.parse(request.body);
      const rsvp = await rsvpEvent(id, request.user!.userId, status);
      if (!rsvp) {
        return reply.status(404).send({ error: "Event not found" });
      }
      return rsvp;
    }
  );

  // Get event RSVPs
  app.get("/api/v1/events/:id/rsvps", async (request, reply) => {
    const { id } = request.params as { id: string };
    return getEventRsvps(id);
  });

  // Invite circles to event
  app.post(
    "/api/v1/events/:id/invite",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { circleIds } = inviteToEventSchema.parse(request.body);
      const result = await inviteCircles(id, request.user!.userId, circleIds);
      if (!result) {
        return reply.status(404).send({ error: "Event not found" });
      }
      return result;
    }
  );

  // Upload event photo
  app.post(
    "/api/v1/events/:id/photos",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { mediaId } = photoUploadSchema.parse(request.body);
      const photo = await addEventPhoto(id, request.user!.userId, mediaId);
      if (!photo) {
        return reply.status(404).send({ error: "Event not found" });
      }
      return reply.status(201).send(photo);
    }
  );

  // Get event photos
  app.get("/api/v1/events/:id/photos", async (request) => {
    const { id } = request.params as { id: string };
    const { cursor, limit } = cursorPaginationSchema.parse(request.query);
    return getEventPhotos(id, cursor, limit);
  });

  // Download iCal
  app.get("/api/v1/events/:id/ical", async (request, reply) => {
    const { id } = request.params as { id: string };
    const event = await getEvent(id);
    if (!event) {
      return reply.status(404).send({ error: "Event not found" });
    }
    const ical = generateIcal(event);
    return reply
      .header("Content-Type", "text/calendar; charset=utf-8")
      .header(
        "Content-Disposition",
        `attachment; filename="${event.name.replace(/[^a-zA-Z0-9]/g, "_")}.ics"`
      )
      .send(ical);
  });
}
