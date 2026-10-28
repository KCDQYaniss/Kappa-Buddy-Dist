# Kappa Buddy

Compagnon pour Escape from Tarkov : position en direct sur la carte, suivi de quêtes synchronisé avec les logs du jeu,
et base de données des objets, conteneurs et loot au sol. Conçu pour peser le moins possible à côté de Tarkov.

> **Mises à jour automatiques** intégrées, interface entièrement traduite (fr/en/de/es/ru), visite guidée au premier
> lancement, overlay prix au survol et recherche globale (`Ctrl+F`). Historique complet : [CHANGELOG.md](CHANGELOG.md).

## Fonctions

**Quêtes : suivi dynamique et complet**
- **En direct** : dès que tu démarres, termines ou rates une quête en jeu, l'app le voit (via `notifications_000.log`), met la quête à jour,
  coche ses objectifs et te prévient (« Quête terminée : … »).
- **Rattrapage** : à chaque lancement (et avec le bouton *Resynchroniser*), l'app relit tous les logs que le jeu a gardés et remet tes
  quêtes là où tu en es, même si tu n'as pas ouvert l'app depuis longtemps. Les évènements sont rejoués dans l'ordre chronologique.
- **Déduction** : une quête commencée ou terminée implique que ses prérequis sont terminés. Si le jeu n'a gardé aucun log ancien, tout
  l'arbre en amont est déduit automatiquement (marqué « déduite »). Un vrai évènement de log remplace toujours une déduction.
- **Tes réglages manuels sont protégés** : un évènement de log plus ancien que ton dernier réglage ne le défait jamais.
- Tableau de bord (progression, Kappa, à faire maintenant, prochaines quêtes, activité récente), onglets par marchand, puces de statut avec
  compteurs, filtres (map, Kappa, recherche), **niveau** (les quêtes trop avancées passent en « verrouillées », avec la raison affichée).
- Objectifs cochables ; « Voir sur la carte » isole une quête sur sa carte.

**Carte**
- Position et orientation du joueur à chaque capture d'écran (seul le nom du fichier est lu).
- **Suivi du joueur** (touche F) : activé, la carte se recentre sur toi à chaque capture ; désactivé, elle ne bouge jamais toute seule.
  « Centrer sur moi » marche dans les deux cas. Le choix est mémorisé.
- Détection automatique de la map via les logs (launcher BSG ou Steam). La pastille à côté de la liste dit où on en est et se clique pour corriger.
- Calques : extractions, transits, apparitions, conteneurs (filtrables par type), loot au sol, armes fixes, objectifs de tes quêtes en cours.
- **Quêtes de la map** : une entrée par quête, ses objectifs en simple liste dessous. Décoche une quête pour la masquer sur la carte (tu ne fais pas tout
  dans la même partie) ; « Toutes / Aucune » pour tout afficher ou masquer ; la flèche replie la liste ; cliquer sur le nom zoome sur ses objectifs ;
  le ✓ qui apparaît au survol d'un objectif le marque comme fait. Ces choix sont mémorisés.
- **Étages** : les cartes à plusieurs niveaux (Customs, Interchange, Réserve, Factory, Streets, Ground Zero, Shoreline, Lab, Icebreaker…) affichent un
  sélecteur d'étage. En mode **Auto**, l'app choisit le niveau d'après la hauteur du joueur : tu descends, tu vois l'étage où tu es. Tu peux toujours
  forcer un étage à la main ; le mode Auto reste un clic à côté.
- **Extractions** : clique sur une sortie pour voir à qui elle est ouverte (PMC / Scav / tous), l'interrupteur éventuel et comment sortir.
- Recherche d'un objet : met en évidence tous ses emplacements de loot au sol. Boss et probabilités.

**Objets**
- Tous les objets (liste fluide même avec des milliers de lignes), recherche, catégorie, tri par prix.
- **Liste de courses** : « Utiles à mes quêtes en cours » indique combien en trouver (× 3 FIR), en comptant « trouver puis remettre » une seule fois.
  « Utiles au hideout » filtre les objets demandés par les améliorations du hideout.
- Quêtes qui utilisent l'objet, **stations et niveaux du hideout** qui le demandent, cartes où il apparaît au sol.

**Overlay objet (au survol et à la recherche)**
- Passe la souris sur un objet dans la liste : une fiche compacte suit le curseur avec le **prix flea**, le **meilleur marchand** chez qui le revendre
  et, si l'objet sert à une quête en cours, la quantité à trouver.
- `Ctrl+F` ouvre une **recherche globale** (objets, quêtes, cartes) : tape un nom, clique un objet et tu vois sa fiche complète —
  prix, marchand, hideout, quêtes, où le trouver. C'est l'overlay à garder au-dessus du jeu.

**Confort**
- Barre de navigation en bas, comme dans le jeu, avec badges : vert = quêtes en cours, gris = objets à trouver.
- **Mode de jeu** : badge cliquable dans la barre du bas pour passer PvP / PvE / Saison. Chaque mode a sa propre progression de quêtes.
- **Toujours au premier plan** : bouton d'épingle dans la barre du bas (toujours visible) pour coller la fenêtre au-dessus du jeu.
- **Démarrage automatique** avec Windows, **réduction dans la zone de notification** (l'icône reste accessible : menu *Afficher / Quitter*) et
  option **démarrer réduit**. Réglable dans Réglages.
- Raccourcis : `1` `2` `3` changent d'onglet, `F` active/désactive le suivi, `/` place le curseur dans la recherche, `Ctrl+F` ouvre l'overlay, `Échap` le ferme.
- Notifications vertes (information) et orange (attention). Réglages et diagnostic en un clic (roue dentée).

## Lancer

Pour compiler ou contribuer. Pour installer l'application, télécharge l'installateur (voir [DISTRIBUTION.md](DISTRIBUTION.md)).

Prérequis (Windows 10/11) : [Rust](https://rustup.rs) >= 1.90, [Node.js](https://nodejs.org),
WebView2 (déjà présent sur Windows 11 et la plupart des Windows 10), Visual Studio Build Tools (charge « C++ »).

```
npm install
npm run dev        # lancer en développement
npm run build      # installeur Windows (NSIS) dans target/release/bundle/nsis
npm test           # tests Rust + calibration + cartes/étages + interface + synchro des quêtes
npm run maps       # re-télécharge les cartes, leurs étages et la calibration (Python 3 requis)
npm run audit      # vérifie qu'il n'y a rien de personnel ou de confidentiel avant de partager
npm run zip        # archive portable (repli sans installateur) dans dist/
npm run release    # construit l'installateur signé + dist/latest.json (mises à jour GitHub)
```

Pour préparer une version à distribuer, voir **[DISTRIBUTION.md](DISTRIBUTION.md)** (build, audit, licences à respecter).

## Si quelque chose ne marche pas : le diagnostic

**Réglages (roue dentée) > Diagnostic (débogage) > Analyser.** Il vérifie tes dossiers, tes logs et tes captures, puis affiche **tout ce qui ne va
pas**, classé par gravité : *Bloquant* (ce qui empêche la détection), *À vérifier* (ce qui peut gêner) et *OK*. Chaque point explique ce qui a été
observé et **quoi faire**. Le diagnostic s'ouvre et se lance même tout seul quand un problème est déjà connu (par exemple : logs introuvables).

Si tu as besoin d'aide, clique sur **Copier le rapport** et joins-le à ta demande : il contient le détail (identifiants du jeu masqués automatiquement).

Causes les plus courantes quand les quêtes ne se synchronisent pas : le dossier des logs n'est pas le bon, aucune partie n'a été lancée depuis
l'ouverture de l'app, ou aucune quête n'a été démarrée/terminée dans la dernière session. Le diagnostic le dit précisément.

Limites connues : le jeu ne garde qu'un nombre limité de sessions de logs, donc l'historique est partiel pour un compte ancien (la déduction des
prérequis comble le reste). Les logs ne distinguent pas toujours un profil PvP d'un profil PvE : si tu joues les deux, les quêtes des deux se mélangent.
La progression *à l'intérieur* d'une quête (« 3 / 7 éliminés ») n'est pas dans les logs : elle se coche à la main.

## Si la map ne se détecte pas

Même diagnostic (**Réglages > Diagnostic (débogage) > Analyser**). Causes les plus courantes :
- **Dossier des logs introuvable** : colle-le dans Réglages. Avec Steam c'est en général `…\steamapps\common\Escape from Tarkov\build\Logs`.
  L'app cherche aussi via le registre, les bibliothèques Steam et les emplacements habituels du launcher (`Logs` et `build\Logs`).
- **Aucune ligne de map dans le log** : elle apparaît au chargement d'un raid. Lance une partie puis relance le diagnostic.
- **Map inconnue** : le diagnostic affiche son identifiant : signale-le avec ton rapport.

Les logs sont surveillés par les notifications de Windows **et** relus toutes les 1,5 s (deux appels système par fichier, aucune lecture tant que
la taille n'a pas changé) : Windows ne prévient pas toujours quand le jeu ajoute des lignes à un fichier qu'il garde ouvert.

## D'où viennent les données

Les quêtes, objets, cartes, extractions, conteneurs, loot au sol et **stations du hideout** viennent de **json.tarkov.dev**, les fichiers JSON qui
alimentent le site tarkov.dev. L'ancienne API GraphQL (api.tarkov.dev) est hors service et n'est plus utilisée. Les fichiers sont gros
(cartes ~9,5 Mo, objets ~17 Mo) : l'app les lit en flux, les réduit à ce dont elle a besoin et ne garde que ce résumé sur le disque. Les textes sont
des clés de traduction, résolues avec les fichiers `_fr` (ou `_en` si la langue manque).

Les **visuels de cartes et leurs étages** viennent de **the-hideout/tarkov-dev** (calibration, liste des niveaux et plages de hauteur) et
**the-hideout/tarkov-dev-svg-maps** (dessins SVG). `tools/prepare_maps.py` découpe un SVG par étage (`ui/maps/<carte>-fN.svg`) et écrit `ui/maps.json`
avec la liste des niveaux. Certaines cartes (Lab, Icebreaker, Réserve 2e-5e) n'existent qu'en tuiles distantes : elles se chargent depuis
`assets.tarkov.dev`.

Au premier lancement le téléchargement prend quelques secondes à quelques dizaines de secondes. Ensuite l'app fonctionne hors-ligne et se
rafraîchit au plus une fois par jour, ou à la demande (icône de rafraîchissement en bas à droite). Si le téléchargement échoue, l'app affiche l'erreur
exacte, réessaie après 5, 10, 20 puis 30 minutes, et garde les anciennes données de la partie en échec. Le diagnostic affiche des statistiques sur les
données (quêtes avec marchand, conteneurs nommés, catégories d'objets…) pour repérer un champ mal lu.

## À vérifier à la première utilisation

Le code est testé (Rust, interface, synchro) et ces points sont surveillés à chaque version. Si un champ semble mal lu, le diagnostic montre quoi vérifier.

1. **Structure des fichiers json.tarkov.dev** : déduite de projets qui les lisent pour de vrai, avec une conversion tolérante (champ absent ou
   inattendu = ignoré). Surveille dans le diagnostic : les **conteneurs nommés** (sinon « Conteneur 5789… », mais filtrables), les **catégories
   d'objets** et les **quêtes avec marchand**. S'il y a un 0 suspect, copie le rapport du diagnostic pour ta demande d'aide.
2. **Format de `notifications_000.log`** : type 10/11/12 et identifiant de quête au début de `templateId`, d'après TarkovMonitor.
3. **Identifiants de map** marqués `(?)` dans `crates/core/src/maps.rs` (Labyrinth, Terminal, Icebreaker).
4. **Étages** : les niveaux et les plages de hauteur viennent de tarkov.dev. La hauteur est approximative (des niveaux se chevauchent) : le mode Auto
   devine le bon étage la plupart du temps, et le sélecteur manuel permet de corriger en un clic. Suppose aussi que les visuels d'étage tombent au même
   endroit que la carte de base (même calibration).
5. **Hideout** : conversion déduite du fichier `hideout` de json.tarkov.dev (stations, niveaux, objets requis).

## Architecture

```
crates/core/   Rust pur, sans Tauri : captures, logs (map + quêtes), conversion des données (dont hideout), diagnostic (testé)
src-tauri/     Coque Tauri : relaie les évènements, télécharge et met en cache les données, relit les logs, zone de notification,
               démarrage auto (registre Windows), fenêtre au premier plan, progression par mode de jeu
ui/            HTML/JS sans bundler ni framework, Leaflet embarqué
  store.js     données, progression des quêtes (par mode), synchro, déduction, hideout, recherche
  mapview.js   carte, suivi, calques, étages      quests.js  onglet quêtes      items.js  onglet objets (liste virtualisée)
  app.js       navigation, réglages, overlay (Ctrl+F), épinglage, mode de jeu
  demo/        jeu de données fictif pour prévisualiser l'interface dans un navigateur
tools/         préparation des cartes et de leurs étages
tests/         calibration, cartes/étages, interface, panne du serveur, synchro des quêtes (jsdom, faux Tauri)
```

Aucun polling pour les captures : le watcher s'appuie sur les notifications du système de fichiers. L'interface ne redessine que lorsqu'un
évènement arrive ; les calques lourds (loot au sol, conteneurs) ne sont construits que lorsque tu les actives.

## Style

L'interface reprend le langage visuel des menus du jeu, avec les couleurs relevées sur des captures : fond vert-noir, texte crème `#eae8d9`, barre de
navigation noire en bas, onglet actif crème, badge vert lime, bandeau orange pour les alertes. Aucun asset de Battlestate Games n'est utilisé. La
police du jeu (Bender) est propriétaire : l'app embarque **Chakra Petch** (SIL OFL), la plus proche parmi les polices libres. Tout est dans
`ui/style.css` (variables de couleur en tête de fichier).

## Mentions

Kappa Buddy est un outil communautaire non officiel : il n'est ni affilié à, ni approuvé par, ni sponsorisé par Battlestate Games.
Escape from Tarkov est une marque de Battlestate Games. Licences des données, des cartes et des polices : [CREDITS.md](CREDITS.md).
