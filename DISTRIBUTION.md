# Redistribuer Tarkov Tracker

Tout ce qu'il faut pour préparer une version à partager, et les règles à respecter.

## 1. Vérifier qu'il n'y a rien à retirer

```
npm run audit
```

Le script parcourt les fichiers qui partiront avec l'app (jamais `node_modules`, `target` ni `.git`) et signale :

- des chemins absolus vers ton profil (`C:\Users\…`),
- des secrets (clés d'API, jetons, mots de passe, clés privées),
- des données personnelles du joueur (`progress.json`, `settings.json`, cache `data-v2-*.json`, logs, captures),
- des fichiers trop lourds ou de licence à surveiller.

Il sort en erreur s'il trouve quelque chose. Objectif : « Rien à signaler ».

Ces fichiers ne doivent **jamais** être livrés (ils vivent dans le dossier de données de l'utilisateur, pas dans le dépôt) :

| Fichier | Emplacement |
|---|---|
| `settings.json` | `%APPDATA%\dev.tarkovtracker.app\` |
| `progress-*.json` | `%APPDATA%\dev.tarkovtracker.app\` |
| `data-v2-*.json` (cache) | `%APPDATA%\dev.tarkovtracker.app\` |
| logs, captures d'écran | tes dossiers de jeu personnels |

## 2. Construire l'installateur

```
npm run build        # -> target/release/bundle/nsis/*.exe
```

Tauri produit un installateur NSIS (assistant, raccourcis, désinstallation). Il est **autonome** : l'interface est embarquée dans l'exécutable.
Le runtime **WebView2** est requis — présent par défaut sur Windows 11 et la plupart des Windows 10 ; l'installateur NSIS peut le prévoir.

## 2 bis. Mises à jour automatiques (hébergées sur GitHub)

L'app vérifie les mises à jour **au démarrage** et propose à l'utilisateur de les installer en un clic. Le serveur de mise à jour est une
**release GitHub** : gratuit, sans serveur à maintenir.

### Mise en place (une seule fois)

1. Crée un dépôt GitHub (public ou privé) et dépose-y le code.
2. Renseigne-le dans `tools/release.config.json` :
   ```json
   { "repo": "TON-COMPTE/tarkov-tracker", "notes": "" }
   ```
3. La clé de signature des mises à jour a déjà été générée dans `%USERPROFILE%\.tauri\tarkov-tracker.key`.
   **Sauvegarde-la et garde-la secrète.** Si tu la perds, les installations existantes ne pourront plus se mettre à jour
   (il faudra réinstaller à la main). Elle est **hors du dépôt** : ne la commite jamais.

### Publier une version

1. Incrémente `version` **dans les trois fichiers** (`package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`) et ajoute l'entrée correspondante dans `CHANGELOG.md`. La commande suivante refuse de continuer si les trois versions ne concordent pas.
2. Construis, signe et vérifie localement :
   ```
   npm run release
   ```
   Le script synchronise l'adresse du dépôt, construit l'installateur **signé**, **vérifie la signature contre le binaire et la clé publique**, fabrique l'archive portable et écrit `dist/latest.json` (notes issues du `CHANGELOG`).
3. Publie et vérifie la mise à jour en ligne :
   ```
   npm run publish
   ```
   Il crée (ou met à jour) la release GitHub, envoie **l'installateur, `latest.json` et l'archive portable** en une fois, puis **re-télécharge le manifeste et l'installateur depuis les URLs publiques** pour rejouer la vérification de signature, exactement comme le fera l'application. La commande échoue si le moindre contrôle ne passe pas.

   `npm run verify-release` refait ce contrôle à tout moment (sans rien publier).

   > Pourquoi c'est fiable : le nom des fichiers est normalisé (les espaces deviennent des points, sinon GitHub renvoie un 404) et l'envoi n'est déclaré terminé que lorsque la signature publiée correspond bien au binaire publié. Les apps installées voient la mise à jour au prochain démarrage.

   > Si tu perds la clé privée, les installations existantes ne pourront plus se mettre à jour : il faudra **réinstaller à la main une fois** pour repartir sur une nouvelle clé. Sauvegarde `%USERPROFILE%\.tauri\tarkov-tracker.key`.

> L'utilisateur reçoit le message de mise à jour, clique sur **Installer et redémarrer** : l'app se ferme, l'installateur se lance,
> puis la nouvelle version redémarre. En cas d'échec, un bouton **Télécharger à la main** ouvre la page des versions. La mise à jour
> automatique n'existe que pour la version **installée** (l'archive portable ne se met pas à jour).

### Faut-il craindre le quota GitHub ?

Non, pour ce type d'app c'est très large :

- **Téléchargements de releases** : pas de quota chiffré. GitHub limite seulement l'usage « excessif » (servir une release comme un CDN
  pour des dizaines de milliers de téléchargements quotidiens, ou héberger de gros médias). Une app de ~2,5 Mo téléchargée même
  10 000 fois représente ~25 Go : sans problème pour un projet normal.
- **Taille** : un dépôt doit rester < 1 Go (recommandé) et un fichier de release peut faire jusqu'à 2 Go. On est loin du compte.
- **GitHub Actions** (si tu automatises plus tard) : illimité pour un dépôt **public**, 2 000 min/mois en privé. La compilation
  Tauri prend ~3 min, donc même en privé tu as de la marge.
- **Attention** : ne mets pas `target/` ni `node_modules/` dans le dépôt. Les binaires vont uniquement en **release**.

### Licences

Les cartes sont **CC BY-NC-SA 4.0** : la distribution doit rester **gratuite et non commerciale**. Un dépôt/release GitHub public
convient parfaitement.

## 3. Repli : archive portable

Si tu préfères éviter l'installateur (ou si NSIS échoue) :

```
npm run build
npm run zip          # -> dist/TarkovTracker-<version>-portable.zip
```

L'archive contient l'exécutable, un `LISEZ-MOI.txt`, `README.md`, `CHANGELOG.md` et `CREDITS.md`. Aucune installation : on double-clique.

## 4. Licences — à respecter impérativement

| Élément | Licence | Ce que ça impose |
|---|---|---|
| Cartes et **étages** (`ui/maps/*.svg`) | **CC BY-NC-SA 4.0** | **Usage NON commercial**, attribution des auteurs, redistribution sous la même licence |
| Tuiles distantes (Lab, Icebreaker, Réserve 2e-5e) | idem (via `assets.tarkov.dev`) | idem |
| Calibration des cartes | MIT (the-hideout/tarkov-dev) | conserver la notice |
| Police Chakra Petch | SIL OFL 1.1 | conserver `ui/fonts/OFL.txt` |
| Leaflet | BSD-2-Clause | conserver `ui/vendor/LEAFLET-LICENSE.txt` |
| Données de jeu (json.tarkov.dev) | conditions de tarkov.dev | ne pas redistribuer le cache : l'app le télécharge à l'usage |

Conséquences concrètes :

- **Vente interdite** tant que les cartes SVG (CC BY-NC-SA) sont incluses. Pour un usage commercial, il faut d'autres cartes ou l'accord des auteurs.
- **Attribution obligatoire** : garde `CREDITS.md` dans le paquet.
- Le dépôt des cartes **interdit leur usage dans un logiciel de triche** (radar, ESP, bots). Cette app lit uniquement des fichiers écrits par le jeu (logs, captures) : garde-la ainsi.

## 5. Après publication

- Version : incrémente `version` dans `package.json`, `src-tauri/tauri.conf.json` et `src-tauri/Cargo.toml` (les trois sont lus).
- Signe l'exécutable si tu veux éviter les avertissements SmartScreen (certificat de signature de code).
- Ne mets pas le dossier `target/` ni `node_modules/` dans l'archive source.
