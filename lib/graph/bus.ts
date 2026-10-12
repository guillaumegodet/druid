// Connection of the graph publisher to the CRISalid bus (RabbitMQ), lot 11 d of druid-internal
// docs/plan-migration-postgresql.md. A message counts as sent only once the broker has confirmed it (confirm channel)
// AND routed it to a queue: published `mandatory`, a message no queue is bound for comes back (basic.return, before its
// confirmation) and is reported as a failure, instead of being dropped silently by the exchange.
import { connect, type ChannelModel, type ConfirmChannel } from 'amqplib';

export interface GraphBus {
  /** Resolves once the broker confirmed the message and routed it; rejects otherwise. */
  publish(routingKey: string, message: { id: string }): Promise<void>;
  close(): Promise<void>;
}

export class GraphBusError extends Error {
  /** The channel or the connection is gone: the next messages would fail the same way. */
  constructor(message: string, readonly fatal: boolean) {
    super(message);
  }
}

export const connectGraphBus = async (url: string, exchange: string): Promise<GraphBus> => {
  const connection: ChannelModel = await connect(url, { clientProperties: { connection_name: 'druid-graph-publisher' } });
  let channel: ConfirmChannel;
  try {
    channel = await connection.createConfirmChannel();
  } catch (err) {
    await connection.close().catch(() => {});
    throw err;
  }
  let closedBy: string | null = null;
  const returned = new Set<string>();
  channel.on('return', (msg) => { if (msg.properties.messageId) returned.add(String(msg.properties.messageId)); });
  // A refused publish (access refused, unknown exchange) closes the channel: kept to fail the next messages at once.
  channel.on('error', (err) => { closedBy = err.message; });
  channel.on('close', () => { closedBy ??= 'channel closed'; });
  connection.on('error', (err) => { closedBy = err.message; });

  return {
    publish: (routingKey, message) => new Promise<void>((resolve, reject) => {
      if (closedBy) { reject(new GraphBusError(closedBy, true)); return; }
      const body = Buffer.from(JSON.stringify(message));
      const options = { persistent: true, mandatory: true, contentType: 'application/json', messageId: message.id };
      try {
        channel.publish(exchange, routingKey, body, options, (err) => {
          if (err) reject(new GraphBusError(closedBy || String(err.message || err), !!closedBy));
          else if (returned.delete(message.id)) reject(new GraphBusError(`no queue bound for ${routingKey} on ${exchange}`, false));
          else resolve();
        });
      } catch (err) {
        reject(new GraphBusError(err instanceof Error ? err.message : String(err), true));
      }
    }),
    close: async () => {
      if (!closedBy) await channel.close().catch(() => {});
      await connection.close().catch(() => {});
    },
  };
};
