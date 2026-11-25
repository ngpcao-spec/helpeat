# Catalogue HOME Reviews pour Helpeat

`public.helpeat_catalog()` renvoie le contrat v1 attendu par `public/catalog.mjs`. La RPC exige une session Google Supabase et lit une projection explicite. `search_restaurants_by_dish` conserve ses autorisations HOME Reviews. Le journal et les habitudes restent propres au compte connecté.

## Décisions de publication

Un opérateur habilité de HOME Reviews consigne les décisions dans les deux tables privées du projet partagé. Les comptes consommateurs peuvent lire la projection autorisée via la RPC. L’accès direct aux tables de publication et aux sources HOME Reviews reste soumis à leurs droits distincts.

- `private.helpeat_restaurant_publications` enregistre l’établissement autorisé, la date et la référence de l’accord. `venue_type` vaut `street_food` ou `restaurant` seulement après vérification explicite. Le prix par personne et la taille de groupe sont facultatifs et demandent une attestation. Les problèmes récurrents sont limités à des libellés génériques approuvés par HOME Reviews. Une cuisine vietnamienne et un nom de plat ne suffisent pas à déterminer la catégorie.
- `private.helpeat_dish_publications` enregistre l’identifiant stable du plat, son périmètre d’association HOME Reviews et la date réelle de la dernière vérification. Le prix vérifié en VND et la fin de disponibilité attestée sont facultatifs. Une liste de créneaux vide signifie que les horaires de service restent à vérifier. Pour déterminer le périmètre courant pendant la revue, utiliser `private.dish_scope(establishment_id)`. La lecture exige que l’association soit confirmée, activée et que la vérification couvre sa dernière modification.
- Un établissement actif doit être classé `street_food` par l’opérateur et correspondre à sa fiche Google vérifiée par identifiants. Supabase et Helpeat appliquent tous deux le filtre de catégorie. Helpeat limite les résultats à la zone sélectionnée ou aux établissements à proximité de la position choisie.
- `publish_score` autorise uniquement un score comparable et à jour. HOME Reviews utilise une échelle de 0 à 6, convertie sur 100 pour Helpeat. Helpeat signale l’absence de score actualisé. Les photos brutes, preuves de classification, scores obsolètes et détails d’analyse restent dans HOME Reviews.
- Pour retirer une publication, passer `published` ou `approved` à faux. La lecture tient compte du retrait et des désactivations. La démo Helpeat utilise son catalogue fictif local.

## Fraîcheur et données facultatives

Une vérification reste valable pendant **90 jours**, à compter de l’heure enregistrée dans `verified_at`. Une date de fin commerciale attestée et plus proche raccourcit ce délai. À l’échéance, le plat disparaît au prochain chargement du catalogue jusqu’à une nouvelle vérification. Une date commerciale inconnue reste à `NULL`.

Un plat aux créneaux inconnus peut être suggéré à un repas. Helpeat signale l’absence d’horaires de service vérifiés sur sa fiche. Dans les sorties de groupe, un tarif inconnu s’affiche avec « Respect du budget à confirmer ». Une capacité inconnue s’affiche avec « Capacité d’accueil à confirmer ». Les adresses dont le prix vérifié dépasse le budget ou dont la capacité vérifiée est insuffisante sont écartées.

## Première publication

1. Vérifier l’établissement actif, la correspondance de ses identifiants avec la fiche Google, sa zone et l’association confirmée et activée. Vérifier que la fiche correspond au bon établissement lorsque plusieurs adresses portent le même nom.
2. Un opérateur habilité de HOME Reviews consigne l’accord explicite de diffusion dans Helpeat et la preuve que l’établissement est bien de type street food. Une spécialité régionale, une catégorie « restauration rapide » ou un nom de plat est insuffisant pour établir cette classification.
3. Dans une seule transaction, enregistrer la décision dans `private.helpeat_restaurant_publications` avec `published=true`, `venue_type='street_food'`, la date réelle de la décision et sa référence. Pour le plat, utiliser son UUID, le périmètre calculé avec `private.dish_scope(establishment_id)`, `approved=true`, l’heure réelle de vérification et la référence associée. Laisser les données facultatives inconnues à `NULL` et les créneaux inconnus vides. N’activer la publication du score que si sa diffusion est autorisée.
4. Avec un compte Google déjà admis au pilote Helpeat, sélectionner la zone et contrôler la présence du plat, l’adresse et les mentions d’information manquante. En cas d’erreur, retirer la fiche en passant `published` à faux, puis actualiser le catalogue.

## Ordre de déploiement partagé

La migration `20261125014237_helpeat_home_catalog.sql` est enregistrée dans le projet `ihuztjkblywzjdruusdj`. Son SQL correspond au fichier testé initialement sous le numéro `20261125012927`. Elle dépend des migrations HOME Reviews de classification, de fiches Google et de scores, ainsi que de la migration du journal Helpeat. Les deux dépôts utilisent le même numéro et le même SQL pour cette entrée. Intégrer la branche d’alignement HOME Reviews avant son prochain déploiement de schéma. [Historique partagé HOME Reviews](https://github.com/ngpcao-spec/home-reviews-demo/tree/codex/helpeat-home-catalog-history)

La migration `20261125051559_helpeat_street_food_catalog.sql` modifie uniquement la projection et les contraintes propres à Helpeat. Appliquer cette migration avant le frontend Pages pour que la RPC fournisse `verifiedAt`. Les tables de décisions ont été créées vides. À l’audit du 25 novembre 2026, une association pour Bánh căn est confirmée et active, 61 restent proposées et les 29 fiches de score sont obsolètes.

`npm test` couvre la projection et les parcours avec des données fictives. Le workflow Supabase jetable vérifie la lecture par deux sessions Auth indépendantes, le refus d’accès aux sources et le retrait immédiat.
