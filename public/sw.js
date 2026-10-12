// Reçoit les rappels de rendez-vous et les affiche, même quand le site est fermé sur l'appareil.
// Ce fichier ne met rien en cache : le site se charge toujours depuis le serveur.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

// Les adresses se lisent depuis le dossier du site : il peut être servi ailleurs qu'à la racine.
const inSite = path => new URL(path, self.registration.scope).href;

self.addEventListener('push', event => {
  let message = {};
  try {
    message = event.data.json();
  } catch { /* message vide ou illisible : on affiche le rappel sans détail */ }
  event.waitUntil(self.registration.showNotification(message.title || 'Rappel de rendez-vous', {
    body: message.body || '',
    icon: inSite('img/icone-192.png'),
    badge: inSite('img/pastille.png'),
    tag: message.tag || 'rappel',
    lang: 'fr',
    data: { url: message.url || '' },
  }));
});

// Un appui sur la notification ouvre la page pratique (adresse, téléphone), ou y revient.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = inSite(event.notification.data?.url || '');
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find(client => client.url === target);
    return open ? open.focus() : self.clients.openWindow(target);
  })());
});
