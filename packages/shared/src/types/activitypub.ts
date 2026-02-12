export interface APObject {
  "@context"?: string | string[] | Record<string, unknown>[];
  id?: string;
  type: string;
  name?: string;
  content?: string;
  summary?: string;
  published?: string;
  updated?: string;
  url?: string | { type: string; href: string }[];
  attributedTo?: string | APObject;
  to?: string[];
  cc?: string[];
  bto?: string[];
  bcc?: string[];
  inReplyTo?: string | null;
  tag?: APTag[];
  attachment?: APAttachment[];
  sensitive?: boolean;
}

export interface APActor extends APObject {
  type: "Person" | "Group" | "Service";
  preferredUsername: string;
  inbox: string;
  outbox: string;
  followers?: string;
  following?: string;
  publicKey?: {
    id: string;
    owner: string;
    publicKeyPem: string;
  };
  icon?: APImage;
  image?: APImage;
  manuallyApprovesFollowers?: boolean;
  discoverable?: boolean;
  endpoints?: {
    sharedInbox?: string;
  };
}

export interface APActivity extends APObject {
  type: string;
  actor: string;
  object: string | APObject;
  target?: string;
  instrument?: string | APObject;
}

export interface APImage {
  type: "Image";
  url: string;
  mediaType?: string;
  width?: number;
  height?: number;
  blurhash?: string;
}

export interface APTag {
  type: "Mention" | "Hashtag";
  href?: string;
  name: string;
}

export interface APAttachment {
  type: string;
  mediaType?: string;
  url: string;
  name?: string;
  width?: number;
  height?: number;
  blurhash?: string;
}

export interface WebFingerResponse {
  subject: string;
  aliases?: string[];
  links: {
    rel: string;
    type?: string;
    href?: string;
    template?: string;
  }[];
}

export interface NodeInfoResponse {
  version: string;
  software: {
    name: string;
    version: string;
  };
  protocols: string[];
  usage: {
    users: {
      total: number;
      activeMonth: number;
      activeHalfyear: number;
    };
    localPosts: number;
  };
  openRegistrations: boolean;
  metadata: Record<string, unknown>;
}
