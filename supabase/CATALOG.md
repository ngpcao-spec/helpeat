# Catalogue HOME Reviews pour Helpeat

`public.helpeat_catalog()` fournit le catalogue au format V1 après authentification Google dans Supabase. Le serveur lit le résultat déjà publié par HOME Reviews via `private.menu_dish_ai_targets.published_id` et `private.menu_dish_ai_runs`. Les associations actives et la spécialité proviennent de `private.restaurant_dishes` et `private.restaurant_dish_profiles`. Dès qu’une classification publiée indique `street_food` et que des plats y sont actifs, ils sont disponibles dans Helpeat au prochain chargement du catalogue.

Lorsque HOME Reviews traite un nouveau menu, Helpeat continue de lire le dernier résultat publié. Les changements de type et les désactivations se reflètent à la lecture suivante. Les anciennes tables de décisions Helpeat restent en base pour l’historique. La lecture courante dépend uniquement des données HOME Reviews.

## Informations affichées

- Nom, photo HTTPS du lieu et lien Google Maps à partir de l’établissement HOME Reviews. La fiche Google liée fournit la zone, l’adresse, les coordonnées et les horaires habituels lorsqu’ils sont disponibles. L’horaire habituel est informatif et le moteur de suggestion conserve son filtre géographique.
- Les prix numériques avec devise VND explicite viennent des lignes associées au dernier menu publié. Lorsque plusieurs montants existent pour un même plat, Helpeat affiche leur fourchette. Un prix de plat ne sert pas de budget par personne.
- Le score global actuel est affiché avec sa valeur HOME Reviews sur 6. Helpeat signale l’absence de score actualisé. Les champs de prix, d’horaires et de capacité sont facultatifs.

La RPC renvoie les champs d’affichage uniquement. Les invitations, comptes, menus bruts, avis individuels, réponses IA et données de traitement restent dans leurs tables d’origine. Les politiques du journal et la recherche interne HOME Reviews restent distinctes du catalogue.

## Déploiement partagé

La migration `20261127004214_helpeat_live_home_catalog.sql` remplace la lecture du catalogue Helpeat après les migrations HOME Reviews de classification et les migrations Helpeat `20261125014237` et `20261125051559`. Appliquer d’abord cette migration dans le projet `ihuztjkblywzjdruusdj`, puis publier le frontend Pages. La branche d’alignement HOME Reviews contient les mêmes versions des migrations Helpeat pour les prochains déploiements de schéma. [Historique partagé HOME Reviews](https://github.com/ngpcao-spec/home-reviews-demo/tree/codex/helpeat-home-catalog-history)

`npm test` vérifie les associations actives, les mises à jour depuis HOME Reviews, les champs facultatifs et la projection. Le workflow Supabase isolé contrôle la lecture par deux sessions Auth et l’isolation des données.
