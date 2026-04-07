export const DEFAULT_CIRCLES_PERSON = [
  { name: "Friends", color: "#4285f4" },
  { name: "Family", color: "#0f9d58" },
  { name: "Acquaintances", color: "#f4b400" },
  { name: "Following", color: "#db4437" },
] as const;

export const DEFAULT_CIRCLES_BUSINESS = [
  { name: "Following", color: "#db4437" },
  { name: "Customers", color: "#4285f4" },
  { name: "VIPs", color: "#f4b400" },
  { name: "Team Members", color: "#0f9d58" },
] as const;

export const ACTOR_TYPES = ["Person", "Group", "Service"] as const;

export const POST_VISIBILITY = ["public", "circles", "followers", "direct"] as const;

export const REACTION_TYPES = ["+1"] as const;

export const FOLLOW_STATUS = ["pending", "accepted", "rejected"] as const;

export const COMMUNITY_ROLES = ["owner", "moderator", "member"] as const;

export const COMMUNITY_VISIBILITY = ["public", "private"] as const;

export const NOTIFICATION_TYPES = [
  "follow",
  "follow_accepted",
  "reaction",
  "comment",
  "mention",
  "reshare",
  "event_invited",
  "event_rsvp",
  "message",
] as const;

export const RSVP_STATUS = ["going", "maybe", "not_going"] as const;

export const MAX_POST_LENGTH = 5000;
export const MAX_BIO_LENGTH = 500;
export const MAX_DISPLAY_NAME_LENGTH = 100;
export const MAX_CIRCLE_NAME_LENGTH = 50;
export const MAX_CIRCLES_PER_USER = 100;
export const MAX_CIRCLE_MEMBERS = 5000;
export const MAX_MEDIA_PER_POST = 50;

export const EVENT_VISIBILITY = ["public", "private"] as const;

export const MAX_EVENT_NAME_LENGTH = 200;
export const MAX_EVENT_DESCRIPTION_LENGTH = 5000;
export const MAX_MESSAGE_LENGTH = 5000;
export const MAX_CONVERSATION_PARTICIPANTS = 10;

export const HANGOUT_VISIBILITY = ["public", "private"] as const;
export const MAX_HANGOUT_PARTICIPANTS = 10;
export const HANGOUT_STATUS = ["waiting", "active", "ended"] as const;

// ── Admin & Moderation ──

export const USER_ROLES = ["user", "moderator", "admin"] as const;

export const USER_STATUS = [
  "active",
  "suspended",
  "disabled",
  "pending",
] as const;

export const REPORT_TYPES = [
  "spam",
  "harassment",
  "hate_speech",
  "nudity",
  "violence",
  "copyright",
  "impersonation",
  "misinformation",
  "other",
] as const;

export const REPORT_TARGET_TYPES = [
  "post",
  "user",
  "comment",
  "community",
  "message",
] as const;

export const REPORT_STATUS = [
  "open",
  "resolved",
  "dismissed",
] as const;

export const MODERATION_ACTIONS = [
  "warn",
  "silence",
  "suspend",
  "unsuspend",
  "disable",
  "enable",
  "delete_post",
  "hide_post",
  "unhide_post",
  "mark_sensitive",
  "delete_comment",
  "dismiss_report",
  "resolve_report",
  "block_domain",
  "unblock_domain",
  "silence_domain",
  "unsilence_domain",
  "update_permissions",
  "update_role",
  "update_settings",
  "update_notes",
] as const;

export const DOMAIN_SEVERITY = [
  "silence",
  "suspend",
  "noop",
] as const;

export const ADMIN_NOTIFICATION_TYPES = [
  "report_filed",
  "report_resolved",
  "user_warned",
  "user_suspended",
  "appeal_filed",
] as const;

// Rate limiting
export const RATE_LIMITS = {
  guest: { perMinute: 60, perHour: 700 },
  user: { perMinute: 120, perHour: 3000 },
  reports: { perDay: 15, perMonth: 200 },
  uploads: { perDay: 50 },
  auth: { perMinute: 10, perHour: 50 },
} as const;

// User permission flags
export const USER_PERMISSIONS = [
  "can_post",
  "can_comment",
  "can_follow",
  "can_react",
  "can_upload",
  "can_message",
  "can_report",
  "can_create_communities",
] as const;

export const MAX_REPORT_COMMENT_LENGTH = 2000;
export const MAX_ADMIN_NOTE_LENGTH = 5000;
export const MAX_APPEAL_LENGTH = 5000;
export const MAX_WARNING_LENGTH = 5000;
