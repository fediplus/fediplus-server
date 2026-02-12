import type { NOTIFICATION_TYPES } from "../constants.js";

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  actorId: string;
  targetId: string | null;
  targetType: string | null;
  read: boolean;
  createdAt: Date;
}
