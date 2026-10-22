import type { FastifyPluginAsync } from 'fastify';
import type { StoragePort } from './storage.js';

// Images publiques (affiches d'événement). Clés aléatoires : jamais modifiées, cache long.
export const mediaRoutes =
  (storage: StoragePort): FastifyPluginAsync =>
  async (app) => {
    app.get<{ Params: { '*': string } }>(
      '/media/*',
      { schema: { hide: true } },
      async (request, reply) => {
        const key = request.params['*'];
        if (!/^events\/[0-9a-f-]{36}\/[A-Za-z0-9_-]{16,64}\.webp$/.test(key))
          return reply.callNotFound();
        const data = await storage.get(key);
        if (!data) return reply.callNotFound();
        return reply
          .header('content-type', 'image/webp')
          .header('x-content-type-options', 'nosniff')
          .header('cache-control', 'public, max-age=31536000, immutable')
          .send(data);
      },
    );
  };
