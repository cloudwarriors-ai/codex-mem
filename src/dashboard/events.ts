import type { ServerResponse } from "node:http";
import type { SyncResult } from "../types.js";

type DashboardEventPayload =
  | { type: "sync"; at: string; sync: SyncResult }
  | { type: "sync_error"; at: string; message: string }
  | { type: "heartbeat"; at: string };

const HEARTBEAT_INTERVAL_MS = 15_000;

export class DashboardEventHub {
  private readonly clients = new Set<ServerResponse>();
  private heartbeatTimer: NodeJS.Timeout | null = null;

  attach(res: ServerResponse): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    res.write("\n");

    this.clients.add(res);
    this.startHeartbeat();

    res.on("close", () => {
      this.clients.delete(res);
      if (this.clients.size === 0) this.stopHeartbeat();
    });
  }

  publishSync(sync: SyncResult): void {
    this.publish({
      type: "sync",
      at: new Date().toISOString(),
      sync,
    });
  }

  publishSyncError(message: string): void {
    this.publish({
      type: "sync_error",
      at: new Date().toISOString(),
      message,
    });
  }

  close(): void {
    this.stopHeartbeat();
    for (const client of this.clients) {
      client.end();
    }
    this.clients.clear();
  }

  private publish(payload: DashboardEventPayload): void {
    const data = `data: ${JSON.stringify(payload)}\n\n`;
    for (const client of this.clients) {
      client.write(data);
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      this.publish({
        type: "heartbeat",
        at: new Date().toISOString(),
      });
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (!this.heartbeatTimer) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }
}
