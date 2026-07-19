import { pgTable, text, timestamp, boolean, uuid, pgEnum } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Auth-related Enums
export const roleEnum = pgEnum("role", ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'GERENTE', 'SUPERVISOR', 'EMPLEADO', 'READONLY']);

// Account table (OAuth accounts from better-auth)
export const account = pgTable("account", {
  id: text("id").primaryKey().notNull(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

// Users table (better-auth user management)
export const users = pgTable("users", {
  id: text("id").primaryKey().notNull(),
  name: text("name"),
  email: text("email").notNull(),
  emailVerified: boolean("email_verified"),
  image: text("image"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  role: roleEnum("role").default('EMPLEADO'),
  companyId: uuid("company_id"),
  branchId: uuid("branch_id"),
  phone: text("phone"),
  pinCode: text("pin_code"), // Legacy column
  status: text("status").default('ACTIVE'), // Legacy column
  active: boolean("active").default(true), // Legacy column
  whatsappPhone: text("whatsapp_phone"), // WhatsApp phone number for notifications
  deletedAt: timestamp("deleted_at"),
});

// Session table (better-auth legacy format, preserved for existing data)
export const session = pgTable("session", {
  id: text("id").primaryKey().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull(),
});

// Sessions table (session tracking from better-auth)
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").unique(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => users.id),
});

// Verifications table (email verification from better-auth)
export const verifications = pgTable("verifications", {
  id: text("id").primaryKey().notNull(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

// Magic links table for passwordless authentication
export const magicLinks = pgTable("magic_links", {
  token: text("token").primaryKey().notNull(),
  sessionId: uuid("session_id").notNull(),
  instanceId: uuid("instance_id").notNull(), // Changed from executionId
  workflowTemplateId: text("workflow_template_id").notNull(),
  status: text("status").default('PENDING'),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// All tables and enums are exported inline with 'export const' above
