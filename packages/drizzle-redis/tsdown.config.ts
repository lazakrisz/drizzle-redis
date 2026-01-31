import { defineConfig, type UserConfig } from "tsdown";
import swc from "unplugin-swc";

const baseConfig: UserConfig = {
  format: ["cjs", "esm"],
  treeshake: false,
  dts: true,
  sourcemap: true,
  clean: false,
  plugins: [
    //
    swc.rolldown({
      minify: true,
      sourceMaps: true,
      jsc: {
        target: "es2015",
      },
    }),
  ],
};

export default defineConfig([
  {
    entry: ["src/index.ts"],
    ...baseConfig,
    outDir: "build",
    external: ["drizzle-orm", "ioredis"],
  },
  {
    entry: ["src/bun/index.ts"],
    ...baseConfig,
    outDir: "build/bun",
    external: ["drizzle-orm", "bun"],
  },
]);
