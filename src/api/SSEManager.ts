import { logger } from '../../src/logger';

interface SSEClient {
  id: string;
  res: unknown;
  connectedAt: number;
}

export class SSEManager {
  clients = new Set<SSEClient>();

  addClient(res: unknown): string {
    const clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const resObj = res as { writeHead: (code: number, headers: Record<string, string>) => void; on: (event: string, cb: () => void) => void };

    resObj.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    this.sendEvent(res, 'connected', { clientId, timestamp: new Date().toISOString() });

    const client: SSEClient = { id: clientId, res, connectedAt: Date.now() };
    this.clients.add(client);

    resObj.on('close', () => {
      this.clients.delete(client);
      logger.info({ clientId }, 'SSE client disconnected');
    });

    logger.info({ clientId, totalClients: this.clients.size }, 'SSE client connected');
    return clientId;
  }

  sendEvent(res: unknown, eventType: string, data: Record<string, unknown>): void {
    try {
      const resObj = res as { write: (chunk: string) => void };
      resObj.write(`event: ${eventType}\n`);
      resObj.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (error) {
      logger.error({ err: error }, 'Failed to send SSE event');
    }
  }

  broadcast(eventType: string, data: Record<string, unknown>): void {
    const deadClients: SSEClient[] = [];
    for (const client of this.clients) {
      try {
        this.sendEvent(client.res, eventType, { ...data, timestamp: new Date().toISOString() });
      } catch {
        deadClients.push(client);
      }
    }
    for (const client of deadClients) {
      this.clients.delete(client);
    }
    logger.debug({ eventType, clientCount: this.clients.size, removedClients: deadClients.length }, 'Broadcast SSE event');
  }

  getClientCount(): number {
    return this.clients.size;
  }

  closeAll(): void {
    for (const client of this.clients) {
      try { (client.res as { end: () => void }).end(); } catch { /* ignore */ }
    }
    this.clients.clear();
  }
}

export const sseManager = new SSEManager();
