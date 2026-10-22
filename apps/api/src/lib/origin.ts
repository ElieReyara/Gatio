// S2 : seules les origines autorisées peuvent modifier des données avec la session
// du navigateur. « https://*.domaine » accepte les sous-domaines de domaine.
export function isAllowedOrigin(origin: string, allowed: readonly string[]): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  return allowed.some((entry) => {
    const wildcard = /^(https?):\/\/\*\.(.+)$/.exec(entry);
    if (!wildcard) return entry === url.origin;
    const [, scheme, domain] = wildcard;
    return url.protocol === `${scheme}:` && url.hostname.endsWith(`.${domain}`) && url.port === '';
  });
}
