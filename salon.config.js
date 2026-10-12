'use strict';

/**
 * Toutes les informations du salon sont ici.
 * Modifiez ce fichier puis relancez le serveur : le site, la réservation
 * et l'espace salon se mettent à jour.
 *
 * ⚠ Les valeurs marquées « PROVISOIRE » sont des exemples à remplacer.
 */

module.exports = {
  name: "L'atelier de Cyrille",
  owner: 'Cyrille',
  tagline: 'Coiffeuse',
  description:
    "L'atelier de Cyrille, coiffeuse à Loison-sous-Lens : coupes, brushings, colorations, balayages, ombrés, lissages. Uniquement sur rendez-vous, réservation en ligne.",

  // Le gros titre de la une, ligne par ligne. Un mot entre _tirets bas_ est écrit en cursive
  // dorée ; entre *étoiles*, en cursive multicolore. Sur grand écran, les lignes se suivent
  // sur une seule ; sur téléphone, elles s'empilent. La taille s'ajuste toute seule.
  headline: ['Cyrille,', 'votre coiffeuse', '(presque)', '*magicienne*'],

  // Adresse publique du site : le nom de domaine du salon. Les moteurs de recherche ne connaissent
  // que celle-ci, et toute autre adresse du site en ligne y renvoie.
  siteUrl: 'https://latelierdecyrille.com',

  // Référencement (Google, Bing…).
  seo: {
    // Communes voisines d'où viennent aussi les clientes : elles sont citées aux moteurs de recherche.
    nearby: ['Lens', 'Harnes', 'Noyelles-sous-Lens'],
    // Une fois le site en ligne : codes donnés par Google Search Console et Bing Webmaster Tools
    // (option « balise HTML »), pour prouver que le site est bien le vôtre.
    googleVerification: '',
    bingVerification: '',
  },

  // Coordonnées. Laissez vide ('') ce que le salon n'utilise pas : la ligne disparaît du site.
  contact: {
    phone: '07 45 07 50 16',
    email: '',
    facebook: 'https://www.facebook.com/latelierby',
    messenger: 'https://www.facebook.com/messages/t/latelierby/',
    instagram: '',
    // La fiche Google du salon : dans Google Maps, ouvrir la fiche, « Partager », « Copier le lien ».
    // Le site y renvoie (avis, itinéraire) et la signale aux moteurs de recherche.
    google: 'https://share.google/Cp8sXzSEfxHrPcLaf',
  },

  // Adresse (sert aussi à Google Maps)
  address: {
    street: '9 Route de Lille',
    postalCode: '62218',
    city: 'Loison-sous-Lens',
    // Optionnel : texte exact à chercher dans Google Maps (nom de la fiche Google, par exemple).
    mapsQuery: "L'atelier de Cyrille - le salon, 9 Route de Lille, 62218 Loison-sous-Lens",
    // Optionnel : indications pour venir, une par ligne (stationnement, bus…).
    access: [],
  },

  timezone: 'Europe/Paris',

  // Horaires. 0 = dimanche, 1 = lundi … 6 = samedi.
  // Une journée peut avoir plusieurs plages (pause déjeuner). Tableau vide = fermé.
  hours: {
    1: [['09:30', '18:00']],
    2: [['09:30', '18:00']],
    3: [['09:30', '18:00']],
    4: [['09:30', '18:00']],
    5: [['09:30', '18:00']],
    6: [],
    0: [],
  },

  booking: {
    slotStep: 30,          // un créneau toutes les 30 minutes
    minNoticeMinutes: 120, // on ne réserve pas en ligne moins de 2 h à l'avance
    // En ligne, on réserve au plus tard la veille : aucun rendez-vous pour le jour même.
    // (Cyrille peut toujours en noter un le jour même depuis son espace.)
    dayBefore: true,
    // Jusqu'à quand on peut réserver : ce nombre de jours à partir d'aujourd'hui. Le calendrier
    // avance tout seul chaque jour. 730 = deux ans ; mettez 90 pour trois mois, 365 pour un an.
    maxDaysAhead: 730,
    maxActivePerPhone: 3,  // rendez-vous à venir autorisés par numéro de téléphone
    retentionDays: 365,    // les rendez-vous passés sont effacés après un an
    // Rappels par notification proposés au client : combien de minutes avant le rendez-vous.
    reminders: [1440, 120], // la veille, puis 2 h avant
    // Les règles du salon : rappelées à la une, au moment de réserver et dans la confirmation.
    // Laissez vide ('') pour ne pas les afficher.
    appointmentOnly: 'Uniquement sur rendez-vous',
    noShow: 'Un seul rendez-vous non honoré et la personne ne sera pas reprise.',
  },

  // La carte du salon (tarifs relevés sur l'affichette de Cyrille).
  //   price  : un tarif unique ;
  //   prices : un tarif selon la longueur — [cheveux courts, mi-longs, longs] ;
  //   priceFrom: true : affiché « dès … ».
  //
  // Les DURÉES (en minutes, multiples de slotStep) décident des créneaux proposés.
  // Données par Cyrille : coupe brushing, homme, enfant 30 min ; patine 1 h ; couleur 1 h 30 ; balayage 2 h ;
  // ombré patine 2 h ; ombré racine (« Ombré complet » sur la carte) 3 h ; lissage 3 h 30.
  // ⚠ PROVISOIRE — encore estimées, à lui faire valider : pointes, mèches, micro-balayage, soins.
  //
  // Les TEMPS DE POSE (« pauses ») : « after » minutes après le début, Cyrille est libre « duration »
  // minutes et peut prendre quelqu'un d'autre. Donnés par elle pour la couleur, le balayage et l'ombré racine.
  priceNote: 'Tarifs « à partir de ». Supplément pour les cheveux très longs.',
  services: [
    {
      category: 'Coupes et brushing',
      items: [
        { id: 'coupe-brushing', name: 'Coupe brushing', duration: 30, prices: [25, 30, 45] },
        { id: 'coupe-fille', name: 'Filles', duration: 30, price: 15, priceFrom: true },
        { id: 'coupe-homme', name: 'Coupe homme / garçon', duration: 30, price: 13 },
        { id: 'pointes', name: 'Pointes', duration: 30, price: 10 },
      ],
    },
    {
      category: 'Colorations et techniques',
      items: [
        { id: 'patine', name: 'Patine', duration: 60, prices: [35, 45, 50] },
        // 30 min d'application, 30 min de pose, 30 min de coupe et brushing.
        { id: 'coloration', name: 'Coloration', duration: 90, pauses: [{ after: 30, duration: 30 }], prices: [40, 50, 65] },
        { id: 'meches', name: 'Mèches', duration: 120, prices: [55, 65, 80] },
        // 30 min d'application, 30 min de pose, puis 1 h : patine, coupe, brushing.
        { id: 'balayage', name: 'Balayage', duration: 120, pauses: [{ after: 30, duration: 30 }], prices: [75, 85, 100] },
        { id: 'micro-balayage', name: 'Micro-balayage', duration: 180, prices: [85, 105, 125] },
        { id: 'ombre-patine', name: 'Ombré patine', duration: 120, prices: [85, 105, 125] },
        // Ombré racine : application, pose, couleur, pose (30 min chacune), puis 1 h : patine, coupe, brushing.
        { id: 'ombre-complet', name: 'Ombré complet', duration: 180, pauses: [{ after: 30, duration: 30 }, { after: 90, duration: 30 }], prices: [95, 130, 155] },
        { id: 'lissage-tanin', name: 'Lissage tanin', duration: 210, prices: [90, 150, 180] },
      ],
    },
    {
      category: 'Soins capillaires',
      items: [
        { id: 'soin-hydratant', name: 'Soin hydratant', duration: 30, price: 5 },
        { id: 'soin-chaleur', name: 'Soin chaleur', duration: 30, price: 17 },
        // Deux tarifs sur la carte, sans précision : affichés « 30 € / 40 € ».
        { id: 'soin-ultra', name: 'Soin ultra', duration: 30, prices: [30, 40] },
      ],
    },
  ],

  // Prestations mises en avant à la une.
  featuredServices: ['coupe-brushing', 'coloration', 'balayage', 'lissage-tanin'],

  // Texte de présentation, facultatif. Laissez vide : la une affiche alors les photos en grand.
  // Si Cyrille veut écrire quelques lignes sur son salon, mettez un paragraphe par ligne, par exemple :
  //   paragraphs: ["Première phrase de Cyrille.", "Deuxième paragraphe."],
  // Le texte s'affichera à la une, en colonne à côté de la photo.
  about: {
    title: '',
    paragraphs: [],
  },

  // Les photos du salon, rangées dans public/photos/.
  //   hero   : la grande photo de la une ;
  //   second : la photo placée à côté (facultatif) ;
  //   gallery: la page « En images » et la bande de photos de la une.
  // ratio : le format de la photo ('3/4' ou '4/5' portrait, '1/1' carré, '4/3' paysage), pour ne rien couper.
  photos: {
    hero: { src: '/photos/ombre-brun-blond.webp', alt: 'Ombré, du brun au blond', ratio: '3/4' },
    second: { src: '/photos/avant-apres-du-brun-au-blond.webp', alt: 'Avant et après : du brun au blond', ratio: '1/1' },
    gallery: [
      { src: '/photos/avant-apres-du-brun-au-blond.webp', alt: 'Avant et après : du brun au blond', ratio: '1/1' },
      { src: '/photos/ombre-brun-blond.webp', alt: 'Ombré, du brun au blond', ratio: '3/4' },
      { src: '/photos/avant-apres-carre-balayage.webp', alt: 'Avant et après : carré et balayage', ratio: '1/1' },
      { src: '/photos/avant-apres-retour-au-brun.webp', alt: 'Avant et après : retour au brun', ratio: '1/1' },
    ],
  },

  // PROVISOIRE — mentions légales
  legal: {
    company: "L'atelier de Cyrille",
    status: 'entrepreneur individuel',
    siret: '844 660 209 00033',
    publisher: 'Cyrille [nom à compléter]',
    // Cloudflare (voir « Mettre le site en ligne sur Cloudflare » dans le README).
    host: 'Cloudflare, Inc., 101 Townsend St, San Francisco, CA 94107, États-Unis · +1 650 319 8930 · cloudflare.com',
  },
};
