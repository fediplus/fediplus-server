import type { ACTOR_TYPES } from "../constants.js";

export type ActorType = (typeof ACTOR_TYPES)[number];

export interface User {
  id: string;
  username: string;
  email: string;
  actorType: ActorType;
  actorUri: string;
  inboxUri: string;
  outboxUri: string;
  followersUri: string;
  followingUri: string;
  publicKey: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Profile {
  id: string;
  userId: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  coverUrl: string | null;
  fields: ProfileField[];
  location: string | null;
  website: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProfileField {
  name: string;
  value: string;
}

export interface PublicUser {
  id: string;
  username: string;
  actorType: ActorType;
  actorUri: string;
  profile: Profile;
  followersCount: number;
  followingCount: number;
  postsCount: number;
}
