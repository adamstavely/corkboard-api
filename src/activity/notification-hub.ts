import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { Observable } from 'rxjs';
import { POOL } from '../db/db.module';

/** The Postgres channel new notifications are announced on, so every API instance hears about them. */
const CHANNEL = 'corkboard_notifications';
/** Postgres caps a NOTIFY payload at 8000 bytes; a UUID and a comma is 37. */
const IDS_PER_MESSAGE = 200;
/** How long to wait before listening again after losing the connection. */
const RETRY_MS = 2000;

/**
 * Tells people the moment they have new notifications. Each instance listens on a Postgres channel; whoever writes a
 * notification announces whose it is there, and every instance passes that on to those people's open streams.
 */
@Injectable()
export class NotificationHub implements OnModuleInit, OnApplicationShutdown {
  readonly #log = new Logger(NotificationHub.name);
  readonly #listeners = new Map<string, Set<() => void>>();
  #client: PoolClient | undefined;
  #closing = false;

  constructor(@Inject(POOL) private readonly pool: Pool) {}

  async onModuleInit(): Promise<void> {
    await this.#listen();
  }

  async onApplicationShutdown(): Promise<void> {
    this.#closing = true;
    this.#client?.release(true);
    this.#client = undefined;
    await Promise.resolve();
  }

  async #listen(): Promise<void> {
    if (this.#closing) return;
    try {
      const client = await this.pool.connect();
      client.on('notification', (msg) => {
        if (msg.channel !== CHANNEL || !msg.payload) return;
        for (const id of msg.payload.split(',')) for (const tell of this.#listeners.get(id) ?? []) tell();
      });
      client.on('error', (err) => {
        this.#log.warn(`Lost the notification channel: ${err.message}`);
        client.release(true);
        this.#client = undefined;
        setTimeout(() => void this.#listen(), RETRY_MS).unref();
      });
      await client.query(`LISTEN ${CHANNEL}`);
      this.#client = client;
    } catch (err) {
      this.#log.warn(`Couldn't listen for notifications: ${String(err)}`);
      setTimeout(() => void this.#listen(), RETRY_MS).unref();
    }
  }

  /** Says these people have something new. */
  async announce(userIds: readonly string[]): Promise<void> {
    for (let i = 0; i < userIds.length; i += IDS_PER_MESSAGE) {
      await this.pool.query('SELECT pg_notify($1, $2)', [CHANNEL, userIds.slice(i, i + IDS_PER_MESSAGE).join(',')]);
    }
  }

  /** A signal each time this person has something new, until unsubscribed. */
  changes(userId: string): Observable<void> {
    return new Observable<void>((subscriber) => {
      const tell = () => subscriber.next();
      const set = this.#listeners.get(userId) ?? new Set();
      set.add(tell);
      this.#listeners.set(userId, set);
      return () => {
        set.delete(tell);
        if (!set.size) this.#listeners.delete(userId);
      };
    });
  }
}
