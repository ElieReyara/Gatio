import { describe, expect, it } from 'vitest';
import { ipSubject } from './rate-limit.js';

describe('sujet des limites par adresse', () => {
  it.each([
    ['1.2.3.4', '1.2.3.4'],
    ['::ffff:10.0.0.7', '10.0.0.7'],
    ['2001:db8:1:2:aaaa:bbbb:cccc:dddd', '2001:db8:1:2::/64'],
    ['2001:db8:1:2::1', '2001:db8:1:2::/64'],
    ['2001:0db8:0001:0002:ffff::9', '2001:db8:1:2::/64'],
    ['2001:db8::1', '2001:db8:0:0::/64'],
    ['::1', '0:0:0:0::/64'],
  ])('%s → %s', (ip, subject) => {
    expect(ipSubject(ip)).toBe(subject);
  });
});
