export interface Circle {
  id: string;
  userId: string;
  name: string;
  color: string;
  isDefault: boolean;
  memberCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CircleMember {
  id: string;
  circleId: string;
  memberId: string;
  addedAt: Date;
}

export interface CircleWithMembers extends Circle {
  members: CircleMemberInfo[];
}

export interface CircleMemberInfo {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  actorUri: string;
}
