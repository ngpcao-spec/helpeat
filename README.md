# Helpeat

Helpeat est une PWA pour le Vietnam. La démonstration publique propose des données fictives. Le mode pilote utilise Supabase Auth et des tables propres à Helpeat dans le projet de HOME Reviews.

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

Le workflow officiel GitHub Pages installe les dépendances, lance les tests, compile avec Vite, puis publie l’artefact `github-pages`. La branche `main` déclenche le workflow. Les liens internes utilisent des fragments sous `/helpeat/`. Le Service Worker précache les ressources du build et remplace le cache de la démo lorsqu’une nouvelle version est déployée. La publication fixe `VITE_HELPEAT_ENABLE_REAL=false`.

## Passage au mode réel

Le navigateur utilise le projet existant `ihuztjkblywzjdruusdj`. Supabase Auth gère Google avec PKCE, l’actualisation des jetons et la fermeture de la session utilisée par Helpeat. Le journal et les préférences identifient le propriétaire par `auth.users.id` et appliquent des politiques RLS. Les modifications sont enregistrées dans Supabase et relues sur les autres appareils à l’ouverture ou au retour au premier plan. SQLite est réservé à l’ancien aperçu et aux tests locaux.

Le schéma du journal a été appliqué en production sous la version `20261124082946`. Le mode réel est accessible aux comptes Google déjà admis au pilote. Le [dossier de déploiement Auth](supabase/auth-rollout/README.md) détaille les étapes et les vérifications restantes.

Les horaires initiaux sont 06:00, 10:00 et 16:30, heure du Vietnam. Le calcul SQL des habitudes relit les repas confirmés des 180 derniers jours. Les modifications et suppressions se reflètent à la lecture suivante. La reconnaissance photo réelle et Web Push restent désactivés.

## Catalogue HOME Reviews

Le mode pilote lit le catalogue de HOME Reviews dans le même projet Supabase. Les restaurants classés street food et leurs plats actifs sont disponibles dès le chargement suivant. Les scores, prix, horaires et capacités s’affichent lorsqu’ils sont disponibles. [Sources et déploiement du catalogue](supabase/CATALOG.md).

## Connecteur IA HOME Reviews

Le code source de la fonction est dans [home-reviews/supabase/functions/helpeat-ai/index.ts](home-reviews/supabase/functions/helpeat-ai/index.ts). Le serveur Helpeat l’appelle avec un jeton dédié. Elle traite les actions de classement ou de reconnaissance et renvoie des identifiants de candidats ou des noms de plats. Le corps des requêtes et des réponses du modèle est exclu des journaux applicatifs.

Lors d’un redéploiement, conserver la validation du jeton par la fonction. Configurer le jeton dédié en secret Supabase ou injecter uniquement son empreinte SHA-256 dans la configuration de déploiement. Le jeton d’accès au connecteur reste distinct de la clé OpenAI de HOME Reviews.

La fonction existante demeure en place dans HOME Reviews. Le frontend actuel ne l’appelle pas. La reconnaissance photo réelle est désactivée sur cette instance.

L’illustration [hero.webp](public/hero.webp) a été générée avec ImageGen à partir de ce brief.

> Photorealistic editorial hero photograph for HELPEAT, an elegant Vietnamese food app. Very wide horizontal crop. A dark handmade ceramic bowl of Vietnamese phở with thin slices of beef, rice noodles, fresh cilantro and scallions, accompanied by lime and chopsticks, on charcoal textured tabletop. Warm amber side light, extremely appetizing real food photographed at a three-quarter angle. The bowl is entirely on the right, weighted 75 percent to the right, table on left dark and quietly textured as negative space for overlaid HTML. Palette black brown, champagne amber, and natural greens. Refined contemporary Hanoi dining editorial, deep shadows, no text, no logo, no watermark. The image is an illustration, not tied to any venue.

Illustrations ImageGen de la démonstration.

- [bun.webp](public/bun.webp) — Photorealistic editorial food photo of authentic Vietnamese bún thịt nướng in a charcoal ceramic bowl, rice vermicelli, grilled pork, fresh Vietnamese herbs, cucumber, peanuts and pickled carrot, warm side lighting, dark earthy tabletop, natural texture, center composition for a small card or wide crop. Premium warm charcoal and champagne visual style. No text or logos.
- [com.webp](public/com.webp) — Photorealistic editorial food photo of Vietnamese cơm tấm sườn with broken rice, Vietnamese grilled pork chop, fresh sliced cucumber, cherry tomato, small nước chấm bowl, dark handmade ceramic plate, warm natural side lighting, dark charcoal tabletop, refined restaurant photography. Horizontal, center composition. No text or logos.
