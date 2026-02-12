import type { POST_VISIBILITY, REACTION_TYPES } from "../constants.js";

export type PostVisibility = (typeof POST_VISIBILITY)[number];
export type ReactionType = (typeof REACTION_TYPES)[number];

export interface Post {
  id: string;
  authorId: string;
  content: string;
  visibility: PostVisibility;
  apId: string | null;
  replyToId: string | null;
  reshareOfId: string | null;
  hashtags: string[];
  mentions: string[];
  sensitive: boolean;
  spoilerText: string | null;
  editHistory: PostEdit[];
  createdAt: Date;
  updatedAt: Date;
}

export interface PostEdit {
  content: string;
  editedAt: string;
}

export interface PostAudience {
  id: string;
  postId: string;
  targetType: "circle" | "user" | "public" | "followers";
  targetId: string | null;
  field: "to" | "cc" | "bto" | "bcc";
}

export interface Reaction {
  id: string;
  postId: string;
  userId: string;
  type: ReactionType;
  createdAt: Date;
}

export interface PostWithAuthor extends Post {
  author: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
    actorUri: string;
  };
  reactionCount: number;
  commentCount: number;
  reshareCount: number;
  userReacted: boolean;
}
