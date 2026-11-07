import { getAuth } from "@/server/auth";
import { catalogueSnapshot, catalogueVersion } from "@/server/catalogue";

/**
 * The open catalogue for in-browser search. ~2,500 lots, gzipped by the platform.
 * ETag'd: unchanged catalogues cost a 304.
 */
export async function GET(request: Request) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session)
    return Response.json({ error: "unauthorized" }, { status: 401 });

  const etag = `W/"cat-${await catalogueVersion()}"`;
  const headers = { ETag: etag, "Cache-Control": "private, no-cache" };
  if (request.headers.get("if-none-match") === etag)
    return new Response(null, { status: 304, headers });
  return Response.json(await catalogueSnapshot(), { headers });
}
