/**
 * SSE Client Manager
 * Manages Server-Sent Events connections for real-time updates
 */

import { logger } from '../logger.js';

export class SSEManager {
  constructor() {
    this.clients = new Set();
  }

  addClient(res) {
    const clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    this.sendEvent(res, 'connected', { clientId, timestamp: new Date().toISOString() });

    const client = { id: clientId, res, connectedAt: Date.now() };
    this.clients.add(client);

    res.on('close', () => {
      this.clients.delete(client);
      logger.info({ clientId }, 'SSE client disconnected');
    });

    logger.info({ clientId, totalClients: this.clients.size }, 'SSE client connected');

    return clientId;
  }

  sendEvent(res, eventType, data) {
    try {
      res.write(`event: ${eventType}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (error) {
      logger.error({ err: error }, 'Failed to send SSE event');
    }
  }

  broadcast(eventType, data) {
    const deadClients = [];

    for (const client of this.clients) {
      try {
        this.sendEvent(client.res, eventType, {
          ...data,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        deadClients.push(client);
      }
    }

    for (const client of deadClients) {
      this.clients.delete(client);
    }

    logger.debug(
      {
        eventType,
        clientCount: this.clients.size,
        removedClients: deadClients.length,
      },
      'Broadcast SSE event'
    );
  }

  getClientCount() {
    return this.clients.size;
  }

  closeAll() {
    for (const client of this.clients) {
      try {
        client.res.end();
      } catch (error) {
        // Ignore errors when closing
      }
    }
    this.clients.clear();
  }
}

export const sseManager = new SSEManager();
