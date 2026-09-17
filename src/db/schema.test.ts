import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  accounts,
  arcwaveSchema,
  createAccountsTable,
  createUsersTable,
  sessions,
  users,
} from "./schema.ts";

describe("createUsersTable", () => {
  test("defaults to table name users in the arcwave schema", () => {
    const table = createUsersTable();
    const config = getTableConfig(table);

    expect(config.name).toBe("users");
    expect(config.schema).toBe("arcwave");
  });

  test("schema public creates the table without a schema namespace", () => {
    const table = createUsersTable({ schema: "public" });
    const config = getTableConfig(table);

    expect(config.schema).toBeUndefined();
  });

  test("accepts a custom table name and schema namespace", () => {
    const table = createUsersTable({ tableName: "custom_users", schema: "auth" });
    const config = getTableConfig(table);

    expect(config.name).toBe("custom_users");
    expect(config.schema).toBe("auth");
  });

  test("has a unique index on email", () => {
    const table = createUsersTable();
    const config = getTableConfig(table);

    const emailIndex = config.indexes.find(
      (index) => index.config.name === "users_email_idx",
    );
    expect(emailIndex).toBeDefined();
    expect(emailIndex?.config.unique).toBe(true);
  });
});

describe("createAccountsTable", () => {
  test("defaults to table name accounts in the arcwave schema", () => {
    const users = createUsersTable();
    const table = createAccountsTable({ usersTable: users });
    const config = getTableConfig(table);

    expect(config.name).toBe("accounts");
    expect(config.schema).toBe("arcwave");
  });

  test("accepts a custom table name and schema namespace", () => {
    const users = createUsersTable({ schema: "auth" });
    const table = createAccountsTable({
      usersTable: users,
      tableName: "custom_accounts",
      schema: "auth",
    });
    const config = getTableConfig(table);

    expect(config.name).toBe("custom_accounts");
    expect(config.schema).toBe("auth");
  });

  test("has a unique index on (provider, providerAccountId)", () => {
    const users = createUsersTable();
    const table = createAccountsTable({ usersTable: users });
    const config = getTableConfig(table);

    const providerIndex = config.indexes.find(
      (index) => index.config.name === "accounts_provider_account_id_idx",
    );
    expect(providerIndex).toBeDefined();
    expect(providerIndex?.config.unique).toBe(true);
    expect(providerIndex?.config.columns).toHaveLength(2);
  });

  test("userId is NOT NULL and references the linked users table", () => {
    const users = createUsersTable();
    const table = createAccountsTable({ usersTable: users });
    const config = getTableConfig(table);

    const userId = config.columns.find((column) => column.name === "user_id");
    expect(userId?.notNull).toBe(true);

    const fk = config.foreignKeys.find((foreignKey) =>
      foreignKey.reference().columns.some((column) => column.name === "user_id"),
    );
    expect(fk).toBeDefined();
  });
});

describe("default exports", () => {
  test("tables live in the exported arcwave schema", () => {
    expect(arcwaveSchema.schemaName).toBe("arcwave");

    for (const table of [users, accounts, sessions]) {
      expect(getTableConfig(table).schema).toBe(arcwaveSchema.schemaName);
    }
  });

  test("default table names are users, accounts, sessions", () => {
    expect(getTableConfig(users).name).toBe("users");
    expect(getTableConfig(accounts).name).toBe("accounts");
    expect(getTableConfig(sessions).name).toBe("sessions");
  });
});

describe("timestamps", () => {
  test("every timestamp column is timestamp with time zone", () => {
    for (const table of [users, accounts, sessions]) {
      for (const column of getTableConfig(table).columns) {
        if (column.columnType !== "PgTimestamp") {
          continue;
        }

        expect(column.getSQLType()).toBe("timestamp with time zone");
      }
    }
  });
});
