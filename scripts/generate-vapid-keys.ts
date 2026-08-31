/**
 * Génère une paire de clés VAPID pour les notifications Web Push.
 * Usage : npm run vapid-keys — copie la sortie dans le .env de l'API.
 * Une seule paire pour toute la vie du serveur : les clés identifient le
 * serveur auprès des push services, les changer déconnecte tous les abonnés.
 */
import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();
console.log('# .env — Web Push (VAPID)');
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log('# mailto: exigé par le push service Apple, ignoré ailleurs');
console.log('VAPID_SUBJECT=mailto:you@example.com');
