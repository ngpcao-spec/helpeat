# Catalogue HOME Reviews pour Helpeat

`public.helpeat_catalog()` renvoie le contrat v1 attendu par `public/catalog.mjs`. La RPC exige une session Google Supabase et lit une projection explicite. `search_restaurants_by_dish` conserve ses autorisations HOME Reviews. Le journal et les habitudes restent propres au compte connecté.

## Décisions de publication

Un opérateur habilité de HOME Reviews consigne les décisions dans les deux tables privées du projet partagé. Les comptes consommateurs peuvent lire la projection autorisée via la RPC. L’accès direct aux tables de publication et aux sources HOME Reviews reste soumis à leurs droits distincts.

- `private.helpeat_restaurant_publications` enregistre l’établissement autorisé, la date et la référence de l’accord. `venue_type` vaut `street_food` ou `restaurant` seulement après vérification explicite. Le prix par personne et la taille de groupe sont facultatifs et demandent une attestation. Les problèmes récurrents sont limités à des libellés génériques approuvés par HOME Reviews. Une cuisine vietnamienne et un nom de plat ne suffisent pas à déterminer la catégorie.
- `private.helpeat_dish_publications` enregistre l’identifiant stable du plat, son périmètre d’association HOME Reviews, les créneaux vérifiés, la date de vérification et la fin de disponibilité attestée. Un prix peut être saisi en VND s’il est vérifié. Pour déterminer le périmètre courant pendant la revue, utiliser `private.dish_scope(establishment_id)`. Mettre `approved` à vrai uniquement après confirmation. La lecture vérifie à nouveau que l’association est confirmée, activée et que la vérification couvre sa dernière modification.
- Le restaurant doit être actif et correspondre à sa fiche Google vérifiée par identifiants. La projection utilise le nom et la ville observés, et l’adresse et les coordonnées lorsqu’elles sont connues. `publish_score` autorise uniquement un score comparable et à jour. HOME Reviews utilise une échelle de 0 à 6, convertie sur 100 pour Helpeat. Les photos brutes, preuves de classification, scores obsolètes et détails d’analyse restent dans HOME Reviews.
- Pour retirer une publication, passer `published` ou `approved` à faux. La nouvelle lecture tient compte du retrait, de la date de disponibilité et des désactivations. La démo Helpeat utilise son catalogue fictif local.

## Ordre de déploiement partagé

Appliquer une seule fois la migration `20261125012927_helpeat_home_catalog.sql` au projet `ihuztjkblywzjdruusdj`, après les migrations HOME Reviews de classification, de fiches Google et de scores, et la migration du journal Helpeat. Le déploiement Pages consomme uniquement la RPC. Avant le prochain déploiement de schéma HOME Reviews, aligner son historique sur la version Supabase effectivement enregistrée et utiliser la même migration. La migration crée des tables de décisions vides et un point de lecture. Toute première publication exige une décision de HOME Reviews.

`npm test` couvre la projection et les parcours avec des données fictives. Le workflow Supabase jetable vérifie la lecture par deux sessions Auth indépendantes, le refus d’accès aux sources et le retrait immédiat.
