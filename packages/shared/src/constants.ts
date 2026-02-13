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
] as const;

export const RSVP_STATUS = ["going", "maybe", "not_going"] as const;

export const MAX_POST_LENGTH = 5000;
export const MAX_BIO_LENGTH = 500;
export const MAX_DISPLAY_NAME_LENGTH = 100;
export const MAX_CIRCLE_NAME_LENGTH = 50;
export const MAX_CIRCLES_PER_USER = 100;
export const MAX_CIRCLE_MEMBERS = 5000;
export const MAX_MEDIA_PER_POST = 50;
