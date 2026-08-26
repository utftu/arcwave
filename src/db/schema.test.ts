import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { createAccountsTable, createUsersTable } from "./schema.ts";

describe("createUsersTable", () => {
  test("defaults to table name arcwave_users with no schema namespace", () => {
    const table = createUsersTable();
    const config = getTableConfig(table);

    expect(config.name).toBe("arcwave_users");
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
      (index) => index.config.name === "arcwave_users_email_idx",
    );
    expect(emailIndex).toBeDefined();
    expect(emailIndex?.config.unique).toBe(true);
  });
});

describe("createAccountsTable", () => {
  test("defaults to table name arcwave_accounts with no schema namespace", () => {
    const users = createUsersTable();
    const table = createAccountsTable({ usersTable: users });
    const config = getTableConfig(table);

    expect(config.name).toBe("arcwave_accounts");
    expect(config.schema).toBeUndefined();
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
      (index) => index.config.name === "arcwave_accounts_provider_account_id_idx",
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
