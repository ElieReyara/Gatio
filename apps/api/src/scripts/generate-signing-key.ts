import { generateSigningKey } from '../modules/tickets/signing.js';

// Affiche une nouvelle clé de signature des QR codes, à placer dans .env (jamais dans le code).
console.log('TICKET_SIGNING_KEY_ID=1');
console.log(`TICKET_SIGNING_PRIVATE_KEY=${generateSigningKey()}`);
