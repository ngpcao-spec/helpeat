# Validation de Google Connect et du journal HELPEAT

La [démo publique](https://ngpcao-spec.github.io/helpeat/) reste accessible. Le test avec Google utilise une adresse séparée sous la forme `https://<origine-privée>/helpeat/?mode=real`. Il exige un Supabase d’essai et un client Google OAuth d’essai configurés. Une URL contenant les chevrons indique le format attendu.

## Préparer l’environnement

Utiliser un Supabase isolé avec le schéma HOME Reviews et les tables HELPEAT, peuplé uniquement de données d’essai. Désactiver les traitements planifiés et les appels externes. Choisir deux comptes Google d’essai, **A** et **B**. Réserver B pour sa première ouverture de HELPEAT.

1. Dans le client Web Google OAuth d’essai, autoriser `https://<référence-test>.supabase.co/auth/v1/callback`. Si l’écran de consentement Google est en mode test, ajouter A et B aux utilisateurs autorisés. Configurer le fournisseur Google dans le Supabase d’essai. Stocker le secret OAuth dans Supabase. [Configuration officielle Google et Supabase](https://supabase.com/docs/guides/auth/social-login/auth-google)
2. Dans la configuration Auth du Supabase d’essai, autoriser l’URL privée de HOME Reviews et `https://<origine-privée>/helpeat/?mode=real`. Utiliser les URL exactes qui seront ouvertes sur les appareils. [Redirections Supabase](https://supabase.com/docs/guides/auth/redirect-urls)
3. Appliquer le [déroulement progressif](README.md) d’abord sur la base isolée. Commencer avec le trigger actif et le nouveau provisionnement HOME Reviews. Une fois le parcours HOME Reviews vérifié, tester la bascule du trigger sur cette même base. La production garde sa configuration actuelle.

### Démarrer l’aperçu privé

Prévoir une origine HTTPS contrôlée qui transmet les requêtes vers `127.0.0.1:4183` via un proxy ou un tunnel exécuté sur le même hôte. Le serveur Vite demande une authentification HTTP pour toutes les ressources, dont celles de la PWA. Configurer les variables dans la même session PowerShell que le build et le serveur.

~~~powershell
$env:HELPEAT_GOOGLE_TEST = 'true'
$env:VITE_HELPEAT_ENABLE_REAL = 'false'
$env:HELPEAT_GOOGLE_TEST_ORIGIN = 'https://<origine-privée>'
$env:HELPEAT_GOOGLE_TEST_SUPABASE_URL = 'https://<référence-test>.supabase.co'
$env:HELPEAT_GOOGLE_TEST_PUBLISHABLE_KEY = '<clé-publiable-supabase-test>'
$env:HELPEAT_GOOGLE_TEST_PASSWORD = Read-Host 'Mot de passe privé (20 caractères minimum)' -MaskInput
npm.cmd run build
npm.cmd run preview
~~~

Communiquer l’URL HTTPS complète et le mot de passe d’aperçu séparément. L’identifiant de cet aperçu est `helpeat`. Le build refuse le Supabase de production, le domaine public GitHub Pages et les clés secrètes Supabase. La partie réelle reste liée à l’origine privée déclarée. L’icône installée s’appelle **HELPEAT Test**.

## Manipulations exactes sur iPhone

### 1. Vérifier HOME Reviews avant la bascule du trigger

1. Dans Safari, ouvrir l’URL privée de **HOME Reviews d’essai**. Appuyer sur **Continuer avec Google**, puis choisir **A**. Vérifier que l’accueil et l’onglet **Plus** s’ouvrent.
2. Sur **Plus → Se déconnecter**, fermer la session. Reconnecter **A**. Vérifier que la même organisation est retrouvée. Dans le Supabase d’essai, relever son identifiant et confirmer qu’une seule organisation a été créée.
3. Après ces contrôles, faire appliquer la correction du trigger à l’environnement isolé. Reprendre le premier accès dans sa version HOME Reviews à jour et contrôler que le parcours reste utilisable.

### 2. Vérifier Safari et la conservation sur l’iPad

1. Sur l’iPhone, ouvrir l’URL privée de **HELPEAT** dans Safari. Saisir l’identifiant `helpeat` et le mot de passe d’aperçu si Safari les demande. Appuyer sur **Continuer avec Google** et choisir **A**.
2. Dans **Mes repas** (*Bữa ăn của tôi*), appuyer sur **Ajouter un repas**. Pour aujourd’hui, choisir un créneau libre. Saisir **Phở test A**, appuyer sur **Ajouter un plat**, saisir **Riz test A**, puis appuyer sur **Enregistrer**.
3. Dans **Mon compte → Se déconnecter**, fermer la session de l’iPhone. Ouvrir la même URL privée dans **Safari sur l’iPad**, choisir le même compte **A** et ouvrir **Mes repas**. Vérifier la date, le créneau et les deux plats. Modifier **Riz test A** en **Riz test A modifié**.

### 3. Vérifier la PWA installée, l’isolation et la suppression

1. Sur l’iPhone, ouvrir l’URL privée HELPEAT dans Safari. Appuyer sur **Partager**, faire défiler jusqu’à **Sur l’écran d’accueil**, activer **Ouvrir comme app web** si l’option apparaît, puis appuyer sur **Ajouter**. Ouvrir **HELPEAT Test** depuis son icône. Saisir les identifiants d’aperçu si l’app les redemande. [Guide Apple pour iPhone](https://support.apple.com/fr-fr/guide/iphone/iph42ab2f3a7/ios)
2. Choisir **A** si l’écran de connexion s’affiche. Vérifier le plat modifié. Fermer complètement **HELPEAT Test**, puis rouvrir l’icône. Vérifier que le journal et la session sont retrouvés. Si le retour Google affiche un message de reprise, relever le message et la version d’iOS, puis réessayer dans la même fenêtre.
3. Dans **Mon compte**, se déconnecter de **A**. Revenir à **Continuer avec Google** et choisir **B**. Ouvrir **Mes repas**. Le repas de A doit être absent. Avant d’ouvrir HOME Reviews avec B, vérifier côté Supabase d’essai que B n’a aucune organisation ni adhésion HOME Reviews. Pour contrôler ensuite l’inscription restaurateur après la bascule, ouvrir HOME Reviews d’essai avec B et vérifier la création d’une seule organisation.
4. Reconnecter **A** dans HELPEAT. Dans son repas d’essai, appuyer sur **Supprimer le repas** et confirmer. Sur l’iPad, revenir dans **Mes repas** avec A et vérifier que l’entrée a disparu.

Relever **réussi**, **échoué** ou **non testé** pour Safari iPhone, Safari iPad, reprise de la PWA, compte A sur deux appareils, isolation de B et organisation HOME Reviews. L’absence de partage de données entre A et B doit être complétée par les tests d’accès de l’environnement isolé. Aucun jeton, cookie, code OAuth ou mot de passe n’a besoin de figurer dans le compte rendu.
