# Helpeat

Helpeat est une PWA indépendante pour le Vietnam. Elle propose des plats et des sorties à partir du catalogue approuvé de HOME Reviews. Le journal, les comptes et les préférences de notification sont stockés séparément dans SQLite.

## Démonstration publique

[Ouvrir Helpeat sur GitHub Pages](https://ngpcao-spec.github.io/helpeat/).

La version publiée présente un catalogue fictif et des résultats photo prédéfinis. Les fiches et les prix portent une mention de démonstration. Le journal et les réglages sont propres à ce navigateur. Les photos sélectionnées ne sont ni envoyées ni stockées par la démo. Elle fonctionne sans compte et sans connexion à Supabase, OpenAI ou Apify. Les notifications Web Push sont désactivées.

Pour l’ajouter à l’écran d’accueil sur iPhone ou iPad, ouvrir la page dans Safari et choisir **Sur l’écran d’accueil** dans le menu de partage. [Guide Apple](https://support.apple.com/guide/iphone/bookmark-a-website-iph42ab2f3a7/ios).

## Tester en local

Avec Node.js 24 ou ultérieur, dans le dossier Helpeat.

~~~powershell
npm.cmd ci
npm.cmd run build
npm.cmd run preview
~~~

Ouvrir [la démo sur localhost](http://localhost:4173/helpeat/), au port affiché par Vite. Utiliser `npm.cmd run dev` pour modifier la démo avec rechargement. `npm.cmd run preview:server` lance l’aperçu historique du serveur avec un journal en mémoire.

Pour relancer les vérifications du serveur, exécuter `npm.cmd test`.

## Publication

Le workflow officiel GitHub Pages installe les dépendances, lance les tests, compile avec Vite, puis publie l’artefact `github-pages`. La branche `main` déclenche le workflow. Les liens internes utilisent des fragments sous `/helpeat/`. Le Service Worker précache les ressources du build et remplace le cache de la démo lorsqu’une nouvelle version est déployée.

## Passage au mode réel

GitHub Pages sert le build de démonstration statique. Pour le mode réel, héberger le serveur Node sous HTTPS, positionner `APP_ORIGIN` et configurer les variables de [.env.example](.env.example) sur l’hébergeur. Raccorder le stockage personnel à des tables Helpeat isolées dans le projet Supabase existant `ihuztjkblywzjdruusdj`, qui héberge aussi le connecteur IA. Le serveur actuel utilise SQLite pour les essais du journal et de l’authentification.

| Intégration | Paramètres et comportement |
| --- | --- |
| Connexion Google | Configurer un client OAuth Web avec l’URI de retour `<APP_ORIGIN>/auth/google/callback`. Renseigner `GOOGLE_CLIENT_ID` et `GOOGLE_CLIENT_SECRET`. L’instance exige une session Google. Elle associe le journal à l’identifiant Google stable. |
| Catalogue | Configurer `HOME_CATALOG_URL` et, si nécessaire, `HOME_CATALOG_TOKEN`. Cette API serveur publie les données autorisées pour Helpeat. |
| IA | Le point d’entrée `helpeat-ai` dans le projet Supabase HOME Reviews utilise `OPENAI_API_KEY` dans le même environnement serveur. Helpeat utilise `HOME_AI_BRIDGE_URL` et un jeton dédié `HELPEAT_BRIDGE_SECRET` sur son serveur. |
| Photos | Autoriser ce parcours après vérification des règles de conservation du projet OpenAI. Configurer `HELPEAT_PHOTO_ENABLED=true` sur Helpeat et sur la fonction Supabase. Les images sont réduites dans le navigateur puis traitées en mémoire. Les requêtes utilisent `store: false`. |
| Notifications | Configurer `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY` et `WEB_PUSH_SUBJECT` sur une instance HTTPS toujours en cours d’exécution. Vérifier la réception sur les appareils cibles après autorisation du navigateur. |

Les horaires initiaux sont 06:00, 10:00 et 16:30, heure du Vietnam. Un clic sur une notification ouvre le repas correspondant. Un créneau absent du journal est affiché comme non renseigné. Le profil est recalculé à partir des repas confirmés des 180 derniers jours à chaque demande de suggestions. Une correction ou une suppression modifie ainsi les suggestions suivantes.

Avant la mise en service réelle, vérifier la connexion Google et la conservation de l’historique après reconnexion. Consulter les conditions de traitement des images du fournisseur avant d’activer leur envoi. [Documentation OpenAI sur la conservation des données](https://developers.openai.com/api/docs/guides/your-data).

## Contrat de publication HOME Reviews

L’API de catalogue répond à un GET serveur avec une enveloppe JSON contenant `source` égal à `HOME Reviews`, `version` égal à `1` et un tableau `restaurants`. La validation s’appuie sur une décision de publication dans HOME Reviews. Les menus bruts, les avis individuels, les identifiants d’organisation et les analyses privées restent dans HOME Reviews.

| Objet | Informations attendues |
| --- | --- |
| Restaurant | `id` stable, `published: true`, `name`, `zone`, `dishes`. |
| Restaurant, champs complémentaires | `address`, `mapsUrl` en HTTPS, `latitude`, `longitude`, `homeScore` sur 100, `maxGroupSize`, `budgetPerPersonVnd`, `recurringIssues` sous forme de libellés agrégés approuvés. |
| Plat | `id` stable et partagé pour le même plat entre plusieurs adresses, `name`, `confirmed: true` et `validUntil` au format ISO 8601. |
| Plat, champs complémentaires | `family`, `meals` parmi `breakfast`, `lunch` et `dinner`, `priceVnd`, `imageUrl` en HTTPS. |

Un libellé peut être une chaîne ou un objet avec `vi` et `fr`. Les prix sont exprimés en đồng vietnamiens. Une sortie de groupe nécessite un score, un budget par personne et une capacité confirmés. Helpeat filtre les plats et établissements avant tout appel au modèle. Il vérifie les identifiants du modèle dans la présélection et rend jusqu’à trois résultats.

Le projet HOME Reviews contient des données de collecte et d’analyse. La source de catalogue reste à raccorder dès qu’un export de publication validé est disponible.

## Connecteur IA HOME Reviews

Le code source de la fonction est dans [home-reviews/supabase/functions/helpeat-ai/index.ts](home-reviews/supabase/functions/helpeat-ai/index.ts). Le serveur Helpeat l’appelle avec un jeton dédié. Elle traite les actions de classement ou de reconnaissance et renvoie des identifiants de candidats ou des noms de plats. Le corps des requêtes et des réponses du modèle est exclu des journaux applicatifs.

Lors d’un redéploiement, conserver la validation du jeton par la fonction. Configurer le jeton dédié en secret Supabase ou injecter uniquement son empreinte SHA-256 dans la configuration de déploiement. Le jeton d’accès au connecteur reste distinct de la clé OpenAI de HOME Reviews.

La fonction a été déployée dans le projet HOME Reviews. Un appel authentifié avec deux candidats de test a renvoyé leurs identifiants, et l’appel sans jeton a reçu un refus HTTP 401. La reconnaissance photo est désactivée sur cette instance.

L’illustration [hero.webp](public/hero.webp) a été générée avec ImageGen à partir de ce brief.

> Photorealistic editorial hero photograph for HELPEAT, an elegant Vietnamese food app. Very wide horizontal crop. A dark handmade ceramic bowl of Vietnamese phở with thin slices of beef, rice noodles, fresh cilantro and scallions, accompanied by lime and chopsticks, on charcoal textured tabletop. Warm amber side light, extremely appetizing real food photographed at a three-quarter angle. The bowl is entirely on the right, weighted 75 percent to the right, table on left dark and quietly textured as negative space for overlaid HTML. Palette black brown, champagne amber, and natural greens. Refined contemporary Hanoi dining editorial, deep shadows, no text, no logo, no watermark. The image is an illustration, not tied to any venue.

Illustrations ImageGen de la démonstration.

- [bun.webp](public/bun.webp) — Photorealistic editorial food photo of authentic Vietnamese bún thịt nướng in a charcoal ceramic bowl, rice vermicelli, grilled pork, fresh Vietnamese herbs, cucumber, peanuts and pickled carrot, warm side lighting, dark earthy tabletop, natural texture, center composition for a small card or wide crop. Premium warm charcoal and champagne visual style. No text or logos.
- [com.webp](public/com.webp) — Photorealistic editorial food photo of Vietnamese cơm tấm sườn with broken rice, Vietnamese grilled pork chop, fresh sliced cucumber, cherry tomato, small nước chấm bowl, dark handmade ceramic plate, warm natural side lighting, dark charcoal tabletop, refined restaurant photography. Horizontal, center composition. No text or logos.
