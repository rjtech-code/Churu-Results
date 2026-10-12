import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';

/** Runs a COUNT-style query (BIGINTs arrive as strings from the pool) and returns a number. */
export async function countOf(
  conn: PoolConnection | Pool,
  sql: string,
  params: (string | number)[] = [],
): Promise<number> {
  const [rows] = await conn.execute<RowDataPacket[]>(sql, params);
  return Number(rows[0]?.n ?? 0);
}
