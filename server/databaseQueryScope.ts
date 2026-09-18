import type { Pool, PoolClient } from "pg";

/** Los lectores de contexto usan Promise.all. En una sesión que mantiene un
 * advisory lock, serializamos sus consultas sin reservar otras conexiones. */
export function databaseQueryScope(client: Pick<PoolClient, "query">): Pick<Pool, "query"> {
  let previous: Promise<unknown> = Promise.resolve();
  const execute = client.query.bind(client) as (...args: unknown[]) => Promise<unknown>;
  const query = (...args: unknown[]) => {
    const current = previous.then(() => execute(...args));
    previous = current.catch(() => undefined);
    return current;
  };
  return { query: query as Pool["query"] };
}
