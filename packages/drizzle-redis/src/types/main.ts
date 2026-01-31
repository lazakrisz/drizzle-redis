import type { RedisClient } from "bun";
import type { CacheConfig } from "drizzle-orm/cache/core/types";
import type { Redis } from "ioredis";

export interface RedisCacheWithClient {
  /**
   * The Redis client to use for the cache.
   */
  client: Redis;
}

export interface RedisCacheWithConnection {
  /**
   * The URL to use to connect to the Redis server.
   */
  url: string;
}

export type RedisCacheOptions = (
  | RedisCacheWithClient
  | RedisCacheWithConnection
) & {
  /**
   * The prefix to use for the cache keys. Defaults to "drizzle-redis".
   * @default "drizzle-redis"
   */
  prefix?: string;
  /**
   * Default cache configuration (TTL settings).
   */
  config?: CacheConfig;
  /**
   * Whether to enable global caching for all queries.
   * When true, all queries will be cached automatically.
   * When false (default), only queries with explicit .cache() will be cached.
   * @default false
   */
  global?: boolean;
};

// Bun Redis Cache Types

export interface BunCacheWithClient {
  /**
   * The Bun RedisClient instance to use for the cache.
   */
  client: RedisClient;
}

export interface BunCacheWithConnection {
  /**
   * The URL to use to connect to the Redis server.
   */
  url: string;
}

export type BunCacheOptions = (BunCacheWithClient | BunCacheWithConnection) & {
  /**
   * The prefix to use for the cache keys. Defaults to "drizzle-redis".
   * @default "drizzle-redis"
   */
  prefix?: string;
  /**
   * Default cache configuration (TTL settings).
   */
  config?: CacheConfig;
  /**
   * Whether to enable global caching for all queries.
   * When true, all queries will be cached automatically.
   * When false (default), only queries with explicit .cache() will be cached.
   * @default false
   */
  global?: boolean;
};
