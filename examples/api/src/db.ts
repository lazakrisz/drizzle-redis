import { RedisClient } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import { bunCache } from "drizzle-redis/bun";

const redisClient = new RedisClient(Bun.env.REDIS_URL!);

const db = drizzle(Bun.env.DATABASE_URL!, {
  cache: bunCache({ client: redisClient }),
});

export { db };
