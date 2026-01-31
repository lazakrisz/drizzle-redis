import type { MutationOption } from "drizzle-orm/cache/core";
import { Cache } from "drizzle-orm/cache/core";
import type { CacheConfig } from "drizzle-orm/cache/core/types";
import { is } from "drizzle-orm/entity";
import { Table, getTableName } from "drizzle-orm";
import Redis from "ioredis";
import type { RedisCacheOptions } from "../types/main";

/**
 * Lua script to atomically get a cached value by tag.
 * Looks up the composite table name from the tags map, then retrieves the value.
 */
const getByTagScript = `
local tagsMapKey = KEYS[1] -- tags map key
local tag        = ARGV[1] -- tag

local compositeTableName = redis.call('HGET', tagsMapKey, tag)
if not compositeTableName then
  return nil
end

local value = redis.call('HGET', compositeTableName, tag)
return value
`;

/**
 * Lua script to atomically invalidate cache entries on mutation.
 * Handles both tag-based and table-based invalidation.
 */
const onMutateScript = `
local tagsMapKey = KEYS[1] -- tags map key
local tables     = {}      -- initialize tables array
local tags       = ARGV    -- tags array

for i = 2, #KEYS do
  tables[#tables + 1] = KEYS[i] -- add all keys except the first one to tables
end

if #tags > 0 then
  for _, tag in ipairs(tags) do
    if tag ~= nil and tag ~= '' then
      local compositeTableName = redis.call('HGET', tagsMapKey, tag)
      if compositeTableName then
        redis.call('HDEL', compositeTableName, tag)
      end
    end
  end
  redis.call('HDEL', tagsMapKey, unpack(tags))
end

local keysToDelete = {}

if #tables > 0 then
  local compositeTableNames = redis.call('SUNION', unpack(tables))
  for _, compositeTableName in ipairs(compositeTableNames) do
    keysToDelete[#keysToDelete + 1] = compositeTableName
  end
  for _, table in ipairs(tables) do
    keysToDelete[#keysToDelete + 1] = table
  end
  redis.call('DEL', unpack(keysToDelete))
end
`;

interface InternalConfig {
  seconds: number;
  hexOptions?: "NX" | "nx" | "XX" | "xx" | "GT" | "gt" | "LT" | "lt";
}

export class RedisCache extends Cache {
  private readonly client: Redis;
  private readonly prefix: string;
  private readonly useGlobally: boolean;
  private readonly internalConfig: InternalConfig;

  /**
   * Prefix for sets which denote the composite table names for each unique table.
   *
   * Example: In the composite table set of "table1", you may find
   * `${compositeTableSetPrefix}table1,table2` and `${compositeTableSetPrefix}table1,table3`
   */
  private static readonly compositeTableSetPrefix = "__CTS__";

  /**
   * Prefix for hashes which map hash or tags to cache values.
   */
  private static readonly compositeTablePrefix = "__CT__";

  /**
   * Key which holds the mapping of tags to composite table names.
   *
   * Using this tagsMapKey, you can find the composite table name for a given tag
   * and get the cache value for that tag.
   */
  private static readonly tagsMapKey = "__tagsMap__";

  /**
   * Queries whose auto invalidation is false aren't stored in their respective
   * composite table hashes because those hashes are deleted when a mutation
   * occurs on related tables.
   *
   * Instead, they are stored in a separate hash with this prefix
   * to prevent them from being deleted when a mutation occurs.
   */
  private static readonly nonAutoInvalidateTablePrefix =
    "__nonAutoInvalidate__";

  constructor(options: RedisCacheOptions) {
    super();
    this.prefix = options.prefix ?? "drizzle-redis";
    this.useGlobally = options.global ?? false;
    this.internalConfig = this.toInternalConfig(options.config);

    if ("client" in options) {
      this.client = options.client;
    } else {
      this.client = new Redis(options.url);
    }
  }

  private toInternalConfig(config?: CacheConfig): InternalConfig {
    return config
      ? {
          seconds: config.ex ?? 1,
          hexOptions: config.hexOptions,
        }
      : {
          seconds: 1,
        };
  }

  override strategy(): "explicit" | "all" {
    return this.useGlobally ? "all" : "explicit";
  }

  override async get(
    key: string,
    tables: string[],
    isTag: boolean,
    isAutoInvalidate?: boolean
  ): Promise<any[] | undefined> {
    // Handle non-auto-invalidate queries
    if (!isAutoInvalidate) {
      const result = await this.client.hget(
        this.addPrefix(RedisCache.nonAutoInvalidateTablePrefix),
        key
      );
      return result === null ? undefined : JSON.parse(result);
    }

    // Handle tag-based lookup using Lua script
    if (isTag) {
      const result = await this.client.eval(
        getByTagScript,
        1,
        this.addPrefix(RedisCache.tagsMapKey),
        key
      );
      if (result === null) {
        return undefined;
      }
      return JSON.parse(result as string);
    }

    // Handle normal table-based lookup
    const compositeKey = this.getCompositeKey(tables);
    const result = await this.client.hget(compositeKey, key);
    return result === null ? undefined : JSON.parse(result);
  }

  override async put(
    key: string,
    response: any,
    tables: string[],
    isTag: boolean = false,
    config?: CacheConfig
  ): Promise<void> {
    const isAutoInvalidate = tables.length !== 0;
    const pipeline = this.client.pipeline();
    const ttlSeconds =
      config && config.ex ? config.ex : this.internalConfig.seconds;
    const hexOptions =
      config && config.hexOptions
        ? config.hexOptions
        : this.internalConfig?.hexOptions;

    const serializedResponse = JSON.stringify(response);

    // Handle non-auto-invalidate queries
    if (!isAutoInvalidate) {
      const nonAutoInvalidateKey = this.addPrefix(
        RedisCache.nonAutoInvalidateTablePrefix
      );

      if (isTag) {
        const tagsMapKey = this.addPrefix(RedisCache.tagsMapKey);
        pipeline.hset(tagsMapKey, key, nonAutoInvalidateKey);
        this.hexpire(pipeline, tagsMapKey, key, ttlSeconds, hexOptions);
      }

      pipeline.hset(nonAutoInvalidateKey, key, serializedResponse);
      this.hexpire(pipeline, nonAutoInvalidateKey, key, ttlSeconds, hexOptions);
      await pipeline.exec();
      return;
    }

    // Handle auto-invalidate queries
    const compositeKey = this.getCompositeKey(tables);

    pipeline.hset(compositeKey, key, serializedResponse);
    this.hexpire(pipeline, compositeKey, key, ttlSeconds, hexOptions);

    if (isTag) {
      const tagsMapKey = this.addPrefix(RedisCache.tagsMapKey);
      pipeline.hset(tagsMapKey, key, compositeKey);
      this.hexpire(pipeline, tagsMapKey, key, ttlSeconds, hexOptions);
    }

    // Track composite keys for each table (for invalidation)
    for (const table of tables) {
      pipeline.sadd(this.addTablePrefix(table), compositeKey);
    }

    await pipeline.exec();
  }

  override async onMutate(params: MutationOption): Promise<void> {
    const tags = Array.isArray(params.tags)
      ? params.tags
      : params.tags
      ? [params.tags]
      : [];

    const tables = Array.isArray(params.tables)
      ? params.tables
      : params.tables
      ? [params.tables]
      : [];

    // Extract table names, handling Table objects via is() + getTableName
    const tableNames = tables.map((table) =>
      is(table, Table) ? getTableName(table) : (table as string)
    );

    const compositeTableSets = tableNames.map((table) =>
      this.addTablePrefix(table)
    );

    const tagsMapKey = this.addPrefix(RedisCache.tagsMapKey);

    // Execute the Lua script for atomic invalidation
    await this.client.eval(
      onMutateScript,
      1 + compositeTableSets.length,
      tagsMapKey,
      ...compositeTableSets,
      ...tags
    );
  }

  /**
   * Add the user-defined prefix to a key.
   */
  private addPrefix(key: string): string {
    return `${this.prefix}:${key}`;
  }

  /**
   * Add the composite table set prefix with user prefix.
   */
  private addTablePrefix(table: string): string {
    return this.addPrefix(`${RedisCache.compositeTableSetPrefix}${table}`);
  }

  /**
   * Generate a composite key from sorted table names.
   */
  private getCompositeKey(tables: string[]): string {
    return this.addPrefix(
      `${RedisCache.compositeTablePrefix}${tables.sort().join(",")}`
    );
  }

  /**
   * Execute HEXPIRE command using pipeline.call() since ioredis doesn't have a native method.
   * HEXPIRE requires Redis 7.4+
   */
  private hexpire(
    pipeline: ReturnType<Redis["pipeline"]>,
    key: string,
    field: string,
    seconds: number,
    hexOptions?: "NX" | "nx" | "XX" | "xx" | "GT" | "gt" | "LT" | "lt"
  ): void {
    if (hexOptions) {
      pipeline.call("HEXPIRE", key, seconds, hexOptions, "FIELDS", 1, field);
    } else {
      pipeline.call("HEXPIRE", key, seconds, "FIELDS", 1, field);
    }
  }
}

export function redisCache(options: RedisCacheOptions): RedisCache {
  return new RedisCache(options);
}
