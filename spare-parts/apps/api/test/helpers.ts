import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app.js';

export const app: Express = createApp();
process.setMaxListeners(50);
const HDR = { 'x-requested-with': 'araco-sp' };

export type Client = ReturnType<typeof client>;

/** A logged-in client that keeps its session cookie. */
export function client() {
  const agent = request.agent(app);
  const wrap = (m: 'get' | 'post' | 'patch' | 'put' | 'delete') => (url: string, body?: unknown) => {
    const r = agent[m](url).set(HDR);
    return body === undefined ? r : r.send(body as object);
  };
  return {
    agent,
    get: wrap('get'), post: wrap('post'), patch: wrap('patch'), put: wrap('put'), del: wrap('delete'),
    async login(username: string, password: string) {
      const r = await agent.post('/api/auth/login').set(HDR).send({ username, password });
      if (r.status !== 200) throw new Error(`login ${username} failed: ${r.status} ${JSON.stringify(r.body)}`);
      return this;
    },
  };
}

export const ADMIN_PW = 'Admin#Test2026';
export const PW = 'Test#12345';

let seq = 0;
/** Creates a user with the given role (test database only). */
export async function makeUser(admin: Client, role: string, name?: string) {
  const username = `${role.toLowerCase().replace(/_/g, '')}${++seq}${Date.now() % 100000}`;
  const r = await admin.post('/api/users', { username, fullName: name ?? `Test ${role}`, password: PW, roles: [role], department: 'Maintenance' });
  if (r.status !== 201) throw new Error(`create user failed ${r.status} ${JSON.stringify(r.body)}`);
  return client().login(username, PW);
}

export async function adminClient() {
  return client().login('admin', ADMIN_PW);
}
