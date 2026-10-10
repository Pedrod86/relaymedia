// Collections: your own lists plus lists imported (and re-synced) from
// MDBList, TMDB, TVDB and Trakt. Saved to the signed-in account.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type CollectionSource = "manual" | "mdblist" | "tmdb" | "tvdb" | "trakt";
export type CollectionItem = {
  key: string;
  type: "movie" | "tv";
  title: string;
  year?: number;
  tmdbId?: number;
  imdbId?: string;
  tvdbId?: number;
  poster?: string;
};
export type Collection = {
  id: string;
  name: string;
  description: string;
  source: CollectionSource;
  source_url: string | null;
  auto_sync: boolean;
  items: CollectionItem[];
  synced_at: string | null;
  updated_at: string;
};

const itemSchema = z.object({
  key: z.string().max(200),
  type: z.enum(["movie", "tv"]),
  title: z.string().max(300),
  year: z.number().int().optional(),
  tmdbId: z.number().int().optional(),
  imdbId: z.string().max(20).optional(),
  tvdbId: z.number().int().optional(),
  poster: z.string().url().max(500).optional(),
});

const msg = (e: unknown) => String((e as any)?.message ?? e);

export const listCollections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("collections")
      .select("*")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { collections: (data ?? []) as unknown as Collection[] };
  });

export const createCollection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ name: z.string().trim().min(1).max(120), description: z.string().max(500).default("") }))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("collections")
      .insert({ user_id: context.userId, name: data.name, description: data.description, source: "manual" })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row as unknown as Collection;
  });

export const updateCollection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      id: z.string().uuid(),
      name: z.string().trim().min(1).max(120).optional(),
      description: z.string().max(500).optional(),
      auto_sync: z.boolean().optional(),
      items: z.array(itemSchema).max(500).optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const { data: row, error } = await context.supabase
      .from("collections")
      .update(patch as any)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row as unknown as Collection;
  });

export const deleteCollection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("collections").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const importCollection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ url: z.string().trim().min(8).max(500) }))
  .handler(async ({ data, context }) => {
    try {
      const { fetchList } = await import("./collections.server");
      const r = await fetchList(data.url);
      if (!r.items.length) return { ok: false as const, error: "That list is empty or private." };
      const { data: row, error } = await context.supabase
        .from("collections")
        .insert({
          user_id: context.userId,
          name: r.name,
          description: r.description,
          source: r.source,
          source_url: data.url,
          items: r.items as any,
          synced_at: new Date().toISOString(),
        })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return { ok: true as const, collection: row as unknown as Collection };
    } catch (e) {
      console.error("importCollection", e);
      return { ok: false as const, error: msg(e) };
    }
  });

export const syncCollection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    try {
      const { data: cur, error: e1 } = await context.supabase
        .from("collections")
        .select("source_url")
        .eq("id", data.id)
        .single();
      if (e1 || !cur?.source_url) return { ok: false as const, error: "This collection isn't linked to a list." };
      const { fetchList } = await import("./collections.server");
      const r = await fetchList(cur.source_url);
      const { data: row, error } = await context.supabase
        .from("collections")
        .update({ items: r.items as any, synced_at: new Date().toISOString() })
        .eq("id", data.id)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return { ok: true as const, collection: row as unknown as Collection };
    } catch (e) {
      console.error("syncCollection", e);
      return { ok: false as const, error: msg(e) };
    }
  });

export const searchTitles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ query: z.string().trim().min(2).max(100) }))
  .handler(async ({ data }) => {
    try {
      const { tmdbSearchItems } = await import("./collections.server");
      return { ok: true as const, items: await tmdbSearchItems(data.query) };
    } catch (e) {
      return { ok: false as const, error: msg(e), items: [] as CollectionItem[] };
    }
  });
