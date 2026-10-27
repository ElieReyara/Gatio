import { afterEach, describe, expect, it, vi } from 'vitest';
import { otpSmsText } from '../buyers/otp.js';
import { androidGatewaySms, smsPortFor } from './port.js';

describe('passerelle SMS Android', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const gateway = androidGatewaySms({
    url: 'http://192.168.1.20:8080/message',
    login: 'sms',
    password: 'secret',
  });

  it('envoie le texte et le numéro international, authentification Basic', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ id: 'msg-1', state: 'Pending' }, { status: 202 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await gateway.send({ to: '+23566123456', text: otpSmsText('481902') });
    expect(result).toEqual({ providerRef: 'msg-1' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://192.168.1.20:8080/message');
    expect((init.headers as Record<string, string>).authorization).toBe(
      `Basic ${Buffer.from('sms:secret').toString('base64')}`,
    );
    expect(JSON.parse(String(init.body))).toEqual({
      textMessage: {
        text: 'Gatio : votre code est 481 902. Il est valable 5 minutes. Ne le donnez à personne.',
      },
      phoneNumbers: ['+23566123456'],
    });
  });

  it('refus de la passerelle : erreur (le message est marqué « failed »)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 401 })),
    );
    await expect(gateway.send({ to: '+23566123456', text: 'x' })).rejects.toThrow('401');
  });

  it('le SMS du code tient dans un seul message (maquette M1)', () => {
    expect(otpSmsText('000000').length).toBeLessThanOrEqual(160);
  });
});

describe('choix de l’adaptateur SMS', () => {
  const log = { warn: () => undefined };
  it('console sans passerelle, passerelle si configurée ; rien en production (revue)', () => {
    expect(smsPortFor({ nodeEnv: 'development', smsGateway: null }, log).name).toBe('console');
    const gatewayConfig = { url: 'http://192.168.1.20:8080/message', login: 'a', password: 'b' };
    expect(smsPortFor({ nodeEnv: 'development', smsGateway: gatewayConfig }, log).name).toBe(
      'android-gateway',
    );
    expect(() => smsPortFor({ nodeEnv: 'production', smsGateway: null }, log)).toThrow();
    expect(() => smsPortFor({ nodeEnv: 'production', smsGateway: gatewayConfig }, log)).toThrow();
  });
});
