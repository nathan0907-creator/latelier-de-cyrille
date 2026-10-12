# L'atelier de Cyrille

Site du salon : vitrine animée, réservation en ligne avec disponibilités en direct, et espace privé où la coiffeuse reçoit et gère ses rendez-vous.

Aucune dépendance à installer : il suffit de Node.js 22 ou plus récent.

## Démonstration en ligne

Une copie de démonstration est visible sur GitHub Pages : https://nathan0907-creator.github.io/latelier-de-cyrille/

On y voit toutes les pages et on peut y essayer la réservation, mais **rien n'y est enregistré** : un hébergement de simples fichiers ne fait pas tourner le serveur du salon. Les créneaux y sont calculés dans le navigateur avec les vraies règles (horaires, durées) ; l'espace de la coiffeuse, les rappels par notification et la mesure de fréquentation n'y figurent pas. Elle est volontairement cachée aux moteurs de recherche : personne ne doit y prendre un rendez-vous qui n'existe pas. La démonstration est refaite à chaque modification et chaque nuit (`scripts/export-demo.js`, `.github/workflows/demo.yml`).

## Le parti pris : une gazette de coiffure

Le site se lit comme un magazine féminin d'autrefois : papier beige, encre brune, or, titre en écriture d'enseigne. L'or n'habille qu'un seul bouton par écran, celui de la prise de rendez-vous. Chaque page est une page de la gazette, et on les tourne :

| Page | Rubrique | Contenu |
| --- | --- | --- |
| 1 | La une | Manchette, gros titre, grande photo, brèves, sommaire, extrait des tarifs, photos, rendez-vous |
| 2 | La carte | Toutes les prestations, ligne par ligne |
| 3 | En images | Les photos, tramées comme à l'impression (la couleur revient au survol) |
| 4 | Prendre rendez-vous | La réservation : le tableau des tarifs, l'affichette à languettes, le coupon |
| 5 | Pratique | Adresse, plan, horaires |

La prise de rendez-vous reprend l'affichette à languettes des petites annonces de quartier : on **choisit** une prestation dans le tableau des tarifs (la prestation à gauche, les prix par longueur de cheveux à droite), on **arrache** une languette (le créneau), on **renvoie le coupon** (ses coordonnées). Une languette déjà prise est déjà arrachée ; si quelqu'un d'autre la prend pendant qu'on hésite, elle tombe sous nos yeux.

« Uniquement sur rendez-vous » est écrit en gros sous le titre de la une, et la règle du salon (un rendez-vous non honoré, la personne n'est pas reprise) est redite au moment de réserver, dans la confirmation et dans les conditions d'utilisation. Ces deux phrases se règlent dans `salon.config.js` (`booking.appointmentOnly`, `booking.noShow`).

Les mentions légales s'appellent « l'ours » (c'est le nom de l'encadré qui dit qui publie un journal) et l'espace de la coiffeuse, « la rédaction ».

Le site contient volontairement très peu de phrases : des titres, des prix, des horaires. Si Cyrille veut un texte de présentation, il se met dans `about` (fichier `salon.config.js`) et s'affiche à la une, à côté de la photo.

**Sur téléphone**, une barre dorée en bas de l'écran garde la réservation à portée de pouce (avec le prochain créneau libre) ; pendant la réservation, elle est remplacée par le récapitulatif du rendez-vous en cours.

## Ouvrir le site

**Le plus simple : double-cliquez sur le raccourci « L'atelier de Cyrille » du Bureau.**
Le site démarre et s'ouvre tout seul dans le navigateur.

- Pas de raccourci sur le Bureau ? Double-cliquez sur `Ouvrir le site.bat` dans ce dossier (même effet), ou sur `Creer le raccourci sur le Bureau.bat` pour recréer le raccourci (à refaire si vous déplacez le dossier ou l'installez sur un autre ordinateur).
- Une fenêtre noire reste ouverte : c'est le site qui tourne. **La fermer arrête le site.**
- Un second double-clic ne lance rien en double : il rouvre simplement le site dans le navigateur.
- Si le port 3000 est pris par un autre programme, le site choisit tout seul le port libre suivant ; l'adresse exacte est affichée dans la fenêtre.

| Page | Adresse |
| --- | --- |
| Site | http://localhost:3000/ |
| Réservation | http://localhost:3000/reservation |
| Espace salon | http://localhost:3000/salon |

**Sur un téléphone** connecté au même Wi-Fi : ouvrez l'adresse `http://192.168.x.x:3000/` affichée dans la fenêtre. Pour la retrouver d'un geste, utilisez « Ajouter à l'écran d'accueil » dans le menu du navigateur : une icône ouvre alors directement le site (faites-le depuis la page `/salon` pour l'espace de la coiffeuse). Si la page ne s'ouvre pas, autorisez Node.js sur les « réseaux privés » dans le pare-feu Windows.

En ligne de commande : `node server.js` (ou `npm run open` pour ouvrir aussi le navigateur).

## Première utilisation de l'espace salon

1. Au premier démarrage, le serveur affiche un **code de configuration** dans sa fenêtre.
2. Ouvrez `/salon`, saisissez ce code et choisissez le mot de passe de la coiffeuse (10 caractères au minimum).
3. Le code ne sert qu'une fois. Ensuite, on se connecte avec le mot de passe.

Mot de passe oublié : arrêtez le serveur, lancez `npm run reset-password`, puis redémarrez. Un nouveau code s'affiche. Les rendez-vous ne sont pas touchés.

## Mettre les vraies informations

Tout se règle dans **`salon.config.js`** (les valeurs marquées `PROVISOIRE` sont des exemples) :

- nom, coordonnées, adresse (elle sert aussi à Google Maps) ;
- horaires, avec pause déjeuner possible ;
- prestations, durées et prix (`price` pour un tarif unique, `prices` pour un tarif selon la longueur : cheveux courts, mi-longs, longs) ;
- règles de réservation (délai minimum, nombre de jours ouverts à la réservation) ;
- photos et mentions légales.

Relancez le serveur après chaque modification. Si une valeur est incohérente (durée qui ne tombe pas sur un créneau, horaires qui se chevauchent…), le serveur refuse de démarrer et dit quoi corriger.

### Photos

Les photos du salon sont dans `public/photos/` ; leur chemin, leur description (`alt`, lue aux personnes malvoyantes et par Google) et leur format sont dans `salon.config.js` (voir `public/photos/LISEZ-MOI.txt`). Si une photo `nom.webp` est accompagnée de versions réduites `nom-480.webp`, `nom-800.webp`, `nom-1200.webp`, le site les propose toutes au navigateur, qui charge la plus petite qui suffit à l'écran : sur téléphone, la grande photo de la une pèse de 24 à 80 Ko selon l'écran, au lieu de 204.

## Ce que fait le site

**Pour les clients**

- La une, la carte des prestations, la galerie avec visionneuse, la page pratique (plan Google Maps chargé à la demande, itinéraire, horaires).
- Réservation en trois étapes : la prestation (choisie dans le tableau des tarifs), le créneau (jour et heure), le coupon (coordonnées). Les créneaux tiennent compte de la durée de chaque prestation et de la pause déjeuner. Deux personnes ne peuvent pas prendre le même créneau.
- Disponibilités en direct : si quelqu'un réserve pendant que vous hésitez, sa languette s'arrache sous vos yeux.
- Depuis la une, une languette de l'affichette ouvre la réservation directement sur le jour choisi.
- **Rappels** : sur la confirmation, « Me le rappeler » envoie une notification sur l'appareil du client la veille et deux heures avant (délais réglables : `booking.reminders`), même si le site est fermé. « Ajouter à mon agenda » donne un fichier d'agenda qui sonne aux mêmes moments.
- Pages légales : mentions légales, confidentialité et cookies (RGPD), conditions d'utilisation. Un avis sur les cookies, où « Refuser » pèse autant qu'« Accepter », ne porte que sur le plan Google Maps : le site ne dépose rien d'autre.

**Pour la coiffeuse (`/salon`)**

- Agenda du jour, liste de tous les rendez-vous avec recherche, chiffres du jour.
- Les réservations en ligne arrivent en direct, avec un message, un son et une notification si les alertes sont activées (cloche).
- Confirmer, annuler (le créneau est aussitôt reproposé), rétablir, supprimer.
- Noter un rendez-vous pris par téléphone ou au salon.
- **Fréquentation** : visiteurs, pages vues, réservations en ligne, provenance (Google, Facebook…) et part des téléphones sur 30 jours. Le site compte lui-même, sans cookie ni service extérieur.
- Fermer un jour, ou une période entière pour des congés (du… au…, avec un motif). La fermeture est annoncée sur le site : dans le bandeau en haut de la une (en fixe quand elle est en cours ou dans les quinze jours), dans « En bref » et sur la page de réservation, avec le jour de réouverture.

## Sécurité de l'espace salon

- Mot de passe haché (scrypt, sel aléatoire) ; il n'est jamais enregistré en clair.
- Première configuration protégée par un code à usage unique affiché côté serveur : personne d'autre ne peut s'approprier l'espace.
- Session par cookie `HttpOnly` et `SameSite=Strict` (et `Secure` en HTTPS), valable 7 jours.
- Blocage 15 minutes après 5 mots de passe erronés.
- Chaque action qui modifie quelque chose doit venir du site lui-même (protection CSRF).
- Les pages publiques ne reçoivent jamais les noms ni les téléphones : le direct annonce seulement « tel jour a changé ».
- En-têtes de sécurité stricts : aucun script ni style en ligne, aucun script tiers.
- Réservations : champ piège anti-robots, limite par adresse IP, par numéro de téléphone et pour le site entier (quarante demandes par heure).
- Aucune clé secrète dans les pages : tout se décide sur le serveur. Seule la clé publique des notifications est envoyée au navigateur.
- En ligne, tout est renvoyé vers HTTPS et vers une seule adresse (voir « Mettre le site en ligne »).

## Les rappels par notification

Quand un client appuie sur « Me le rappeler », son navigateur s'abonne aux notifications du site et le serveur garde cet abonnement jusqu'au rendez-vous. Chaque minute, le serveur envoie les rappels arrivés à échéance ; le message est chiffré pour l'appareil du client, et le service de notification du navigateur (Google, Mozilla, Apple, Microsoft) le transporte sans pouvoir le lire. Tout est fait avec Node.js seul (`src/push.js`, `src/reminders.js`, `public/sw.js`).

À savoir :

- Les navigateurs n'autorisent les notifications que sur un site en **HTTPS** (ou sur `localhost`). Sur l'ordinateur où tourne le site, le bouton apparaît ; sur un téléphone relié par le Wi-Fi à une adresse `http://192.168…`, il reste caché tant que le site n'est pas en ligne. Le fichier d'agenda, lui, fonctionne partout.
- Sur iPhone, les notifications d'un site ne sont possibles qu'une fois le site ajouté à l'écran d'accueil.
- Le serveur doit pouvoir joindre Internet pour envoyer les rappels, et tourner à l'heure du rappel.

## La liste de contrôle

| Point | Où c'est fait |
| --- | --- |
| Page RGPD, page CGU | `/confidentialite`, `/conditions` (textes à faire relire par Cyrille) |
| Rien de secret dans les pages | Tout passe par le serveur ; testé (`test/site.test.js`) |
| HTTPS forcé | Redirection et en-tête HSTS dès que `TRUST_PROXY=1` |
| Bannière cookies | Avis en bas de l'écran, choix gardé six mois, modifiable depuis le pied de page |
| Titres et descriptions | Un titre et une description propres à chaque page, avec le métier et la ville |
| Image pour les réseaux | `public/img/partage.jpg` (1200 × 630) |
| Icône | `favicon.ico`, icônes 192 et 512, icône pour iPhone |
| Plan du site, robots.txt | `/sitemap.xml`, `/robots.txt` |
| Textes des images | Chaque photo a sa description ; testé |
| Images compressées | WebP en plusieurs largeurs |
| Vitesse | Styles et scripts gardés un an par le navigateur, pages compressées, grande photo chargée en priorité |
| Contraste | Tous les textes au-dessus du seuil de lisibilité (4,5 pour 1) |
| Téléphone | Vérifié de 320 à 1920 pixels de large |
| Page 404 | Page « Cette page n'a jamais été imprimée » |
| Liens cassés | Tous les liens du site sont parcourus par les tests |
| Formulaires | Vérifiés dans le navigateur et de nouveau sur le serveur |
| Anti-spam | Champ piège, limites par adresse, par numéro et globale |
| Mesure d'audience | Vue « Fréquentation » de l'espace salon |
| Un seul bouton principal | L'or est réservé à la prise de rendez-vous |

## Données

Les données sont dans `data/` (créé au premier lancement) : `rendez-vous.json`, `fermetures.json`, `compte.json`, `rappels.json` (abonnements aux notifications et clés du serveur) et `frequentation.json` (compteurs de visites, anonymes). Ce dossier contient des coordonnées de clients : sauvegardez-le, ne le publiez jamais (il est déjà exclu par `.gitignore`). Les rendez-vous de plus d'un an sont effacés automatiquement.

## Tests

```bash
npm test
```

55 tests couvrent le calcul des créneaux, les réservations, l'authentification, la sécurité HTTP, le lancement, les rappels (chiffrement vérifié sur l'exemple de la norme) et la liste de contrôle (référencement, liens, images, HTTPS, fichiers privés, fréquentation).

## Mettre le site en ligne

Il faut un hébergement qui exécute Node.js en continu (un simple hébergement de pages ne suffit pas) et un nom de domaine.

1. Dans `salon.config.js`, renseigner `siteUrl` (par exemple `https://www.latelier-de-cyrille.fr`) et compléter les mentions légales (forme juridique, SIRET, hébergeur).
2. Sur le serveur, placer devant le site un serveur frontal qui s'occupe du certificat HTTPS. Avec [Caddy](https://caddyserver.com), deux lignes suffisent, le certificat est demandé et renouvelé tout seul :

   ```
   www.latelier-de-cyrille.fr, latelier-de-cyrille.fr {
       reverse_proxy localhost:3000
   }
   ```

3. Lancer le site avec `TRUST_PROXY=1` : il renvoie alors toute visite en `http://` vers `https://`, toute visite sur une autre adresse (sans `www.`, par exemple) vers celle de `siteUrl`, protège le cookie de session et applique les limites par adresse IP.
4. Variables utiles : `PORT`, `HOST`, `DATA_DIR` (emplacement des données, à sauvegarder).

### Être trouvé sur Google

Le site donne aux moteurs de recherche tout ce qu'ils attendent : un titre et une description par page (« Coiffeuse à Loison-sous-Lens · L'atelier de Cyrille »), l'adresse de référence de chaque page, la fiche du salon en données structurées (adresse, téléphone, horaires, tarifs, lien de réservation, communes voisines), `/sitemap.xml` et `/robots.txt`. Une fois le site en ligne, trois gestes font le reste :

1. **Fiche d'établissement Google** (google.com/business) : c'est elle qui fait apparaître le salon sur Google Maps et dans les recherches « coiffeuse Loison-sous-Lens ». Y mettre la même adresse, le même téléphone et le lien du site.
2. **Google Search Console** (search.google.com/search-console) : ajouter le site, choisir la vérification par « balise HTML », coller le code dans `seo.googleVerification` (`salon.config.js`), puis envoyer `/sitemap.xml`. Même chose pour Bing avec `seo.bingVerification`.
3. Mettre le lien du site sur la page Facebook du salon.

Les polices viennent de Google Fonts : pour un site sans aucun appel externe, les héberger en local.

Non inclus pour l'instant : e-mails ou SMS de confirmation, paiement en ligne, plusieurs coiffeuses.

## Organisation du code

| Dossier | Rôle |
| --- | --- |
| `salon.config.js` | Toutes les informations du salon |
| `server.js` | Démarrage |
| `src/` | Serveur : créneaux (`availability.js`), réservations, rappels (`reminders.js`, `push.js`), fréquentation (`stats.js`), authentification, sécurité HTTP, temps réel |
| `src/views/` | Pages, générées côté serveur |
| `public/css/` | Styles : `base.css` (papier, typographie, languettes, animations), `pages.css` (les pages du journal), `booking.css`, `salon.css` |
| `public/js/` | `site.js` (animations du site, avis sur les cookies), `booking.js` (réservation, rappel), `salon.js` (espace salon) |
| `public/sw.js` | Reçoit et affiche les notifications de rappel |
| `test/` | Tests automatiques |
