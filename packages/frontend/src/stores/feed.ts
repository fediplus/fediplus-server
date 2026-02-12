import { create } from "zustand";

export interface PostAuthor {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  actorUri: string;
}

export interface StreamPost {
  id: string;
  authorId: string;
  content: string;
  visibility: string;
  apId: string | null;
  replyToId: string | null;
  reshareOfId: string | null;
  hashtags: string[];
  mentions: string[];
  sensitive: boolean;
  spoilerText: string | null;
  editHistory: { content: string; editedAt: string }[];
  createdAt: string;
  updatedAt: string;
  author: PostAuthor;
  reactionCount: number;
  commentCount: number;
  reshareCount: number;
  userReacted: boolean;
}

interface FeedState {
  posts: StreamPost[];
  cursor: string | null;
  loading: boolean;
  circleFilter: string | null;
  setPosts: (posts: StreamPost[], cursor: string | null) => void;
  appendPosts: (posts: StreamPost[], cursor: string | null) => void;
  prependPost: (post: StreamPost) => void;
  updatePost: (id: string, updates: Partial<StreamPost>) => void;
  removePost: (id: string) => void;
  setLoading: (loading: boolean) => void;
  setCircleFilter: (circleId: string | null) => void;
  clear: () => void;
}

export const useFeedStore = create<FeedState>()((set) => ({
  posts: [],
  cursor: null,
  loading: false,
  circleFilter: null,
  setPosts: (posts, cursor) => set({ posts, cursor }),
  appendPosts: (newPosts, cursor) =>
    set((state) => ({
      posts: [...state.posts, ...newPosts],
      cursor,
    })),
  prependPost: (post) =>
    set((state) => ({
      posts: [post, ...state.posts],
    })),
  updatePost: (id, updates) =>
    set((state) => ({
      posts: state.posts.map((p) =>
        p.id === id ? { ...p, ...updates } : p
      ),
    })),
  removePost: (id) =>
    set((state) => ({
      posts: state.posts.filter((p) => p.id !== id),
    })),
  setLoading: (loading) => set({ loading }),
  setCircleFilter: (circleFilter) => set({ circleFilter, posts: [], cursor: null }),
  clear: () => set({ posts: [], cursor: null, circleFilter: null }),
}));
