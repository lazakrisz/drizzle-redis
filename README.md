# drizzle-redis

Redis caching layer for [Drizzle ORM](https://orm.drizzle.team). Automatically caches query results in Redis and provides table-aware invalidation so cached data stays fresh when you mutate.

Two runtime modules are included:

- `drizzle-redis` — uses [ioredis](https://github.com/redis/ioredis), works in Node.js and any ioredis-compatible environment
- `drizzle-redis/bun` — uses Bun's native `RedisClient`, for Bun projects

## Installation

```bash
bun add drizzle-redis
```

Peer dependencies:

- `drizzle-orm` ^0.45.1
- `ioredis` ^5.4.2 (only needed when using the default `drizzle-redis` import)

## Quick Start

### Node.js (ioredis)

```ts
import { drizzle } from "drizzle-orm/node-postgres";
import { redisCache } from "drizzle-redis";

const db = drizzle(process.env.DATABASE_URL!, {
  cache: redisCache({ url: "redis://localhost:6379" }),
});
```

### Bun

```ts
import { RedisClient } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import { bunCache } from "drizzle-redis/bun";

const redisClient = new RedisClient(Bun.env.REDIS_URL!);

const db = drizzle(Bun.env.DATABASE_URL!, {
  cache: bunCache({ client: redisClient }),
});
```

## Configuration

Both `redisCache` and `bunCache` accept the same shape of options.

### Connection

Provide either an existing client or a URL string:

```ts
// Pass an existing client
redisCache({ client: myRedisClient });

// Or let the library create one from a URL
redisCache({ url: "redis://localhost:6379" });
```

### Options

| Option   | Type          | Default            | Description                                                                                          |
| -------- | ------------- | ------------------ | ---------------------------------------------------------------------------------------------------- |
| `prefix` | `string`      | `"drizzle-redis"`  | Key prefix for all cache entries in Redis.                                                           |
| `config` | `CacheConfig` | `{ ex: 1 }`       | Default TTL settings applied to every cached query. See [CacheConfig](#cacheconfig) below.           |
| `global` | `boolean`     | `false`            | When `true`, **all** queries are cached automatically. When `false`, only queries using `$withCache` are cached. |

### CacheConfig

The `config` object (from `drizzle-orm`) controls TTL behaviour:

| Field        | Type     | Description                                                                 |
| ------------ | -------- | --------------------------------------------------------------------------- |
| `ex`         | `number` | Expire time in **seconds** (positive integer). Default: `1`.                |
| `hexOptions` | `string` | HEXPIRE flag: `"NX"`, `"XX"`, `"GT"`, or `"LT"`.                           |

```ts
redisCache({
  url: "redis://localhost:6379",
  prefix: "my-app",
  config: { ex: 60 },       // cache for 60 seconds by default
  global: true,              // cache all queries
});
```

## Caching Queries

Use `$withCache()` on any Drizzle select query to cache it:

```ts
const users = await db
  .select()
  .from(usersTable)
  .limit(10)
  .$withCache();
```

### Options

`$withCache` accepts an optional config object:

```ts
const users = await db
  .select()
  .from(usersTable)
  .limit(10)
  .$withCache({
    tag: "users",           // named tag for targeted invalidation
    config: { ex: 100 },    // override default TTL for this query
  });
```

| Field            | Type          | Description                                                             |
| ---------------- | ------------- | ----------------------------------------------------------------------- |
| `tag`            | `string`      | A named tag for this cached query, used for tag-based invalidation.     |
| `config`         | `CacheConfig` | Per-query TTL override.                                                 |
| `autoInvalidate` | `boolean`     | When `false`, the cache entry won't be auto-invalidated on table mutation. |

## Cache Invalidation

Drizzle automatically invalidates cache entries when you run mutations (`insert`, `update`, `delete`) on tables that have cached queries. You can also invalidate manually:

```ts
// Invalidate by table name
await db.$cache.invalidate({ tables: ["users"] });

// Invalidate by tag
await db.$cache.invalidate({ tags: "users" });

// Invalidate multiple tags
await db.$cache.invalidate({ tags: ["user:1", "user:2"] });

// Invalidate by table reference
await db.$cache.invalidate({ tables: [usersTable] });
```

## Requirements

- **Redis 7.4+** — required for the `HEXPIRE` command used for per-field TTL on hashes
- **drizzle-orm** ^0.45.1
- **ioredis** ^5.4.2 (only when using the default `drizzle-redis` import)

## Acknowledgements

Inspired by the [official Drizzle ORM cache interface and Upstash cache implementation](https://github.com/drizzle-team/drizzle-orm/blob/a086f59fba7f46f3a077893ba912c99e91eaa760/drizzle-orm/src/cache/readme.md).

This project includes Lua scripts derived from Drizzle ORM's cache implementation, which is licensed under the [Apache License 2.0](http://www.apache.org/licenses/LICENSE-2.0). See [NOTICE](./NOTICE) for details.

## License

MIT
