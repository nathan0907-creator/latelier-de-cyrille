'use strict';

const { home } = require('./home');
const { services, service, gallery, find, legal, privacy, terms, appointment, notFound } = require('./pages');
const { booking } = require('./booking');
const { salon } = require('./salon');
const { eventPage } = require('./event');

/** Chaque page reçoit le contexte du site (configuration, heure du salon, prochain créneau…). */
const pages = {
  '/': home,
  '/prestations': services,
  '/galerie': gallery,
  '/nous-trouver': find,
  '/reservation': booking,
  '/mentions-legales': legal,
  '/confidentialite': privacy,
  '/conditions': terms,
  '/salon': salon,
  '/evenement': eventPage,
};

/** Pages à faire connaître aux moteurs de recherche (plan du site). */
const publicPaths = ['/', '/prestations', '/galerie', '/nous-trouver', '/reservation'];

module.exports = { pages, publicPaths, service, appointment, notFound };
