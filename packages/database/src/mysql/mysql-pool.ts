import { createPool, type Pool } from "mysql2/promise";

export function createMySqlPool(databaseUrl: string, connectionLimit: number): Pool {
  const url = new URL(databaseUrl);
  if (url.protocol !== "mysql:") throw new TypeError("DATABASE_URL must use the mysql:// scheme");
  if (url.hostname === "" || url.pathname.length < 2) throw new TypeError("DATABASE_URL must include a MySQL host and database");
  return createPool({
    host: url.hostname,
    port: url.port === "" ? 3306 : Number(url.port),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
    connectionLimit,
    multipleStatements: true,
    dateStrings: false,
    timezone: "Z"
  });
}
