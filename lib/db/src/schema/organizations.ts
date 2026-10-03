import {
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

export const organizationMemberRoleEnum = pgEnum("organization_member_role", [
  "owner",
  "organizer",
]);

export const organizationsTable = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 160 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const organizationMembersTable = pgTable(
  "organization_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    // ID issued by the auth provider. Keeping this provider-agnostic prevents
    // the database model from depending on one authentication vendor.
    authUserId: text("auth_user_id").notNull(),
    role: organizationMemberRoleEnum("role").default("organizer").notNull(),
    displayName: varchar("display_name", { length: 120 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("organization_members_org_auth_user_idx").on(
      table.organizationId,
      table.authUserId,
    ),
    uniqueIndex("organization_members_auth_user_idx").on(table.authUserId),
  ],
);

export const insertOrganizationSchema = createInsertSchema(
  organizationsTable,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const selectOrganizationSchema = createSelectSchema(organizationsTable);

export const insertOrganizationMemberSchema = createInsertSchema(
  organizationMembersTable,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const selectOrganizationMemberSchema = createSelectSchema(
  organizationMembersTable,
);

export type Organization = typeof organizationsTable.$inferSelect;
export type NewOrganization = typeof organizationsTable.$inferInsert;
export type OrganizationMember = typeof organizationMembersTable.$inferSelect;
export type NewOrganizationMember =
  typeof organizationMembersTable.$inferInsert;
