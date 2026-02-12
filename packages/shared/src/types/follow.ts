import type { FOLLOW_STATUS } from "../constants.js";

export type FollowStatus = (typeof FOLLOW_STATUS)[number];

export interface Follow {
  id: string;
  followerId: string;
  followingId: string;
  status: FollowStatus;
  apId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Block {
  id: string;
  blockerId: string;
  blockedId: string;
  createdAt: Date;
}
