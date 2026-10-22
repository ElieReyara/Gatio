import { describe, expect, it } from 'vitest';
import { isAllowedOrigin } from './origin.js';

const allowed = ['http://localhost:3000', 'https://*.trycloudflare.com'];

describe('origines autorisées (S2)', () => {
  it.each([
    ['http://localhost:3000', true],
    ['https://abc-def.trycloudflare.com', true],
    ['http://localhost:3001', false],
    ['http://abc.trycloudflare.com', false],
    ['https://trycloudflare.com', false],
    ['https://evil-trycloudflare.com', false],
    ['https://abc.trycloudflare.com.evil.com', false],
    ['null', false],
  ])('%s → %s', (origin, expected) => {
    expect(isAllowedOrigin(origin, allowed)).toBe(expected);
  });
});
