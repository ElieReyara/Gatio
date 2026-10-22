import { describe, expect, it } from 'vitest';
import { loginRequestSchema, registerRequestSchema } from '../src/auth.js';

describe('formulaires du compte organisateur', () => {
  it('normalise l’email (espaces, majuscules)', () => {
    const parsed = registerRequestSchema.parse({
      email: '  Nom@Exemple.COM ',
      password: '12345678',
      displayName: ' Sahel Culture ',
    });
    expect(parsed).toEqual({
      email: 'nom@exemple.com',
      password: '12345678',
      displayName: 'Sahel Culture',
    });
  });

  it('exige 8 caractères au minimum pour un nouveau mot de passe (maquette O1)', () => {
    const result = registerRequestSchema.safeParse({
      email: 'nom@exemple.com',
      password: '1234567',
      displayName: 'A',
    });
    expect(result.success).toBe(false);
  });

  it('refuse un email invalide et un nom affiché vide', () => {
    expect(
      registerRequestSchema.safeParse({
        email: 'pas-un-email',
        password: '12345678',
        displayName: 'A',
      }).success,
    ).toBe(false);
    expect(
      registerRequestSchema.safeParse({ email: 'a@b.td', password: '12345678', displayName: '  ' })
        .success,
    ).toBe(false);
  });

  it('accepte à la connexion un ancien mot de passe sans règle de longueur', () => {
    expect(loginRequestSchema.safeParse({ email: 'a@b.td', password: 'x' }).success).toBe(true);
  });
});
