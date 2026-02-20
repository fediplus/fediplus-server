import { z } from "zod";
import {
  MAX_POST_LENGTH,
  MAX_BIO_LENGTH,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_CIRCLE_NAME_LENGTH,
  MAX_MEDIA_PER_POST,
  MAX_EVENT_NAME_LENGTH,
  MAX_EVENT_DESCRIPTION_LENGTH,
  MAX_MESSAGE_LENGTH,
  MAX_CONVERSATION_PARTICIPANTS,
  POST_VISIBILITY,
  ACTOR_TYPES,
  REACTION_TYPES,
  RSVP_STATUS,
  EVENT_VISIBILITY,
} from "./constants.js";

export const registerSchema = z.object({
  username: z
    .string()
    .min(1)
    .max(30)
    .regex(/^[a-zA-Z0-9_]+$/, "Username must be alphanumeric with underscores"),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(MAX_DISPLAY_NAME_LENGTH).optional(),
  actorType: z.enum(ACTOR_TYPES).default("Person"),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export const updateProfileSchema = z.object({
  displayName: z.string().min(1).max(MAX_DISPLAY_NAME_LENGTH).optional(),
  bio: z.string().max(MAX_BIO_LENGTH).optional(),
  location: z.string().max(100).optional(),
  website: z.string().url().max(200).optional().or(z.literal("")),
  fields: z
    .array(
      z.object({
        name: z.string().min(1).max(50),
        value: z.string().min(1).max(200),
      })
    )
    .max(8)
    .optional(),
});

export const createCircleSchema = z.object({
  name: z.string().min(1).max(MAX_CIRCLE_NAME_LENGTH),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});

export const updateCircleSchema = z.object({
  name: z.string().min(1).max(MAX_CIRCLE_NAME_LENGTH).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});

export const addCircleMembersSchema = z.object({
  memberIds: z.array(z.string().uuid()).min(1).max(100),
});

export const createPostSchema = z.object({
  content: z.string().max(MAX_POST_LENGTH).default(""),
  visibility: z.enum(POST_VISIBILITY),
  replyToId: z.string().uuid().optional(),
  circleIds: z.array(z.string().uuid()).optional(),
  mediaIds: z.array(z.string().uuid()).max(MAX_MEDIA_PER_POST).optional(),
  sensitive: z.boolean().default(false),
  spoilerText: z.string().max(200).optional(),
});

export const reactionSchema = z.object({
  type: z.enum(REACTION_TYPES),
});

export const cursorPaginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type CreateCircleInput = z.infer<typeof createCircleSchema>;
export type UpdateCircleInput = z.infer<typeof updateCircleSchema>;
export type AddCircleMembersInput = z.infer<typeof addCircleMembersSchema>;
export type CreatePostInput = z.infer<typeof createPostSchema>;
// ── Event schemas ──

export const createEventSchema = z.object({
  name: z.string().min(1).max(MAX_EVENT_NAME_LENGTH),
  description: z.string().max(MAX_EVENT_DESCRIPTION_LENGTH).optional(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime().optional(),
  location: z.string().max(200).optional(),
  visibility: z.enum(EVENT_VISIBILITY).default("public"),
  coverMediaId: z.string().uuid().optional(),
});

export const updateEventSchema = z.object({
  name: z.string().min(1).max(MAX_EVENT_NAME_LENGTH).optional(),
  description: z.string().max(MAX_EVENT_DESCRIPTION_LENGTH).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional().nullable(),
  location: z.string().max(200).optional(),
  visibility: z.enum(EVENT_VISIBILITY).optional(),
  coverMediaId: z.string().uuid().optional().nullable(),
});

export const rsvpSchema = z.object({
  status: z.enum(RSVP_STATUS),
});

export const inviteToEventSchema = z.object({
  circleIds: z.array(z.string().uuid()).min(1),
});

// ── Message schemas ──

export const createConversationSchema = z.object({
  participantIds: z
    .array(z.string().uuid())
    .min(1)
    .max(MAX_CONVERSATION_PARTICIPANTS - 1),
});

export const sendMessageSchema = z.object({
  ciphertext: z.string().min(1).max(MAX_MESSAGE_LENGTH * 4),
  ephemeralPublicKey: z.string().min(1),
  iv: z.string().min(1),
});

export const setupEncryptionSchema = z.object({
  encryptionPublicKey: z.string().min(1),
  encryptionPrivateKeyEnc: z.string().min(1),
});

export type ReactionInput = z.infer<typeof reactionSchema>;
export type CursorPaginationInput = z.infer<typeof cursorPaginationSchema>;
export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
export type RsvpInput = z.infer<typeof rsvpSchema>;
export type InviteToEventInput = z.infer<typeof inviteToEventSchema>;
export type CreateConversationInput = z.infer<typeof createConversationSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type SetupEncryptionInput = z.infer<typeof setupEncryptionSchema>;
