import { createServer, type Server } from "node:http";

export interface HealthState {
  role: "starting" | "standby" | "leader" | "stopping";
  instanceId: string;
  lastTickAt: number;
  leaderSince: number | null;
  details: () => Record<string, unknown>;
}

/**
 * GET /healthz → 200 when standby, or when leader with a tick in the last 30 s; 503 otherwise.
 * Railway restarts the worker if this keeps failing.
 */
export function startHealthServer(port: number, state: HealthState): Server {
  const server = createServer((req, res) => {
    if (req.url !== "/healthz") {
      res.writeHead(404).end();
      return;
    }
    const fresh = Date.now() - state.lastTickAt < 30_000;
    const ok = state.role === "standby" || (state.role === "leader" && fresh);
    const body = JSON.stringify({
      ok,
      role: state.role,
      instanceId: state.instanceId,
      lastTickAgoMs: Date.now() - state.lastTickAt,
      leaderSince: state.leaderSince
        ? new Date(state.leaderSince).toISOString()
        : null,
      ...state.details(),
    });
    res
      .writeHead(ok ? 200 : 503, { "Content-Type": "application/json" })
      .end(body);
  });
  server.listen(port);
  return server;
}
