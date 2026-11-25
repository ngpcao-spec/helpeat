# Catalogue HOME Reviews pour Helpeat

`public.helpeat_catalog()` renvoie le contrat v1 attendu par `public/catalog.mjs`. La RPC exige une session Google Supabase et lit une projection explicite. `search_restaurants_by_dish` conserve ses autorisations HOME Reviews. Le journal et les habitudes restent propres au compte connecté.

## Décisions de publication

Un opérateur habilité de HOME Reviews consigne les décisions dans les deux tables privées du projet partagé. Les comptes consommateurs peuvent lire la projection autorisée via la RPC. L’accès direct aux tables de publication et aux sources HOME Reviews reste soumis à leurs droits distincts.

- `private.helpeat_restaurant_publications` enregistre l’établissement autorisé, la date et la référence de l’accord. `venue_type` vaut `street_food` ou `restaurant` seulement après vérification explicite. Le prix par personne et la taille de groupe sont facultatifs et demandent une attestation. Les problèmes récurrents sont limités à des libellés génériques approuvés par HOME Reviews. Une cuisine vietnamienne et un nom de plat ne suffisent pas à déterminer la catégorie.
- `private.helpeat_dish_publications` enregistre l’identifiant stable du plat, son périmètre d’association HOME Reviews, les créneaux vérifiés, la date de vérification et la fin de disponibilité attestée. Un prix peut être saisi en VND s’il est vérifié. Pour déterminer le périmètre courant pendant la revue, utiliser `private.dish_scope(establishment_id)`. Mettre `approved` à vrai uniquement après confirmation. La lecture vérifie à nouveau que l’association est confirmée, activée et que la vérification couvre sa dernière modification.
- Le restaurant doit être actif et correspondre à sa fiche Google vérifiée par identifiants. La projection utilise le nom et la ville observés, et l’adresse et les coordonnées lorsqu’elles sont connues. `publish_score` autorise uniquement un score comparable et à jour. HOME Reviews utilise une échelle de 0 à 6, convertie sur 100 pour Helpeat. Les photos brutes, preuves de classification, scores obsolètes et détails d’analyse restent dans HOME Reviews.
- Pour retirer une publication, passer `published` ou `approved` à faux. La nouvelle lecture tient compte du retrait, de la date de disponibilité et des désactivations. La démo Helpeat utilise son catalogue fictif local.

## Ordre de déploiement partagé

La migration `20261125014237_helpeat_home_catalog.sql` est enregistrée dans le projet `ihuztjkblywzjdruusdj`. Son SQL correspond au fichier testé initialement sous le numéro `20261125012927`. Elle dépend des migrations HOME Reviews de classification, de fiches Google et de scores, ainsi que de la migration du journal Helpeat. Les deux dépôts utilisent le même numéro et le même SQL pour cette entrée. Intégrer la branche d’alignement HOME Reviews avant son prochain déploiement de schéma. [Historique partagé HOME Reviews](https://github.com/ngpcao-spec/home-reviews-demo/tree/codex/helpeat-home-catalog-history)

Le déploiement Pages consomme la RPC. Les tables de décisions ont été créées vides. À l’audit du 25 novembre 2026, une association pour Bánh căn est confirmée et active, 61 restent proposées et les 29 fiches de score sont obsolètes. La première publication exige l’accord de HOME Reviews et une disponibilité attestée.

`npm test` couvre la projection et les parcours avec des données fictives. Le workflow Supabase jetable vérifie la lecture par deux sessions Auth indépendantes, le refus d’accès aux sources et le retrait immédiat.
