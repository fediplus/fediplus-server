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
  MAX_HANGOUT_PARTICIPANTS,
  MAX_REPORT_COMMENT_LENGTH,
  MAX_ADMIN_NOTE_LENGTH,
  MAX_APPEAL_LENGTH,
  MAX_WARNING_LENGTH,
  MAX_STREAM_DESTINATION_NAME,
  MAX_RTMP_URL_LENGTH,
  MAX_STREAM_KEY_LENGTH,
  MAX_CHAT_MESSAGE_LENGTH,
  POST_VISIBILITY,
  ACTOR_TYPES,
  REACTION_TYPES,
  RSVP_STATUS,
  EVENT_VISIBILITY,
  HANGOUT_VISIBILITY,
  STREAMING_PLATFORMS,
  REPORT_TYPES,
  REPORT_TARGET_TYPES,
  USER_ROLES,
  USER_STATUS,
  DOMAIN_SEVERITY,
  MODERATION_ACTIONS,
  USER_PERMISSIONS,
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
  ephemeralPublicKey: z.string().min(1).nullish(),
  iv: z.string().min(1),
  epoch: z.number().int().min(0).default(0),
  mlsCounter: z.number().int().min(0).nullish(),
});

export const setupEncryptionSchema = z.object({
  encryptionPublicKey: z.string().min(1),
  encryptionPrivateKeyEnc: z.string().min(1),
});

export const uploadKeyPackagesSchema = z.object({
  packages: z
    .array(
      z.object({
        id: z.string().uuid(),
        keyData: z.string().min(1),
      })
    )
    .min(1)
    .max(20),
});

export const storeGroupStateSchema = z.object({
  epoch: z.number().int().min(0),
  encryptedState: z.string().min(1),
  initiatorId: z.string().uuid().optional(),
  keyPackageId: z.string().uuid().optional(),
});

// ── Hangout schemas ──

export const createHangoutSchema = z.object({
  name: z.string().max(100).optional(),
  visibility: z.enum(HANGOUT_VISIBILITY).default("public"),
  maxParticipants: z.coerce
    .number()
    .int()
    .min(2)
    .max(MAX_HANGOUT_PARTICIPANTS)
    .default(MAX_HANGOUT_PARTICIPANTS),
});

export const startStreamSchema = z.object({
  rtmpUrl: z.string().min(1).max(2048),
  destinationId: z.string().uuid().optional(),
});

export const createStreamingDestinationSchema = z.object({
  name: z.string().min(1).max(MAX_STREAM_DESTINATION_NAME),
  platform: z.enum(STREAMING_PLATFORMS).default("custom"),
  rtmpUrl: z.string().min(1).max(MAX_RTMP_URL_LENGTH),
  streamKey: z.string().max(MAX_STREAM_KEY_LENGTH).optional(),
  isDefault: z.boolean().default(false),
});

export const updateStreamingDestinationSchema = z.object({
  name: z.string().min(1).max(MAX_STREAM_DESTINATION_NAME).optional(),
  platform: z.enum(STREAMING_PLATFORMS).optional(),
  rtmpUrl: z.string().min(1).max(MAX_RTMP_URL_LENGTH).optional(),
  streamKey: z.string().max(MAX_STREAM_KEY_LENGTH).optional().nullable(),
  isDefault: z.boolean().optional(),
});

export const hangoutChatMessageSchema = z.object({
  text: z.string().min(1).max(MAX_CHAT_MESSAGE_LENGTH),
});

export const updateMediaStateSchema = z.object({
  isMuted: z.boolean().optional(),
  isCameraOff: z.boolean().optional(),
  isScreenSharing: z.boolean().optional(),
});

export type CreateHangoutInput = z.infer<typeof createHangoutSchema>;
export type StartStreamInput = z.infer<typeof startStreamSchema>;
export type CreateStreamingDestinationInput = z.infer<typeof createStreamingDestinationSchema>;
export type UpdateStreamingDestinationInput = z.infer<typeof updateStreamingDestinationSchema>;
export type HangoutChatMessageInput = z.infer<typeof hangoutChatMessageSchema>;
export type UpdateMediaStateInput = z.infer<typeof updateMediaStateSchema>;

export type ReactionInput = z.infer<typeof reactionSchema>;
export type CursorPaginationInput = z.infer<typeof cursorPaginationSchema>;
export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
export type RsvpInput = z.infer<typeof rsvpSchema>;
export type InviteToEventInput = z.infer<typeof inviteToEventSchema>;
export type CreateConversationInput = z.infer<typeof createConversationSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type SetupEncryptionInput = z.infer<typeof setupEncryptionSchema>;
export type UploadKeyPackagesInput = z.infer<typeof uploadKeyPackagesSchema>;
export type StoreGroupStateInput = z.infer<typeof storeGroupStateSchema>;

// ── Admin & Moderation schemas ──

export const createReportSchema = z.object({
  targetType: z.enum(REPORT_TARGET_TYPES),
  targetId: z.string().uuid(),
  type: z.enum(REPORT_TYPES),
  comment: z.string().max(MAX_REPORT_COMMENT_LENGTH).default(""),
});

export const resolveReportSchema = z.object({
  action: z.enum(["dismiss", "warn", "silence", "suspend", "delete_content"]),
  note: z.string().max(MAX_ADMIN_NOTE_LENGTH).optional(),
});

export const assignReportSchema = z.object({
  moderatorId: z.string().uuid(),
});

export const createAppealSchema = z.object({
  text: z.string().min(1).max(MAX_APPEAL_LENGTH),
});

export const resolveAppealSchema = z.object({
  action: z.enum(["approve", "reject"]),
});

export const adminUpdateUserSchema = z.object({
  role: z.enum(USER_ROLES).optional(),
  status: z.enum(USER_STATUS).optional(),
  sensitized: z.boolean().optional(),
  silenced: z.boolean().optional(),
  note: z.string().max(MAX_ADMIN_NOTE_LENGTH).optional(),
  permissions: z.record(z.enum(USER_PERMISSIONS), z.boolean()).optional(),
});

export const issueWarningSchema = z.object({
  action: z.enum(MODERATION_ACTIONS),
  text: z.string().max(MAX_WARNING_LENGTH).default(""),
  reportId: z.string().uuid().optional(),
});

export const domainBlockSchema = z.object({
  domain: z.string().min(1).max(255),
  severity: z.enum(DOMAIN_SEVERITY),
  publicComment: z.string().max(MAX_ADMIN_NOTE_LENGTH).optional(),
  privateComment: z.string().max(MAX_ADMIN_NOTE_LENGTH).optional(),
  rejectMedia: z.boolean().default(false),
  rejectReports: z.boolean().default(false),
  obfuscate: z.boolean().default(false),
});

export const updateDomainBlockSchema = z.object({
  severity: z.enum(DOMAIN_SEVERITY).optional(),
  publicComment: z.string().max(MAX_ADMIN_NOTE_LENGTH).optional(),
  privateComment: z.string().max(MAX_ADMIN_NOTE_LENGTH).optional(),
  rejectMedia: z.boolean().optional(),
  rejectReports: z.boolean().optional(),
  obfuscate: z.boolean().optional(),
});

export const ipBlockSchema = z.object({
  ip: z.string().min(1).max(45),
  severity: z.enum(["sign_up_requires_approval", "sign_up_block", "no_access"]),
  comment: z.string().max(MAX_ADMIN_NOTE_LENGTH).optional(),
  expiresAt: z.string().datetime().optional(),
});

export const adminSettingsSchema = z.object({
  key: z.string().min(1).max(100),
  value: z.unknown(),
  type: z.enum(["boolean", "number", "string", "array", "object"]).default("string"),
  isPublic: z.boolean().default(false),
});

export const adminSearchUsersSchema = cursorPaginationSchema.extend({
  q: z.string().max(200).optional(),
  role: z.enum(USER_ROLES).optional(),
  status: z.enum(USER_STATUS).optional(),
  local: z.coerce.boolean().optional(),
});

export const adminListReportsSchema = cursorPaginationSchema.extend({
  status: z.enum(["open", "resolved", "dismissed"]).optional(),
  targetType: z.enum(REPORT_TARGET_TYPES).optional(),
  assignedToMe: z.coerce.boolean().optional(),
});

export const adminListAuditLogSchema = cursorPaginationSchema.extend({
  actorId: z.string().uuid().optional(),
  action: z.enum(MODERATION_ACTIONS).optional(),
});

export type CreateReportInput = z.infer<typeof createReportSchema>;
export type ResolveReportInput = z.infer<typeof resolveReportSchema>;
export type AssignReportInput = z.infer<typeof assignReportSchema>;
export type CreateAppealInput = z.infer<typeof createAppealSchema>;
export type ResolveAppealInput = z.infer<typeof resolveAppealSchema>;
export type AdminUpdateUserInput = z.infer<typeof adminUpdateUserSchema>;
export type IssueWarningInput = z.infer<typeof issueWarningSchema>;
export type DomainBlockInput = z.infer<typeof domainBlockSchema>;
export type UpdateDomainBlockInput = z.infer<typeof updateDomainBlockSchema>;
export type IpBlockInput = z.infer<typeof ipBlockSchema>;
export type AdminSettingsInput = z.infer<typeof adminSettingsSchema>;
export type AdminSearchUsersInput = z.infer<typeof adminSearchUsersSchema>;
export type AdminListReportsInput = z.infer<typeof adminListReportsSchema>;
export type AdminListAuditLogInput = z.infer<typeof adminListAuditLogSchema>;
