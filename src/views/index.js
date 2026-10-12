'use strict';

const { home } = require('./home');
const { services, gallery, find, legal, notFound } = require('./pages');
const { booking } = require('./booking');
const { salon } = require('./salon');

/** Chaque page reçoit le contexte du site (configuration, heure du salon, prochain créneau…). */
const pages = {
  '/': home,
  '/prestations': services,
  '/galerie': gallery,
  '/nous-trouver': find,
  '/reservation': booking,
  '/mentions-legales': legal,
  '/salon': salon,
};

/** Pages à faire connaître aux moteurs de recherche (plan du site). */
const publicPaths = ['/', '/prestations', '/galerie', '/nous-trouver', '/reservation'];

module.exports = { pages, publicPaths, notFound };
