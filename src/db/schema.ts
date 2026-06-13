import { relations } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

// ============================================================
// 型定数
// ============================================================

export const PROJECT_STATUSES = ["interviewing", "diagramming"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const MESSAGE_ROLES = ["user", "assistant"] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

/** 因果リンクの極性。+: 同方向（原因が増えると結果も増える）/ -: 逆方向 */
export const POLARITIES = ["+", "-"] as const;
export type Polarity = (typeof POLARITIES)[number];

/**
 * ノードの SFD 上の役割。CLD 段階では null（未分類）。
 * M3 のストック&フロー変換で stock / flow / auxiliary / constant に昇格する。
 * CLD と SFD を別グラフとして持たず、同一ノードへの役割付与で段階的に
 * 詳細化する設計（二重管理の破綻を防ぐ）。
 */
export const NODE_KINDS = ["stock", "flow", "auxiliary", "constant"] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

// ============================================================
// Better Auth テーブル
// ============================================================

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: integer("email_verified", { mode: "boolean" }).notNull(),
    image: text("image"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("users_email_idx").on(t.email)],
);

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
});

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", {
    mode: "timestamp",
  }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", {
    mode: "timestamp",
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const verifications = sqliteTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});

// ============================================================
// アプリケーションテーブル
// ============================================================

/**
 * projects — ユーザーの「問い」単位。聞き取りチャットと因果ループ図を 1 つずつ持つ
 */
export const projects = sqliteTable(
  "projects",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    status: text("status", { enum: PROJECT_STATUSES })
      .notNull()
      .default("interviewing"),
    /**
     * 聞き取りノート（JSON 文字列）。AI が updateNotes ツールで全置換更新する。
     * schema と parse は src/lib/interview/notes.ts。null = 空ノート
     */
    interviewNotes: text("interview_notes"),
    createdAt: integer("created_at")
      .notNull()
      .$defaultFn(() => Date.now()),
    updatedAt: integer("updated_at")
      .notNull()
      .$defaultFn(() => Date.now())
      .$onUpdateFn(() => Date.now()),
  },
  (t) => [index("projects_user_id_idx").on(t.userId)],
);

/**
 * messages — 聞き取りチャットの履歴。parts は AI SDK の UIMessage parts の JSON
 */
export const messages = sqliteTable(
  "messages",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    role: text("role", { enum: MESSAGE_ROLES }).notNull(),
    parts: text("parts").notNull(),
    createdAt: integer("created_at")
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (t) => [index("messages_project_id_idx").on(t.projectId)],
);

/**
 * nodes — 因果ループ図の変数（増減を語れる名詞句）。
 * x, y が null のノードは未配置（AI 生成直後）。クライアントの d3-force が
 * 初期配置し、ユーザーのドラッグ確定で座標が保存される。
 * kind / unit は M3（ストック&フロー化）への布石。CLD 段階では null のまま。
 */
export const nodes = sqliteTable(
  "nodes",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    memo: text("memo"),
    unit: text("unit"),
    kind: text("kind", { enum: NODE_KINDS }),
    x: real("x"),
    y: real("y"),
    createdAt: integer("created_at")
      .notNull()
      .$defaultFn(() => Date.now()),
    updatedAt: integer("updated_at")
      .notNull()
      .$defaultFn(() => Date.now())
      .$onUpdateFn(() => Date.now()),
  },
  (t) => [index("nodes_project_id_idx").on(t.projectId)],
);

/**
 * edges — 因果リンク。rationale（なぜ因果と言えるか）は必須。
 * 因果/相関の検証と、対話での「このリンクは確か?」のやり取りの土台になる。
 * ループ（R/B）は保存しない。負リンク数の偶奇から決定的に導出できる。
 */
export const edges = sqliteTable(
  "edges",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sourceNodeId: text("source_node_id")
      .notNull()
      .references(() => nodes.id, { onDelete: "cascade" }),
    targetNodeId: text("target_node_id")
      .notNull()
      .references(() => nodes.id, { onDelete: "cascade" }),
    polarity: text("polarity", { enum: POLARITIES }).notNull(),
    hasDelay: integer("has_delay", { mode: "boolean" })
      .notNull()
      .default(false),
    rationale: text("rationale").notNull(),
    createdAt: integer("created_at")
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (t) => [index("edges_project_id_idx").on(t.projectId)],
);

// ============================================================
// relations
// ============================================================

export const projectsRelations = relations(projects, ({ one, many }) => ({
  user: one(users, {
    fields: [projects.userId],
    references: [users.id],
  }),
  messages: many(messages),
  nodes: many(nodes),
  edges: many(edges),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  project: one(projects, {
    fields: [messages.projectId],
    references: [projects.id],
  }),
}));

export const nodesRelations = relations(nodes, ({ one, many }) => ({
  project: one(projects, {
    fields: [nodes.projectId],
    references: [projects.id],
  }),
  outgoingEdges: many(edges, { relationName: "source" }),
  incomingEdges: many(edges, { relationName: "target" }),
}));

export const edgesRelations = relations(edges, ({ one }) => ({
  project: one(projects, {
    fields: [edges.projectId],
    references: [projects.id],
  }),
  sourceNode: one(nodes, {
    fields: [edges.sourceNodeId],
    references: [nodes.id],
    relationName: "source",
  }),
  targetNode: one(nodes, {
    fields: [edges.targetNodeId],
    references: [nodes.id],
    relationName: "target",
  }),
}));
