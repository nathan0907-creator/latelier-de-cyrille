# L'atelier de Cyrille

Site du salon : vitrine animée, réservation en ligne avec disponibilités en direct, et espace privé où la coiffeuse reçoit et gère ses rendez-vous.

Aucune dépendance à installer : il suffit de Node.js 22 ou plus récent.

## Démonstration en ligne

L'adresse de démonstration sur GitHub Pages (https://nathan0907-creator.github.io/latelier-de-cyrille/) renvoie maintenant au vrai site, la version complète : chaque page de l'ancienne démonstration mène à la même page du site en ligne. L'adresse du vrai site est celle de `siteUrl`, dans `salon.config.js`.

Sans adresse de vrai site, `scripts/export-demo.js` fabrique comme avant une copie « pour de faux » : toutes les pages, une réservation calculée dans le navigateur avec les vraies règles (horaires, durées, jours fériés), rien d'enregistré, pas d'espace salon.

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
2. Ouvrez `/salon`, saisissez ce code et choisissez l'identifiant de la coiffeuse (son prénom ou son adresse e-mail, par exemple) et son mot de passe (10 caractères au minimum).
3. Le code ne sert qu'une fois. Ensuite, on se connecte avec l'identifiant et le mot de passe.

Mot de passe ou identifiant oublié : arrêtez le serveur, lancez `npm run reset-password`, puis redémarrez. Un nouveau code s'affiche et permet de choisir un nouvel identifiant et un nouveau mot de passe. Les rendez-vous ne sont pas touchés.

Un compte créé avant l'arrivée des identifiants continue de s'ouvrir avec son seul mot de passe ; pour lui donner un identifiant, refaites cette première connexion.

Site en ligne sur Cloudflare : le code n'est pas affiché, c'est vous qui le choisissez (voir « Mettre le site en ligne sur Cloudflare », étape 3).

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

Cyrille peut aussi ajouter, décrire, ranger et retirer des photos elle-même, depuis l'onglet **Photos** de son espace (voir « Ce que la coiffeuse règle elle-même »).

## Ce que fait le site

**Pour les clients**

- La une, la carte des prestations, la galerie avec visionneuse, la page pratique (plan Google Maps chargé à la demande, itinéraire, horaires).
- Réservation en trois étapes : la prestation (choisie dans le tableau des tarifs), le créneau (jour et heure), le coupon (coordonnées). Les créneaux tiennent compte de la durée de chaque prestation et de la pause déjeuner. Deux personnes ne peuvent pas prendre le même créneau.
- Disponibilités en direct : si quelqu'un réserve pendant que vous hésitez, sa languette s'arrache sous vos yeux.
- Depuis la une, une languette de l'affichette ouvre la réservation directement sur le jour choisi.
- **Au plus tard la veille** : en ligne, on ne prend pas de rendez-vous pour le jour même (`booking.dayBefore`). La coiffeuse, elle, peut toujours en noter un depuis son espace.
- **Notifications** : au moment de réserver, une case déjà cochée propose d'être prévenu sur son appareil. Le client apprend alors que le salon a **confirmé** son rendez-vous (ou l'a déplacé, ou annulé), puis reçoit un rappel la veille et une heure avant (délais réglables : `booking.reminders`), même si le site est fermé. Sous le rappel, deux boutons : **Je viens** (la coiffeuse voit la présence confirmée) et **Annuler**. « Ajouter à mon agenda » donne un fichier d'agenda qui sonne aux mêmes moments.
- **Votre rendez-vous** : chaque réservation a sa page personnelle (lien sur la confirmation, dans la notification, dans l'agenda, et rappelé en haut de la page de réservation sur le même appareil). On y voit si le salon a confirmé, et on peut **annuler** jusqu'à l'heure du rendez-vous, en donnant la raison : le créneau est aussitôt reproposé et la coiffeuse est prévenue, avec la raison. Au moment de réserver, le client lit que c'est une demande : en la validant, la coiffeuse peut ajuster l'heure dans la journée, et il est invité à revenir vérifier son rendez-vous.
- Pages légales : mentions légales, confidentialité et cookies (RGPD), conditions d'utilisation. Un avis sur les cookies, où « Refuser » pèse autant qu'« Accepter », ne porte que sur le plan Google Maps : le site ne dépose rien d'autre.

**Pour la coiffeuse (`/salon`)**

- Agenda du jour, liste de tous les rendez-vous avec recherche, chiffres du jour.
- Les réservations en ligne arrivent en direct, avec un message, un son et une notification si les alertes sont activées (cloche).
- Confirmer (tel quel, ou **à une autre heure** : le client est prévenu), **déplacer** à un autre jour ou une autre heure, **rallonger ou raccourcir** un rendez-vous, annuler (le créneau est aussitôt reproposé), rétablir, supprimer. Une heure déjà prise reste proposée (« superposé ») : la coiffeuse peut prendre deux clients à la fois, ils s'affichent côte à côte dans l'agenda.
- **Alertes sur son téléphone** (la cloche) : une notification à chaque nouvelle demande et à chaque annulation par un client, avec sa raison, même quand l'espace salon est fermé.
- Noter un rendez-vous pris par téléphone ou au salon.
- **Fréquentation** : visiteurs, pages vues, réservations en ligne, provenance (Google, Facebook…) et part des téléphones sur 30 jours. Le site compte lui-même, sans cookie ni service extérieur.
- **Jours fériés** : le salon est fermé d'office ces jours-là, sans rien saisir, et le site l'annonce (bandeau de la une, « En bref », page de réservation). Dans l'onglet Fermetures, la coiffeuse ouvre celui qu'elle travaille (dans la liste, ou sur le calendrier), ou arrête la fermeture automatique. Un jour férié qui tombe un jour de repos ne s'affiche pas.
- **Fermetures**, sur un calendrier : un clic sur un jour pour le fermer toute la journée (ou jusqu'à une date, pour des congés), bloquer quelques heures (« fermé de 9h30 à 11h ») ou lui donner d'autres horaires (ouvrir exceptionnellement un samedi, par exemple). Les heures fermées ne sont plus proposées à la réservation. Une fermeture d'une journée ou plus est annoncée sur le site : dans le bandeau en haut de la une (en fixe quand elle est en cours ou dans les quinze jours), dans « En bref » et sur la page de réservation, avec le jour de réouverture.

## Sécurité de l'espace salon

- Mot de passe haché (scrypt, sel aléatoire) ; il n'est jamais enregistré en clair.
- Première configuration protégée par un code à usage unique affiché côté serveur (en ligne sur Cloudflare : un secret choisi dans les réglages) : personne d'autre ne peut s'approprier l'espace.
- Session par cookie `HttpOnly` et `SameSite=Strict` (et `Secure` en HTTPS). Une fois connectée, la coiffeuse le reste sur son appareil : la session se prolonge à chaque visite (400 jours sans revenir y mettent fin), et tient même si le site redémarre. Se déconnecter ou changer de mot de passe la ferme. Le serveur n'en garde que l'empreinte.
- Blocage 15 minutes après 5 mots de passe erronés.
- Chaque action qui modifie quelque chose doit venir du site lui-même (protection CSRF).
- Les pages publiques ne reçoivent jamais les noms ni les téléphones : le direct annonce seulement « tel jour a changé ».
- En-têtes de sécurité stricts : aucun script ni style en ligne, aucun script tiers.
- Réservations : champ piège anti-robots, limite par adresse IP, par numéro de téléphone et pour le site entier (quarante demandes par heure).
- Aucune clé secrète dans les pages : tout se décide sur le serveur. Seule la clé publique des notifications est envoyée au navigateur.
- En ligne, tout est renvoyé vers HTTPS et vers une seule adresse (voir « Mettre le site en ligne sur Cloudflare »).

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
| HTTPS forcé | Redirection et en-tête HSTS dès que `TRUST_PROXY=1`, et toujours sur Cloudflare |
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

## Ce que la coiffeuse règle elle-même

Trois onglets de l'espace salon remplacent, pour ce qui change souvent, le passage par `salon.config.js` :

- **Fichier clients** : l'onglet Clients range les rendez-vous par personne (même téléphone, ou même nom quand il n'y a pas de numéro). Recherche par nom ou téléphone ; chaque fiche montre les coordonnées, les rendez-vous passés et à venir, la prestation habituelle, une note libre réservée à la coiffeuse et une case « Ne plus reprendre ».
- **Temps de pose** : une prestation peut avoir un ou plusieurs temps de pose (une couleur : la pose commence après 30 min et dure 30 min ; un ombré racine en a deux). Pendant une pose, la coiffeuse est libre et le créneau est proposé à quelqu'un d'autre ; l'agenda montre le rendez-vous en plusieurs blocs.
- **Tarifs** : le nom, la durée et le prix de chaque prestation (prix unique, « à partir de », ou selon la longueur des cheveux), l'ordre, les catégories, les prestations mises à la une, la note affichée avec les tarifs. Une prestation retirée n'est plus proposée ; les rendez-vous déjà pris gardent leur prix et leur durée.
- **Horaires** : jours ouverts, heures d'ouverture et de fermeture, pause de midi. Les congés et jours fériés restent dans l'onglet Fermetures.
- **Photos** : ajouter des photos depuis le téléphone ou l'ordinateur (le navigateur les réduit à 1600 px et en fait plusieurs largeurs avant l'envoi), les décrire, les ranger, choisir les deux photos de la une, en supprimer.

Le site est à jour dès l'enregistrement, sans redémarrage. Le serveur revérifie tout : une durée qui ne tombe pas sur un créneau, des horaires qui se chevauchent ou un fichier qui n'est pas une vraie image sont refusés avec un message clair.

Ces réglages passent avant `salon.config.js` : une fois que Cyrille a enregistré sa carte, ses horaires ou ses photos depuis son espace, modifier les mêmes rubriques dans le fichier n'a plus d'effet. Le reste (nom, adresse, téléphone, règles de réservation, mentions légales) se règle toujours dans le fichier.

## Données

Les données sont dans `data/` (créé au premier lancement) : `rendez-vous.json`, `fermetures.json`, `compte.json`, `sessions.json` (appareils connectés à l'espace salon), `rappels.json` (abonnements aux notifications et clés du serveur), `frequentation.json` (compteurs de visites, anonymes), `reglages.json` (ce que la coiffeuse a réglé depuis son espace), `jours-feries.json` (jours fériés ouverts, fermeture automatique), `clients.json` (les notes du fichier clients) et le dossier `photos/` (les photos qu'elle a déposées). Ce dossier contient des coordonnées de clients : sauvegardez-le, ne le publiez jamais (il est déjà exclu par `.gitignore`). Les rendez-vous de plus d'un an sont effacés automatiquement, et avec eux les fiches clients qui n'en ont plus (`booking.retentionDays` : c'est aussi la profondeur de l'historique d'une fiche).

En ligne sur Cloudflare, les mêmes données sont rangées dans la base du site chez Cloudflare (une ligne par fichier ci-dessus et une par photo déposée, voir `cloudflare/storage.js`), et non dans le dépôt : un site en ligne et l'ordinateur du salon ont chacun leurs propres rendez-vous.

## Tests

```bash
npm test
```

92 tests couvrent le calcul des créneaux, les réservations, l'authentification, la sécurité HTTP, le lancement, les rappels (chiffrement vérifié sur l'exemple de la norme), la liste de contrôle (référencement, liens, images, HTTPS, fichiers privés, fréquentation) les jours fériés, les fermetures (jours entiers, heures bloquées, autres horaires), les pages par prestation, la réservation au plus tard la veille, l'annulation par le client (avec sa raison) et les notifications du salon, les alertes de la coiffeuse, « Je viens », la durée réglable et les rendez-vous superposés, les réglages de l'espace salon (tarifs, horaires, photos, déplacement d'un rendez-vous) et le fonctionnement sur Cloudflare (pages, réservation et direct à travers l'adaptateur, code de configuration, base de données, réglages et photos).

## Mettre le site en ligne sur Cloudflare

**C'est fait** : le site est en ligne sur https://latelierdecyrille.com, nom de domaine acheté chez Cloudflare et branché sur le site depuis le tableau de bord (`siteUrl` le déclare dans `salon.config.js`). L'adresse `www.latelierdecyrille.com`, elle, ne répond pas tant qu'elle n'a pas été ajoutée au même endroit (Worker → **Settings** → **Domains & Routes** → **Add** → **Custom domain**) ; une fois ajoutée, le site la renvoie tout seul vers l'adresse sans `www.`. Ce qui suit reste le mode d'emploi pour refaire l'installation.

Cloudflare fait tourner le site sur ses serveurs, jour et nuit, sans ordinateur allumé au salon : réservation, direct, espace de la coiffeuse, rappels par notification et fréquentation fonctionnent comme sur l'ordinateur, en HTTPS. L'offre gratuite de Cloudflare suffit largement pour un salon (100 000 requêtes par jour, soit plusieurs milliers de visites) : seul le nom de domaine se paie.

Comment c'est fait : `cloudflare/worker.js` reçoit les visites et sert lui-même les styles, scripts et photos ; tout le reste est confié au « salon », une instance unique créée en Europe de l'Ouest (un *Durable Object*), qui fait tourner le même code que le serveur de l'ordinateur et range les données dans sa propre base. Il s'endort quand personne ne visite le site et se réveille tout seul pour envoyer les rappels et faire l'entretien. `wrangler.jsonc` décrit tout cela à Cloudflare ; avant chaque publication, `cloudflare/build.js` vérifie `salon.config.js` (une erreur arrête la publication, comme le serveur refuse de démarrer).

### 1. Le nom de domaine

Cloudflare vend les noms de domaine à prix coûtant, mais **pas les « .fr »** :

- **un .fr**, le plus parlant pour un salon de Loison-sous-Lens (`latelier-de-cyrille.fr`) : l'acheter chez un bureau d'enregistrement français (OVH, Gandi, IONOS…, environ 7 à 15 € par an), puis le confier à Cloudflare à l'étape 4 ;
- **un .com** (`latelier-de-cyrille.com`) : l'acheter directement dans Cloudflare (« Domain Registration »), environ 10 € par an. Il est alors déjà prêt pour l'étape 4.

### 2. Publier le site

1. Créer un compte gratuit sur [dash.cloudflare.com](https://dash.cloudflare.com).
2. **Workers & Pages** → **Create** → **Import a repository** : relier le compte GitHub et choisir ce dépôt. Garder les réglages proposés : nom `latelier-de-cyrille` (le même que dans `wrangler.jsonc`), commande de publication `npx wrangler deploy`.
3. Cloudflare publie le site, puis le republie tout seul à chaque modification envoyée sur la branche principale (`main`). Il répond tout de suite à une adresse du type `https://latelier-de-cyrille.<compte>.workers.dev`.

### 3. Le code de la première connexion

Dans le Worker : **Settings** → **Variables and Secrets** → **Add** : type **Secret**, nom `SETUP_CODE`, valeur : un code inventé pour l'occasion, d'au moins 8 lettres ou chiffres (trois mots et un nombre, par exemple). Enregistrer (« Deploy »), puis ouvrir `/salon` : saisir ce code et choisir l'identifiant et le mot de passe de la coiffeuse. Le code ne sert qu'une fois.

**Mot de passe ou identifiant oublié** : remplacer la valeur du secret `SETUP_CODE` par un nouveau code. L'espace salon redemande alors le code, puis un nouvel identifiant et un nouveau mot de passe ; les appareils connectés sont déconnectés, les rendez-vous ne sont pas touchés.

### 4. Brancher le nom de domaine

1. Un .fr acheté ailleurs : dans Cloudflare, **Add a domain**, offre **Free**. Cloudflare donne deux « serveurs de noms » (`…ns.cloudflare.com`) : chez le bureau d'enregistrement, remplacer les serveurs DNS du domaine par ces deux-là. Le domaine est actif après quelques heures (Cloudflare envoie un e-mail).
2. Dans `wrangler.jsonc`, retirer les `//` devant le bloc `routes` et y mettre le vrai nom, avec et sans `www.`.
3. Dans `salon.config.js`, renseigner `siteUrl` (par exemple `https://www.latelier-de-cyrille.fr`) et compléter les mentions légales (forme juridique, SIRET ; l'hébergeur, Cloudflare, est déjà indiqué).
4. Envoyer ces modifications sur `main` : Cloudflare republie le site sur le nom de domaine, avec son certificat HTTPS. Toute visite en `http://` ou sans `www.` est renvoyée vers `siteUrl`.

### 5. Les e-mails aux clients (facultatif)

Avec une adresse e-mail laissée en réservant (case « E-mail (conseillé) »), le client reçoit : la demande bien reçue, le rendez-vous confirmé, déplacé ou annulé par le salon, et la veille un « N'oubliez pas votre rendez-vous », chacun avec les informations pratiques en bas (adresse, téléphone, itinéraire). Les e-mails partent par **Brevo**, un service français, gratuit jusqu'à 300 e-mails par jour. Sans ces réglages, le site ne demande pas d'e-mail.

1. Créer un compte sur https://www.brevo.com (offre gratuite).
2. **Expéditeurs, domaines** : ajouter l'adresse d'expédition et la valider. L'idéal : une adresse du nom de domaine du salon (par exemple `rendez-vous@latelier-de-cyrille.fr`), et dans Brevo « Authentifier le domaine » (Brevo donne les lignes à ajouter dans le DNS de Cloudflare) : les e-mails n'arrivent alors pas dans les indésirables.
3. **SMTP et API** → **Clés API** → créer une clé.
4. Dans le Worker sur Cloudflare : **Settings** → **Variables and Secrets** : un secret `BREVO_API_KEY` (la clé). L'adresse d'expédition est `MAIL_FROM`, dans `wrangler.jsonc` (à changer là si besoin). Sur l'ordinateur du salon, les mêmes noms en variables d'environnement.

Les réponses des clients vont à l'adresse e-mail du salon, si elle est renseignée dans `salon.config.js` (`contact.email`).

Le texte de chaque e-mail se change dans l'espace salon, onglet **E-mails** : objet et texte, avec `{prenom}`, `{date}`, `{heure}`, `{prestation}`… remplis pour chaque client, un aperçu, « M'envoyer un essai » et « Revenir au texte d'origine ». Les textes sont gardés dans `data/textes-emails.json`.

### 6. Un site d'essai

Un second site, `latelier-de-cyrille-essai`, pour tout essayer (réserver, annuler, valider, recevoir les alertes) sans toucher au vrai : ses rendez-vous, son compte et ses alertes sont à part. Son nom porte « (site d'essai) » et il n'apparaît pas sur Google.

1. Dans Cloudflare, **Workers & Pages** → **Create** → **Import a repository** : choisir ce dépôt.
2. Nom du projet : **`latelier-de-cyrille-essai`** (exactement celui-là).
3. **Build settings** → **Deploy command** : `npx wrangler deploy --env essai`. Puis **Create and deploy**.
4. Dans ce nouveau Worker : **Settings** → **Variables and Secrets** → secret `SETUP_CODE`, avec un code différent de celui du vrai site.
5. L'adresse du site d'essai est en haut de la page du Worker : `https://latelier-de-cyrille-essai.….workers.dev`. Ouvrir `/salon` et y créer un compte d'essai.

Il suit `main`, comme le vrai site. Pour essayer une modification avant de l'accepter : **Settings** → **Build** → **Branch control**, et choisir la branche de la demande de fusion.

Le site tourne aussi sur Cloudflare sans être publié, pour essayer une modification : `npx wrangler dev`, puis http://localhost:8787 (le code de configuration se met alors dans un fichier `.dev.vars` : `SETUP_CODE=…`).

### Sur un serveur à soi

Autre possibilité : un hébergement qui exécute Node.js en continu (un simple hébergement de pages ne suffit pas).

1. Dans `salon.config.js`, renseigner `siteUrl` et compléter les mentions légales, hébergeur compris.
2. Sur le serveur, placer devant le site un serveur frontal qui s'occupe du certificat HTTPS. Avec [Caddy](https://caddyserver.com), deux lignes suffisent, le certificat est demandé et renouvelé tout seul :

   ```
   www.latelier-de-cyrille.fr, latelier-de-cyrille.fr {
       reverse_proxy localhost:3000
   }
   ```

3. Lancer le site avec `TRUST_PROXY=1` : il renvoie alors toute visite en `http://` vers `https://`, toute visite sur une autre adresse (sans `www.`, par exemple) vers celle de `siteUrl`, protège le cookie de session et applique les limites par adresse IP.
4. Variables utiles : `PORT`, `HOST`, `DATA_DIR` (emplacement des données, à sauvegarder).

### Être trouvé sur Google

Chaque prestation a sa propre page (`/prestations/balayage` : « Balayage à Loison-sous-Lens »), avec son tarif, sa durée et le bouton pour réserver : autant d'occasions d'être trouvé par qui cherche cette prestation dans le coin. Le plan du site les liste toutes, avec les photos de la galerie, et les jours de fermeture (congés, jours fériés) sont transmis avec les horaires.

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
| `src/` | Serveur : créneaux (`availability.js`), réservations, rappels (`reminders.js`, `push.js`), fréquentation (`stats.js`), réglages de l'espace salon (`settings.js`), authentification, sécurité HTTP, temps réel |
| `src/views/` | Pages, générées côté serveur |
| `public/css/` | Styles : `base.css` (papier, typographie, languettes, animations), `pages.css` (les pages du journal), `booking.css`, `salon.css` |
| `public/js/` | `site.js` (animations du site, avis sur les cookies), `booking.js` (réservation, rappel), `salon.js` (espace salon), `salon-clients.js` (son fichier clients) et `salon-reglages.js` (ses onglets Tarifs, Horaires, Photos) |
| `public/sw.js` | Reçoit et affiche les notifications de rappel |
| `cloudflare/`, `wrangler.jsonc` | Le site en ligne sur Cloudflare : point d'entrée (`worker.js`), passage de Cloudflare au serveur (`adapter.js`), base de données (`storage.js`), préparation (`build.js`) |
| `test/` | Tests automatiques |
