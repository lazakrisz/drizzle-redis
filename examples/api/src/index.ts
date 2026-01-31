import { eq } from "drizzle-orm";
import { db } from "./db";
import { usersTable } from "./db/schema";

Bun.serve({
  async fetch(req: Request) {
    const url = new URL(req.url);
    const pathname = url.pathname;
    const method = req.method;

    if (pathname === "/users" && method === "GET") {
      const users = await db
        .select()
        .from(usersTable)
        .limit(10)
        .$withCache({ tag: "users", config: { ex: 100 } });

      return new Response(JSON.stringify(users));
    } else if (pathname === "/users/:id" && method === "GET") {
      const id = url.pathname.split("/")[2];
      if (!id) {
        return new Response("Not found", { status: 404 });
      }
      const user = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, parseInt(id)))
        .limit(1)
        .$withCache({ tag: `user:${id}` })
        .then((result) => result[0]);

      if (!user) {
        return new Response("Not found", { status: 404 });
      }

      return new Response(JSON.stringify(user));
    } else if (pathname === "/users/invalidate/:tag" && method === "POST") {
      const tag = url.pathname.split("/")[2];
      if (!tag) {
        return new Response("Not found", { status: 404 });
      }

      if (tag === "users") {
        await db.$cache.invalidate({ tables: ["users"] });
      } else {
        await db.$cache.invalidate({ tags: tag });
      }

      return new Response("Invalidated", { status: 200 });
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log("Server is running on http://localhost:3000");
