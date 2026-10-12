'use strict';

/**
 * Temps réel par Server-Sent Events.
 * - canal « public » : annonce seulement qu'une journée a changé (aucune donnée personnelle) ;
 * - canal « salon »  : détail des rendez-vous, réservé aux sessions connectées.
 */
function createEvents({ maxPerIp = 10, maxTotal = 500, heartbeatMs = 25_000 } = {}) {
  const channels = { public: new Set(), salon: new Set() };
  const perIp = new Map();

  const total = () => channels.public.size + channels.salon.size;

  // Un commentaire à intervalle régulier garde les flux ouverts (les relais coupent une connexion
  // muette). Le minuteur ne tourne que tant qu'une page écoute : en ligne, le site peut alors s'endormir.
  let heartbeat = null;
  function keepAlive() {
    if (total() && !heartbeat) {
      heartbeat = setInterval(() => {
        for (const set of Object.values(channels)) for (const client of set) client.res.write(': ping\n\n');
      }, heartbeatMs);
      heartbeat.unref();
    } else if (!total() && heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  }

  function open(channel, req, res, { ip, sessionId = null }) {
    if (total() >= maxTotal || (perIp.get(ip) || 0) >= maxPerIp) {
      res.writeHead(503, { 'Retry-After': '30' });
      res.end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');

    const client = { res, ip, sessionId };
    channels[channel].add(client);
    perIp.set(ip, (perIp.get(ip) || 0) + 1);
    keepAlive();

    req.on('close', () => {
      if (!channels[channel].delete(client)) return;
      const count = (perIp.get(ip) || 1) - 1;
      if (count > 0) perIp.set(ip, count);
      else perIp.delete(ip);
      keepAlive();
    });
  }

  function send(channel, event, data) {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of channels[channel]) client.res.write(message);
  }

  /** Coupe les flux « salon » d'une session (déconnexion) ou de toutes les autres (changement de mot de passe). */
  function closeSalon(predicate) {
    for (const client of [...channels.salon]) if (predicate(client.sessionId)) client.res.end();
  }

  function close() {
    clearInterval(heartbeat);
    heartbeat = null;
    for (const set of Object.values(channels)) for (const client of [...set]) client.res.end();
  }

  return { open, send, closeSalon, close, count: channel => channels[channel].size };
}

module.exports = { createEvents };
