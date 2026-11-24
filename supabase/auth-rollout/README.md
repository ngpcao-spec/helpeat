# Validation avant ouverture du mode réel

Le projet de production est `ihuztjkblywzjdruusdj`. La création de nouveaux comptes Auth exécute actuellement `auth.on_auth_user_created`, qui appelle `private.handle_new_user()` puis `private.provision_home_user(new.id)`. La fonction crée un profil HOME Reviews, une organisation, son adhésion de propriétaire et des préférences de notification. Le même compte Google conserve le même identifiant `auth.users.id`.

Le frontend HOME Reviews charge actuellement les organisations directement. Il dépend du trigger lors du premier accès. L’origine du flux OAuth ne doit pas être déduite d’un champ de `user_metadata` modifiable par le compte.

## Correctif à déployer dans cet ordre

1. Reporter [le correctif de démarrage](home-reviews-onboarding.patch) sur HOME Reviews. Il a été préparé sur le commit `82db1a114ebcc5b4f76b72029e54b0af01b0c8c5`. Le frontend vérifie le profil à la première ouverture et appelle la fonction existante `ensure_home_user()` si nécessaire. Tester un nouveau compte HOME Reviews, un compte restaurateur existant et un PWA déjà installé avant de déployer le correctif.
2. Dans un environnement de test isolé, répéter les scénarios HOME Reviews avec [la correction du trigger](20261124082045_helpeat_auth_defer_home_review_provisioning.sql). Vérifier qu’une création depuis Helpeat ne produit aucune organisation et qu’une ouverture volontaire de HOME Reviews crée exactement une organisation pour un nouveau compte. Tester aussi la reconnexion, l’expiration de session et les droits d’un compte existant. Attribuer une nouvelle version de migration au moment de son application en production.
3. Après ces vérifications, ajouter `https://ngpcao-spec.github.io/helpeat/?mode=real` aux URL de redirection Auth. Conserver la liste HOME Reviews, son URL principale et le client Google existant. Tester le flux PKCE complet dans Safari et dans une PWA iOS installée. [Documentation Supabase sur les redirections](https://supabase.com/docs/guides/auth/redirect-urls)
4. Tester le journal avec deux comptes Google distincts sur l’instance retenue, y compris l’écriture avec un compte, la tentative de lecture depuis l’autre, ainsi que la réouverture du journal sur deux appareils avec le même compte.
5. Autoriser le build Pages réel après ces vérifications. Le build utilise `VITE_HELPEAT_ENABLE_REAL=true` et une clé `VITE_HELPEAT_SUPABASE_PUBLISHABLE_KEY` publique. La démo reste l’URL par défaut et une session Helpeat est distincte de celle utilisée par HOME Reviews.

## Historique partagé des migrations

[Le schéma Helpeat](../migrations/20261124082946_helpeat_journal_and_habits.sql) est déjà enregistré en production sous `20261124082946` et `helpeat_journal_and_habits`. Référencer ce même fichier et cette version dans le dépôt HOME Reviews avant son prochain déploiement de migrations. Cette opération aligne l’historique Git avec le projet partagé. Elle ne requiert pas de rejouer les anciennes migrations. Garder la correction Auth ci-dessus hors du chemin de déploiement automatique tant que les essais de non-régression sont incomplets.

La [branche de coordination HOME Reviews](https://github.com/ngpcao-spec/home-reviews-demo/tree/codex/helpeat-journal-history) contient uniquement le fichier de la migration déjà appliquée. Intégrer cette branche à l’historique HOME Reviews avant le prochain déploiement de son schéma.
