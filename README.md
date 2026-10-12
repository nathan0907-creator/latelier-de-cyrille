# L'atelier de Cyrille

Site du salon : vitrine animée, réservation en ligne avec disponibilités en direct, et espace privé où la coiffeuse reçoit et gère ses rendez-vous.

Aucune dépendance à installer : il suffit de Node.js 22 ou plus récent.

## Démonstration en ligne

Une copie de démonstration est visible sur GitHub Pages : https://nathan0907-creator.github.io/latelier-de-cyrille/

On y voit toutes les pages et on peut y essayer la réservation, mais **rien n'y est enregistré** : un hébergement de simples fichiers ne fait pas tourner le serveur du salon. Les créneaux y sont calculés dans le navigateur avec les vraies règles (horaires, durées), et l'espace de la coiffeuse n'y figure pas. La démonstration est refaite à chaque modification et chaque nuit (`scripts/export-demo.js`, `.github/workflows/demo.yml`).

## Le parti pris : une gazette de coiffure

Le site se lit comme un magazine féminin d'autrefois : papier crème, encre brune, framboise, titre en écriture d'enseigne. Chaque page est une page de la gazette, et on les tourne :

| Page | Rubrique | Contenu |
| --- | --- | --- |
| 1 | La une | Manchette, gros titre, grande photo, brèves, sommaire, extrait des tarifs, photos, rendez-vous |
| 2 | La carte | Toutes les prestations, ligne par ligne |
| 3 | En images | Les photos, tramées comme à l'impression (la couleur revient au survol) |
| 4 | Prendre rendez-vous | La réservation, présentée comme une page de petites annonces |
| 5 | Pratique | Adresse, plan, horaires |

La prise de rendez-vous reprend l'affichette à languettes des petites annonces de quartier : on **entoure** une annonce (la prestation) au stylo rouge, on **arrache** une languette (le créneau), on **renvoie le coupon** (ses coordonnées). Une languette déjà prise est déjà arrachée ; si quelqu'un d'autre la prend pendant qu'on hésite, elle tombe sous nos yeux.

Les mentions légales s'appellent « l'ours » (c'est le nom de l'encadré qui dit qui publie un journal) et l'espace de la coiffeuse, « la rédaction ».

Le site contient volontairement très peu de phrases : des titres, des prix, des horaires. Si Cyrille veut un texte de présentation, il se met dans `about` (fichier `salon.config.js`) et s'affiche à la une, à côté de la photo.

**Sur téléphone**, une barre rouge en bas de l'écran garde la réservation à portée de pouce (avec le prochain créneau libre) ; pendant la réservation, elle est remplacée par le récapitulatif du rendez-vous en cours.

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

Les photos actuelles sont des images provisoires chargées depuis une banque d'images. Pour mettre celles du salon, déposez-les dans `public/photos/` et indiquez leur chemin dans `salon.config.js` (voir `public/photos/LISEZ-MOI.txt`). Toutes les photos sont affichées en noir et blanc tramé, comme imprimées ; la couleur d'origine revient au survol et dans la visionneuse.

## Ce que fait le site

**Pour les clients**

- La une, la carte des prestations, la galerie avec visionneuse, la page pratique (plan Google Maps chargé à la demande, itinéraire, horaires).
- Réservation en trois étapes : l'annonce (prestation), le créneau (jour et heure), le coupon (coordonnées). Les créneaux tiennent compte de la durée de chaque prestation et de la pause déjeuner. Deux personnes ne peuvent pas prendre le même créneau.
- Disponibilités en direct : si quelqu'un réserve pendant que vous hésitez, sa languette s'arrache sous vos yeux.
- Depuis la une, une languette de l'affichette ouvre la réservation directement sur le jour choisi.
- Le règlement se fait sur place : c'est rappelé avant la validation et sur la confirmation. Le client peut ajouter le rendez-vous à son agenda.

**Pour la coiffeuse (`/salon`)**

- Agenda du jour, liste de tous les rendez-vous avec recherche, chiffres du jour.
- Les réservations en ligne arrivent en direct, avec un message, un son et une notification si les alertes sont activées (cloche).
- Confirmer, annuler (le créneau est aussitôt reproposé), rétablir, supprimer.
- Noter un rendez-vous pris par téléphone ou au salon.
- Fermer un jour, ou une période entière pour des congés (du… au…, avec un motif). La fermeture est annoncée sur le site : dans le bandeau en haut de la une (en fixe quand elle est en cours ou dans les quinze jours), dans « En bref » et sur la page de réservation, avec le jour de réouverture.

## Sécurité de l'espace salon

- Mot de passe haché (scrypt, sel aléatoire) ; il n'est jamais enregistré en clair.
- Première configuration protégée par un code à usage unique affiché côté serveur : personne d'autre ne peut s'approprier l'espace.
- Session par cookie `HttpOnly` et `SameSite=Strict` (et `Secure` en HTTPS), valable 7 jours.
- Blocage 15 minutes après 5 mots de passe erronés.
- Chaque action qui modifie quelque chose doit venir du site lui-même (protection CSRF).
- Les pages publiques ne reçoivent jamais les noms ni les téléphones : le direct annonce seulement « tel jour a changé ».
- En-têtes de sécurité stricts : aucun script ni style en ligne, aucun script tiers.
- Réservations : champ piège anti-robots, limite par adresse IP et par numéro de téléphone.

## Données

Les données sont dans `data/` (créé au premier lancement) : `rendez-vous.json`, `fermetures.json`, `compte.json`. Ce dossier contient des coordonnées de clients : sauvegardez-le, ne le publiez jamais (il est déjà exclu par `.gitignore`). Les rendez-vous de plus d'un an sont effacés automatiquement.

## Tests

```bash
npm test
```

33 tests couvrent le calcul des créneaux, les réservations, l'authentification, la sécurité HTTP et le lancement.

## Avant la mise en ligne

- Remplacer les informations et les photos provisoires, compléter les mentions légales.
- Choisir un hébergement qui exécute Node.js (un simple hébergement de pages ne suffit pas) et servir le site en **HTTPS**.
- Derrière un proxy (cas habituel), lancer avec `TRUST_PROXY=1` pour que les limites par adresse IP et le cookie `Secure` fonctionnent.
- Variables utiles : `PORT`, `HOST`, `DATA_DIR` (emplacement des données).
- Les polices viennent de Google Fonts : pour un site sans aucun appel externe, les héberger en local.

Non inclus pour l'instant : e-mails ou SMS de confirmation, paiement en ligne, plusieurs coiffeuses.

## Organisation du code

| Dossier | Rôle |
| --- | --- |
| `salon.config.js` | Toutes les informations du salon |
| `server.js` | Démarrage |
| `src/` | Serveur : créneaux (`availability.js`), réservations, authentification, sécurité HTTP, temps réel |
| `src/views/` | Pages, générées côté serveur |
| `public/css/` | Styles : `base.css` (papier, typographie, annonces, languettes, animations), `pages.css` (les pages du journal), `booking.css`, `salon.css` |
| `public/js/` | `site.js` (animations du site), `booking.js` (réservation), `salon.js` (espace salon) |
| `test/` | Tests automatiques |
