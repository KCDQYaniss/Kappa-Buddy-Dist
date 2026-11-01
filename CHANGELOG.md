# Changelog / Journal des modifications

## 1.0.1 — Détection des étages réparée (hauteur + zone au sol)

### FR
- **La détection automatique d'étage fonctionne de nouveau** : l'app compare désormais la hauteur du joueur **et** sa position au sol avec les zones de chaque étage (données `extents` de tarkov.dev, comme le site de référence). Avant, les plages de hauteur de bâtiments différents étaient fusionnées : sur Customs, dès y ≥ 5,7 m l'app affichait le 3e étage où que tu sois ; sur Réserve, le sol était pris pour le 4e étage ; sur Ground Zero, l'extérieur pour le Garage.
- Concrètement : en plein air, même à une hauteur « d'étage », la carte reste au rez-de-chaussée ; dans les dortoirs de Customs, y=4 affiche le 2e étage et y=10 le 3e ; les sous-sols ne s'affichent que dans leurs zones (bunkers, garages, tunnels).
- Le fond « vue tactique » filtre ses points avec la même règle (plus de points d'un autre bâtiment dessinés sur l'étage courant).
- Données de cartes régénérées avec les zones par étage (42 étages concernés : Customs, Réserve, Ground Zero, Interchange, Labs, Streets, Shoreline, Factory, Icebreaker).

### EN
- **Automatic floor detection is fixed**: the app now matches the player's height **and** ground position against each floor's areas (tarkov.dev `extents` data, same as the reference site). Previously, height ranges of different buildings were merged: on Customs, any y ≥ 5.7 m showed the 3rd floor wherever you were; on Reserve, ground level read as the 4th floor; on Ground Zero, outdoors read as the Garage.
- In practice: outdoors, even at a “floor” height, the map stays on ground level; in the Customs dorms, y=4 shows the 2nd floor and y=10 the 3rd; basements only show inside their own areas (bunkers, garages, tunnels).
- The “tactical view” background filters its points with the same rule (no more points from another building drawn on the current floor).
- Map data regenerated with per-floor areas (42 floors affected: Customs, Reserve, Ground Zero, Interchange, Labs, Streets, Shoreline, Factory, Icebreaker).

## 1.0.0 — Kappa Buddy : première version stable, gratuite et entièrement traduite

### FR
- **L'app est et reste gratuite** : distribution via GitHub (installateur signé + mises à jour automatiques intégrées). Aucune licence, aucun compte, aucune collecte de données.
- **Interface entièrement traduite, messages techniques compris** : diagnostics, avertissements, erreurs de téléchargement, raccourcis clavier, OCR et erreurs de l'overlay arrivent désormais traduits dans ta langue (fr/en/de/es/ru). Le backend envoie des codes stables, l'interface traduit — un message inconnu s'affiche tel quel au lieu de casser.
- **La carte prix (overlay) suit la langue de l'app** : français, anglais ou russe (de/es retombent sur l'anglais). Ses messages d'erreur aussi.
- **Rebrand complet « Kappa Buddy »** : nom, fenêtres, installateur, archive portable, page de versions.
- Fiabilité : l'entrée « Afficher » du menu de la zone de notification fonctionne de nouveau (elle était écrasée par un second gestionnaire) ; sortie console de l'OCR en UTF-8 (accents corrects) ; le filtre « Ignorer FIR » du hideout est réellement appliqué ; sections par défaut de l'overlay corrigées ; libellés des icônes de points personnalisés traduits ; a11y (aria-labels) traduite.
- Nettoyage : scripts de dev retirés du dépôt, audit anti-fuite renforcé (secrets, chemins personnels, caches), documentation à jour (README, DISTRIBUTION, CREDITS).

### EN
- **The app is and stays free**: distributed via GitHub (signed installer with built-in automatic updates). No license, no account, no data collection.
- **Fully translated UI, technical messages included**: diagnostics, warnings, download errors, hotkeys, OCR and overlay errors now arrive translated in your language (fr/en/de/es/ru). The backend sends stable codes, the UI translates — an unknown message falls back to raw text instead of breaking.
- **The price overlay follows the app language**: French, English or Russian (de/es fall back to English). Its error messages too.
- **Complete “Kappa Buddy” rebrand**: name, windows, installer, portable archive, releases page.
- Reliability: the tray menu “Show” entry works again (it was overridden by a second handler); OCR console output in UTF-8 (proper accents); the hideout “Ignore FIR” filter is now actually applied; overlay default sections fixed; custom-point icon labels translated; aria-labels translated.
- Cleanup: dev scripts removed from the repo, hardened leak audit (secrets, personal paths, caches), documentation up to date (README, DISTRIBUTION, CREDITS).

## 0.9.19 — Transition d'infrastructure : dépôt de distribution

### FR
- **Les mises à jour passent par le dépôt public** `Kappa-Buddy-Dist` : même installateur, même signature minisign, même contenu. Ce dépôt héberge désormais le code source **et** les releases.
- Aucune autre modification de l'application : c'est la release de consolidation avant la 1.0.0 (rebrand « Kappa Buddy »). L'app reste distribuée gratuitement.

### EN
- **Updates now flow through the public repo** `Kappa-Buddy-Dist`: same installer, same minisign signature, same content. This repo now hosts both the source code and the releases.
- No other application change: this is a consolidation release ahead of 1.0.0 (rebrand to “Kappa Buddy”). The app remains free to distribute.

## 0.9.18 — Carte à l'image de l'app + fin de la « double fenêtre »

### FR
- **Une seule instance de l'app** : le plugin single-instance figurait dans les dépendances mais n'était **jamais enregistré** — un second lancement (double-clic pendant l'auto-démarrage, installé + portable, relance de l'updater) laissait deux apps tourner, chacune avec sa fenêtre overlay : la « double fenêtre » vue parfois en jeu. Désormais le second lancement met la première instance au premier plan et s'arrête.
- **Résidus visuels réparés** : après un rétrécissement de la carte, une fenêtre transparente peut garder à l'écran les pixels de la frame précédente (les zones devenues transparentes ne sont pas repeintes par WebView2) — l'ancienne carte restait visible en fantôme. Un repaint complet du HWND est forcé après chaque resize.
- **La carte porte le thème de l'app** : palettes identiques aux trois thèmes (Sombre Tarkov, Clair, Cyberpunk), police Chakra Petch (+ Orbitron pour le nom d'objet en Cyberpunk), liseré et accents issus des mêmes variables CSS. Le changement de thème dans l'app passe immédiatement sur la carte (événement storage) ; hors des réglages d'opacité/taille déjà existants, plus aucune couleur codée en dur.
- **Nettoyage stylistique du crate `core`** : réagencement de code sans changement fonctionnel — aucun identifiant, aucun littéral ni valeur modifié (vérifié par comparaison lexicale mot à mot), suite de tests complète au vert après ce passage.
- Tests : chaîne complète au vert (48 tarkov-core + 6 suites e2e + 9 Rust).

### EN
- **Single app instance**: the single-instance plugin was listed in dependencies but **never registered** — launching the app twice (double-click during autostart, installed + portable, updater relaunch) left two apps running, each with its own overlay window: the occasional “double window”. The second launch now focuses the first instance and exits.
- **Stale-frame fix**: after the card shrinks, a transparent window can keep previous-frame pixels on screen (WebView2 does not repaint now-transparent areas) — the old card lingered like a ghost. A full HWND repaint is forced after every resize.
- **The card follows the app theme**: palettes identical to the three themes (Tarkov Dark, Light, Cyberpunk), Chakra Petch font (+ Orbitron for the item name in Cyberpunk), borders and accents from the same CSS variables. Theme changes in the app apply to the card instantly (storage event); no hard-coded colors beyond the existing opacity/size settings.
- **Style-only cleanup of the `core` crate**: code re-flow with no functional change — no identifier, literal or value altered (verified by word-for-word lexical comparison); full test suite green after this pass.
- Tests: full chain green (48 tarkov-core + 6 e2e suites + 9 Rust).

## 0.9.17 — Zone de détection : plus de faux voisins

### FR
- **Boîte miroir (à gauche du curseur) désactivée hors bord d'écran** : elle n'est envoyée au moteur OCR que quand la boîte de capture principale déborderait du bord droit de l'écran — le seul cas où le jeu inverse l'infobulle à gauche du curseur. Au milieu de l'écran, ce tiroir ne lisait que des légendes voisines et remontait de **faux objets** (objets détectés « à gauche » de la souris).
- **Boîte « objet au sol » réservée au raid** : elle est désormais envoyée uniquement quand le curseur OS est masqué — en raid, EFT le cache (chaque fenêtre de menu le montre). Dans l'entrepôt/flea/marchands, cette bande sous le curseur ne lisait que des libellés de voisins (faux objets « à droite »/« en dessous »). La géométrie raid validée (+13/−53, 125×40 et la bande sol −80/+30 160×30) est inchangée.
- **Badge de transparence** : quand la lecture vient d'une boîte de secours (miroir ou zone élargie du moteur OCR), la carte l'indique dans la ligne d'attributs (« ⧉ Miroir » / « ⧉ Zone élargie ») pour rendre immédiatement lisible le recours à une boîte autre que la principale.
- Tests : 9 unitaires Rust (les 2 nouveaux verrouillent les conditions miroir/ground), chaîne complète au vert.

### EN
- **Mirror box (left of cursor) disabled away from the screen edge**: it is sent to the OCR engine only when the primary capture box would overflow the monitor's right edge — the only case where the game flips the tooltip to the LEFT of the cursor. Mid-screen it only read neighbour captions and surfaced wrong items ("detected to the left of the mouse").
- **Ground box reserved for raids**: now sent only while the OS cursor is hidden — EFT hides it in raid and shows it in every menu. In stash/flea/traders that strip under the cursor only read neighbour captions (wrong items "to the right"/"below"). The validated raid geometry (+13/−53 125×40, ground −80/+30 160×30) is unchanged.
- **Transparency badge**: when a read comes from the mirrored or widened rescue box, the card shows it in the attribute line so a fallback read is instantly recognizable.
- Tests: 9 Rust unit tests (2 new lock the mirror/ground conditions); full chain green.

## 0.9.16 — Lecture d'objet : correctif après mise à jour + table corrections

### FR
- **Correctif « aucun objet est reconnu » après une mise à jour de l'app** : le moteur OCR (processus autonome) rejette toute capture dont le numéro d'ordre est inférieur au précédent et garde en mémoire ce numéro entre les sessions. Le compteur de l'app repartait de 1 à chaque redémarrage — après une mise à jour (ou même un simple redémarrage de l'app, la fenêtre d'OCR restant ouverte), toutes les lectures étaient rejetées et la carte affichait « Objet non reconnu » en permanence. Le compteur démarre désormais à l'heure système, toujours supérieur à celui de toute session précédente. (Diagnostic confirmé par sondes HTTP réelles sur :8765.)
- **Table « corrections OCR » réparée** : les corrections saisies dans les réglages étaient envoyées au moteur comme une chaîne de texte au lieu d'un objet (rejet de la requête : 422) — toute lecture échouait tant qu'une correction existait. Envoyées désormais au format attendu.
- Tests : nouveau test unitaire (monotonie inter-session du compteur), chaîne complète au vert.

### EN
- **Fix “no item is recognized” after updating the app**: the OCR engine keeps the highest request sequence number it ever saw and rejects older ones, surviving app restarts/updates. The app counter restarted from 1 every session, so every lookup was rejected and the card permanently showed “Item not recognized”. The counter now starts from the system clock, always higher than any previous session.
- **OCR corrections table fixed**: user corrections were sent as a JSON string instead of an object (422 — every lookup with a correction failed). Now sent in the expected format.
- Tests: new inter-session monotonicity unit test; full chain green.

## 0.9.15 — Overlay Blitz : carte enrichie, réglages complets, mode auto optionnel

### FR
- **Carte d'objet in-game enrichie** : l'overlay au curseur affiche désormais Flea + tendance 48h (↗/↘), fourchette 24h et nombre d'offres ; meilleur marchand de revente + prix des autres marchands ; prix /slot et /kg ; calibre (munitions) ; quêtes avec comptes ×N, marque FIR ⚑, requirement Kappa κ et l'état du joueur (terminée = barrée + ✓) ; où récupérer l'objet (barter) et où le dépenser ; planque (≤ 3 stations + « +N ») ; crafts (station, durée, ingrédients) ; texte brut lu par l'OCR (section debug).
- **Sections activables une à une** : chaque bloc ci-dessus se masque/affiche individuellement dans les réglages (par défaut : tout est visible sauf « Acheter » et « Texte lu »).
- **Opacité du fond (0.3–1) et taille du texte (0.7–2)** configurables ; l'échelle n'utilise pas de « zoom » CSS (les tailles dérivent d'une variable, la fenêtre suit le contenu).
- **Position de la carte au choix** : coin haut-gauche (défaut, position historique validée conservée), haut-droit, bas-gauche, bas-droit — avec marge tenant compte de l'échelle et collage à l'écran du curseur.
- **Mode « prix au survol » (optionnel, désactivé par défaut)** : une lecture par déplacement réel du curseur (≈ 28 px à 1080p), espacée d'au moins 1,5 s, uniquement quand Tarkov est au premier plan et qu'aucune lecture n'est en cours. Aucune boucle permanente : zéro OCR tant que rien ne bouge. Raccourci dédié pour l'activer en jeu et un raccourci « masquer » immédiat, autres désactivés par défaut.
- **Corrections OCR mémorisées** : réglage libre « texte lu = nom officiel » (une par ligne) ; envoyé à chaque lecture au moteur OCR, une correction apprise s'applique à toutes les lectures suivantes ; lignes malformées signalées.
- **Retours d'état clairs sur la carte** : Lecture…, mode auto activé/désactivé, « Lance Tarkov d'abord », erreurs réseaux explicites ; AUCUN prix fabriqué en cas d'échec de reconnaissance (le titre montre le texte brut pour aider à corriger).
- **Fiabilité** : séquence anti-doublon conservée ; la fenêtre se recale à chaque redimensionnement ; l'échappement HTML entré manuellement est neutralisé.
- **Chantier code** : suppression d'un `src/lib.rs` reliquat (compilation bin propre, 0 warning) ; géométrie de capture validée verrouillée par tests unitaires (125×40 à curseur +13/−53, miroir, box « ground », échelles 1440p/4K).

### EN
- **Richer in-game item card**: flea price + 48h trend, 24h range & offers, best resale trader + other traders, price per slot / kg, caliber, quests with counts/FIR/Kappa/player progress, how the item is obtained (barter) or spent, hideout stations, crafts, raw OCR text (debug section).
- **Individually toggleable sections** in the settings (default: everything but “Buy” and “Raw text”).
- **Background opacity (0.3–1) and text size (0.7–2)** configurable; text scale via CSS variables (no zoom).
- **Card position**: top-left (default, validated position kept), top-right, bottom-left, bottom-right — anchored to the monitor under the cursor.
- **Optional hover-pricing (auto) mode, off by default**: one read per real cursor move (≈28 px at 1080p), at least 1.5 s apart, only while Tarkov is the foreground window and no read is running. No permanent loop.
- **Memorized OCR corrections**: free-form “read = official name” lines (one per line), sent on every lookup; malformed lines reported.
- **Clear card states**: reading, auto on/off, “start Tarkov first”, network errors; none of them fabricates prices.
- **Side note**: v0.9.13–0.9.14 semantics (fixed-location quest markers, “started” = actually started quests) now covered by the e2e test suite.

## 0.9.14 — Carte : gestion de la hauteur et des étages

### FR
- **Position horizontale ≠ hauteur** : le regroupement de marqueurs ne fusionne que des points du même étage ; deux objectifs aux mêmes coordonnées planaires mais de niveaux différents restent des marqueurs distincts (porte du RDC ≠ porte du 1er).
- **Étage de chaque marqueur identifié** : les infobulles portent la nomenclature réelle de la carte (« Ground Floor », « 3rd Floor », « Tunnels », « Bunkers », « Accommodation (lower) »…). Portes, conteneurs, spawns, extractions, armes fixes, loot au sol et objectifs de quête affichent leur niveau.
- **Hauteur sans invention** : un point sans hauteur connue reste explicitement « étage inconnu » — jamais attribué arbitrairement au rez-de-chaussée.
- **Atténuation précise par étage** : les marqueurs d'autres étages s'assombrissent selon l'étage réel du point (résiste aux limites d'étages superposées de certaines cartes) ; les calques reconstruits après un changement de filtre reprennent l'atténuation (correctif).
- **Navigation verticale** : cliquer un objectif ou le bouton « Zoomer sur les objectifs » du panneau latéral bascule directement sur l'étage de l'objectif avant de le cadrer ; « Afficher sur la carte » fait de même. Le mode auto est désactivé comme pour un clic manuel sur la barre d'étages ; la position, les filtres et la quête sélectionnée sont conservés.
- **Clé requise fiable** : la clé suggérée pour un objectif de quête ne peut venir que d'un verrou du même étage.
- **Connexions verticales (escaliers, échelles, ascenseurs)** : aucun jeu de données n'expose ces liaisons de façon fiable — rien n'est affiché, conformément au principe « ne rien inventer ».

### EN
- **Horizontal position ≠ height**: marker grouping only merges points on the same floor; objectives sharing planar coordinates but on different levels remain distinct markers.
- **Every marker labelled with its floor**, using the map's own names. Locks, containers, spawns, extracts, stationary weapons, ground loot and quest objectives show their level.
- **No invented data**: a point with unknown height stays explicitly unknown — never assumed ground floor.
- **Accurate per-floor dimming** based on the marker's real floor (resistant to overlapping floor ranges); layers rebuilt after a filter change re-apply the dimming (fix).
- **Vertical navigation**: clicking an objective or its "zoom" button in the side panel switches to the objective's floor first, then frames it; "show on map" behaves the same. Auto mode is turned off exactly like a manual floor-bar click; map position, filters and selected quest are preserved.
- **Reliable required key**: a quest objective's suggested key can only come from a lock on the same floor.
- **Vertical connections (stairs, ladders, lifts)**: no dataset reliably exposes them — nothing is displayed, per the "never invent" principle.

## 0.9.13 — Quêtes ↔ carte : lieux fixes uniquement, marqueurs regroupés

### FR
- **Carte : lieux imposés uniquement** — seuls les objectifs dont l'emplacement est explicitement fixé par la quête affichent des marqueurs : zone à visiter, objet de quête à un endroit précis, sortie nommée, zone de tir.
- **Fin des spawns génériques sur la carte** : une collecte de type « trouvez X en raid » (injecteur, clé, efedrine, arme…) ne génère plus les dizaines de points où l'objet *peut* apparaître. L'objectif reste visible dans l'onglet Quêtes.
- **Marqueurs regroupés** : les objectifs proches ou superposés (même pièce, même porte) fusionnent en un seul marqueur ; l'infobulle liste toutes les quêtes concernées et la clé éventuellement requise (verrou du même endroit).
- **Clic sur un marqueur** : ouvre le détail de la quête associée dans l'onglet Quêtes.
- **Préparation de raid** : bouton « Tout cadrer » pour cadrer tous les objectifs des quêtes cochées ; l'ancien comportement de sélection multiple (cases à cocher) est conservé.
- **« Afficher sur la carte » plus honnête** : pour une quête sans lieu fixe (collecte pure), l'application signale qu'il n'y a rien à cadrer au lieu de basculer sur une carte vide.
- **Panneau de suivi complet** : tous les objectifs restent listés dans la fiche quête, y compris les collectes génériques (nombre, trouvé en raid…) ; la progression affichée vient des logs ou de vos coches, jamais inventée.

### EN
- **Map: fixed locations only** — only objectives whose location is explicitly imposed by the quest show markers: visit zone, quest item at a precise spot, named extract, shoot zone.
- **No more generic item spawns on the map** — "find X in raid" collection objectives no longer draw every possible spawn point; they stay listed in the Quests tab.
- **Grouped markers** — nearby/overlapping objectives merge into one marker; the tooltip lists every affected quest and the required key if a lock is in the same room.
- **Click a marker** — opens the related quest details in the Quests tab.
- **Raid prep** — new "Fit all" button frames every checked quest's objectives; the existing multi-select checkboxes are kept.
- **Honest "show on map"** — for a quest with no fixed location (pure collection), the app says there is nothing to frame instead of switching to an empty map.
- **Complete tracking panel** — every objective stays listed in the quest sheet (count, found-in-raid…); displayed progress comes from logs or your own ticks, never invented.

## 0.9.12 — Quêtes : filtrage des objectifs et amélioration UX

### FR  
- **Filtrage intelligent des objectifs** : les objectifs de type « trouver X items » n'affichent plus tous les items disponibles dans le jeu, seulement ceux mentionnés spécifiquement dans la description de la quête ou les items principaux.

### EN
- **Intelligent objective filtering**: find-item objectives no longer show all available items in the game, only those specifically mentioned in the quest description or the main items.

## 0.9.11 — Overlay unique

### FR
- Suppression du composant d'overlay dupliqué intégré à la fenêtre principale ; seul l'overlay natif dédié affiche maintenant les résultats OCR.

## 0.9.10 — Overlay : zone de capture optimisée et retrait de l'outil debug

### FR
- **Zone de capture OCR recalibrée** : boîte de 125×40 px dont le coin bas-gauche est ancré à 13 px au-dessus et 13 px à droite du curseur — cible uniquement le nom de l'item survolé, élimine les lectures parasites (items voisins, libellés « Key Tool »/« Buy »)
- **Retrait de l'outil de debug OCR** : le raccourci F3, le cadre rouge et les dumps BMP introduits pour le réglage sont supprimés ; l'overlay retrouve son fonctionnement original (F2 capture, Shift+F2 affichage)
- **Conservation des correctifs de robustesse** : nettoyage overlay/sidecar à la fermeture, absence de fenêtre console pour le sidecar, masquage autoritaire de la fenêtre overlay

### EN
- **Recalibrated OCR capture region**: 125×40 px box anchored bottom-left 13 px above and 13 px right of the cursor — targets only the hovered item name, eliminating stray reads (neighbouring items, "Key Tool"/"Buy" labels)
- **Removed OCR debug tool**: the F3 hotkey, red frame and BMP dumps introduced for tuning are removed; the overlay is back to its original behaviour (F2 capture, Shift+F2 toggle)
- **Kept robustness fixes**: overlay/sidecar cleanup on exit, no console window for the sidecar, authoritative overlay window hiding

## 0.8.22 — Hideout : correction des items manquants et amélioration de l'overlay

### FR
- **Correction des items manquants** : lorsqu'un item requis pour le hideout n'existe pas dans l'API (bug de données externes), l'interface affiche "Objet inconnu" avec une icône rouge plutôt qu'un ID brut
- **Amélioration de l'overlay** : meilleure gestion visuelle des items non trouvés dans la fiche hideout

### EN
- **Fixed missing items** : when an item required for hideout doesn't exist in the API (external data bug), the interface shows "Unknown item" with a red icon instead of a raw ID
- **Overlay improvement**: better visual handling of not-found items in hideout details

### DE
- **Korrektur fehlender Gegenstände**: wenn ein Gegenstand für den Hideout nicht in der API existiert (externer Datenerfassungsfehler), zeigt die Schnittstelle "Unbekannter Gegenstand" mit einem roten Icon statt einer rohen ID
- **Overlayverbesserung**: bessere visuelle Behandlung nicht gefundener Gegenstände in den Hideout-Details

### ES
- **Corrección de items faltantes**: cuando un item requerido para el hideout no existe en la API (error de datos externos), la interfaz muestra "Objeto desconocido" con un ícono rojo en lugar de un ID crudo
- **Mejora del overlay**: mejor manejo visual de items no encontrados en los detalles del hideout

### RU
- **Исправление отсутствующих предметов**: когда предмет, необходимый для убежища, не существует в API (внешняя ошибка данных), интерфейс отображает "Неизвестный предмет" с красной иконкой вместо сырых ID
- **Улучшение оверлея**: лучшая визуальная обработка не найденных предметов в деталях убежища

## 0.8.21 — Hideout : descriptions traduites, icônes et cartes de bonus ajustées

### FR
- **Descriptions traduites** : les descriptions de station s'affichent maintenant en français (ou dans la langue choisie) au lieu des clés brutes
- **Images en icônes** : les images de station sont maintenant des icônes compactes au lieu de bannières zoomées
- **Cartes de bonus agrandies** : largeur dynamique adaptée au texte, plus de troncature « … »

### EN
- **Translated descriptions**: station descriptions now display in the selected language instead of raw keys
- **Images as icons**: station images are now compact icons instead of zoomed banners
- **Bonus cards widened**: dynamic width adapts to text, no more "…" truncation

### DE
- **Beschreibungen übersetzt**: Stationsbeschreibungen werden jetzt in der gewählten Sprache angezeigt
- **Bilder als Symole**: Stationsbilder sind jetzt kompakte Symbole statt gezoomter Banner
- **Bonus-Karten verbreitert**: dynamische Breite, keine Kürzung mehr

### ES
- **Descripciones traducidas**: las descripciones de estación se muestran en el idioma seleccionado
- **Imágenes como iconos**: las imágenes de estación son ahora iconos compactos
- **Tarjetas de bonificación ampliadas**: ancho dinámico, sin truncamiento

### RU
- **Описания переведены**: описания станций отображаются на выбранном языке
- **Изображения как иконки**: изображения станций теперь компактные иконки
- **Карточки бонусов расширены**: динамическая ширина, без обрезки

## 0.8.20 — Hideout : bonus par niveau et redesign complet

### FR
- **Hideout redesigné** : cartes de station avec image, barre de progression et puces de bonus au lieu d'une simple liste
- **Bonus par niveau** : chaque niveau de station affiche ses bonus (19 types : XP, régénération, déblocages, commissions…) avec icônes dédiées
- **Description et prérequis** : description de station, temps de construction, prérequis de compétences/marchands/stations
- **Piste de niveaux visuelle** : navigation cliquable entre les niveaux avec indicateur de progression

### EN
- **Hideout redesigned**: station cards with image, progress bar and bonus chips instead of a plain list
- **Bonuses per level**: each station level shows its bonuses (19 types: XP, regen, unlocks, commissions…) with dedicated icons
- **Description and prerequisites**: station description, construction time, skill/trader/station requirements
- **Visual level track**: clickable level navigation with progress indicator

### DE
- **Versteck neu gestaltet**: Stationskarten mit Bild, Fortschrittsbalken und Bonus-Chips statt einer einfachen Liste
- **Boni pro Stufe**: jede Stationsstufe zeigt ihre Boni (19 Typen: XP, Regeneration, Freischaltungen, Kommissionen…) mit eigenen Symbolen
- **Beschreibung und Voraussetzungen**: Stationsbeschreibung, Bauzeit, Fähigkeiten/Händler/Station-Voraussetzungen
- **Visuellen Stufenverlauf**: klickbare Stufennavigation mit Fortschrittsanzeige

### ES
- **Refugio rediseñado**: tarjetas de estación con imagen, barra de progreso y pips de bonificación en lugar de una lista simple
- **Bonificaciones por nivel**: cada nivel de estación muestra sus bonificaciones (19 tipos: XP, regeneración, desbloqueos, comisiones…) con iconos dedicados
- **Descripción y requisitos**: descripción de estación, tiempo de construcción, requisitos de habilidades/comerciantes/estaciones
- **Pista de niveles visual**: navegación clicable entre niveles con indicador de progreso

### RU
- **Убежище переработано**: карточки станций с изображением, полосой прогресса и чипами бонусов вместо простого списка
- **Бонусы по уровням**: каждый уровень станции показывает свои бонусы (19 типов: опыт, регенерация, разблокировки, комиссии…) с иконками
- **Описание и требования**: описание станции, время постройки, требования навыков/торговцев/станций
- **Визуальный трек уровней**: навигация по уровням с индикатором прогресса

## 0.8.19 — Verrous, compteur d'objets et onglet Hideout

### FR
- **Verrous sur la carte** : toutes les portes et coffres fermés à clé (271 verrous sur 14 cartes) sont affichés avec un calque dédié, filtrables par type (Porte / Coffre)
- Clic sur un verrou : clé requise, quantité possédée, besoin d'alimentation électrique, accès direct à la fiche de la clé
- **Compteur d'objets « possédé »** : dans l'onglet Objets, saisissez la quantité en inventaire — partagé avec les verrous et le hideout
- **Onglet Hideout** : stations, niveaux du joueur, objets à réunir par niveau, badge FIR, filtre « manquants seulement », compteurs liés à l'inventaire

### EN
- **Locks on the map**: all locked doors and containers (271 locks on 14 maps) shown with a dedicated layer, filterable by type (Door / Container)
- Click a lock: required key, owned quantity, power requirement, direct link to the key's item page
- **Owned item counter**: in the Items tab, set your inventory quantity — shared with locks and hideout
- **Hideout tab**: stations, player levels, items to gather per level, FIR badge, "missing only" filter, counters linked to inventory

### DE
- **Schlösser auf der Karte**: alle verschlossenen Türen und Behälter (271 Schlösser auf 14 Karten) mit eigenem Layer, filterbar nach Typ (Tür / Behälter)
- Klick auf ein Schloss: benötigter Schlüssel, vorhandene Menge, Strombedarf, direkter Link zum Schlüsseleintrag
- **Besitz-Zähler**: im Gegenstände-Tab die Inventar-Menge eintragen — geteilt mit Schlössern und Versteck
- **Versteck-Tab**: Stationen, Spielerstufen, zu sammelnde Gegenstände pro Stufe, FIR-Badge, Filter „nur Fehlendes"

### ES
- **Cerraduras en el mapa**: todas las puertas y cofres cerrados (271 cerraduras en 14 mapas) con capa propia, filtrables por tipo (Puerta / Cofre)
- Clic en una cerradura: llave requerida, cantidad en posesión, necesidad de electricidad, enlace directo a la ficha de la llave
- **Contador de objetos en posesión**: en la pestaña Objetos, introduce la cantidad del inventario — compartido con cerraduras y refugio
- **Pestaña Refugio**: estaciones, niveles del jugador, objetos por reunir por nivel, etiqueta FIR, filtro «solo faltantes»

### RU
- **Замки на карте**: все запертые двери и контейнеры (271 замок на 14 картах) с отдельным слоем, фильтр по типу (Дверь / Контейнер)
- Клик по замку: нужный ключ, количество в наличии, нужна ли электроэнергия, прямая ссылка на карточку ключа
- **Счётчик предметов в наличии**: во вкладке Предметы укажите количество в инвентаре — общий для замков и убежища
- **Вкладка Убежище**: станции, уровни игрока, предметы для сбора по уровням, метка FIR, фильтр «только недостающее»

## 0.8.18 — thème light refonte complète

### FR
- Thème clair entièrement refondu : l'habillage est maintenant vraiment clair (barre du bas, onglets, boutons, panneaux, dialogues, scrollbars)
- Toutes les couleurs en dur qui ignoraient le thème sont converties
- Correction des contrastes illisibles (tag « besoin », texte rouge sur fond clair)
- Grain désactivé en thème clair, color-scheme light pour les contrôles natifs
- Nouveau bouton « Carte éclaircie » dans la barre de carte (les cartes de jeu sont sombres)

### EN
- Light theme fully reworked: the chrome is now truly light (bottom bar, tabs, buttons, panels, dialogs, scrollbars)
- All hardcoded colors that ignored the theme are converted
- Fixed unreadable contrast (need tag, red text on light background)
- Grain disabled in light theme, color-scheme light for native controls
- New "Brighten map" button in the map bar (game maps are dark)

### DE
- Helles Theme komplett überarbeitet: die Oberfläche ist jetzt wirklich hell (Unterleiste, Tabs, Schaltflächen, Paneele, Dialoge, Scrollbars)
- Alle festen Farben, die das Theme ignorierten, werden umgewandelt
- Unlesbare Kontraste korrigiert („Bedarf"-Tag, roter Text auf hellem Grund)
- Korn im hellen Theme deaktiviert, color-scheme light für native Steuerelemente
- Neue Schaltfläche „Karte aufhellen" in der Kartenleiste (Spielkarten sind dunkel)

### ES
- Tema claro completamente rehecho: la interfaz ahora es realmente clara (barra inferior, pestañas, botones, paneles, diálogos, barras de desplazamiento)
- Se convierten todos los colores fijos que ignoraban el tema
- Contrastes ilegibles corregidos (etiqueta «necesita», texto rojo sobre fondo claro)
- Grano desactivado en tema claro, color-scheme light para controles nativos
- Nuevo botón «Aclarar mapa» en la barra del mapa (los mapas del juego son oscuros)

### RU
- Светлая тема полностью переработана: интерфейс теперь действительно светлый (нижняя панель, вкладки, кнопки, панели, диалоги, полосы прокрутки)
- Все жёсткие цвета, игнорировавшие тему, преобразованы
- Исправлены нечитаемые контрасты (метка «нужно», красный текст на светлом фоне)
- Зерно отключено в светлой теме, color-scheme light для нативных элементов
- Новая кнопка «Осветлить карту» на панели карты (игровые карты тёмные)

## 0.8.17 — filtres par faction et titre des points

### FR
- Les extractions peuvent être filtrées par faction : PMC, Scavs, Coop
- Les apparitions peuvent être filtrées : PMC / Scavs
- Le titre de la section des points personnalisés s'affiche correctement (« Points personnalisés » au lieu de la clé de traduction)

### EN
- Extracts can now be filtered by faction: PMC, Scavs, Coop
- Spawns can be filtered: PMC / Scavs
- The custom points section title now displays correctly ("Custom points" instead of the raw translation key)

### DE
- Ausgänge können nach Fraktion gefiltert werden: PMC, Scavs, Coop
- Spawns können gefiltert werden: PMC / Scavs
- Der Titel des Bereichs „Eigene Punkte" wird jetzt korrekt angezeigt (statt des Rohlüssels)

### ES
- Las extracciones se pueden filtrar por facción: PMC, Scavs, Coop
- Las apariciones se pueden filtrar: PMC / Scavs
- El título de la sección de puntos personalizados ahora se muestra correctamente

### RU
- Выходы можно фильтровать по фракции: ЧВК, Дикие, Кооп
- Спавны можно фильтровать: ЧВК / Дикие
- Заголовок раздела «Свои точки» теперь отображается корректно

## 0.8.16 — points personnalisés : clic droit et affichage immédiat

### FR
- Clic droit sur un point personnalisé : le menu « Modifier / Supprimer » s'ouvre enfin (l'ancien code plantait avant d'afficher le menu)
- Le menu « Ajouter un point » du fond de carte ne remplace plus celui du point
- Un point ajouté apparaît immédiatement sur la carte, sans changer de carte
- Les points personnalisés s'affichent même si les données de la carte ne sont pas encore téléchargées
- Les points enregistrés avec des coordonnées corrompues sont ignorés au lieu de casser tout le calque
- Les boutons « Centrer sur moi » et « Suivi » fonctionnent de nouveau (ils n'avaient plus d'action)
- Les quêtes se mettent à jour en direct sur la carte et dans le panneau quand elles démarrent ou progressent (logs, rattrapage, OCR)
- Cocher un objectif (✓) met à jour la carte et le panneau immédiatement

### EN
- Right-clicking a custom point finally opens the “Edit / Delete” menu (the old code crashed before showing it)
- The map background's “Add point” menu no longer replaces the point's own menu
- A newly added point appears immediately on the map, without switching maps
- Custom points still show even if the map data has not been downloaded yet
- Points stored with corrupted coordinates are ignored instead of breaking the whole layer
- The “Center on me” and “Follow” buttons work again (their actions were no longer wired)
- Quests update live on the map and in the side panel when they start or progress (logs, catch-up, OCR)
- Ticking an objective (✓) updates the map and panel immediately

## 0.7.17 — custom map points

### FR
- Nouvelle fonctionnalité : ajouter des points personnalisés sur les cartes
- Chaque point a un nom, un texte, une clé (optionnel), et une icône
- Les icônes disponibles : app, marque, étoile, cercle, carré, ou image locale personnalisée
- Les points sont sauvegardés localement et associés à la carte
- Le bandeau de gauche affiche la liste des points avec un bouton d'édition

### EN
- New feature: add custom points on the map
- Each point has a name, text, optional key, and icon
- Available icons: app badge, marker, star, circle, square, or custom local image
- Points are saved locally and associated with the map
- The left panel shows a list of points with an edit button

## 0.7.16 — bilingual update banner

### FR
- Correction d'un bug OCR : le choix d'état d'une quête n'était pas conservé après un clic sur une pastille
- Audit pré-release complet : versions cohérentes, IDs DOM vérifiés, i18n vérifié, fichiers référents validés

### EN
- Fixed OCR bug: quest state selection was not preserved after clicking a state dot
- Complete pre-release audit: consistent versions, DOM IDs checked, i18n verified, referenced files validated

## 0.7.15 — bilingual update banner

### FR
- Le bandeau de mise à jour affiche maintenant le changelog dans la langue choisie (français ou anglais)
- Le fichier CHANGELOG est bilingue : chaque version a une section FR et une section EN

### EN
- The update banner now displays the changelog in the chosen language (French or English)
- The CHANGELOG file is bilingual: each version has a FR section and an EN section

## 0.7.14 — marker visibility

### FR
- Lueur bleue claire autour des icônes pour une visibilité optimale sur tous les fonds de carte
- Contour et effet visuel renforcés dans les SVG inline

### EN
- Light blue glow around icons for optimal visibility on all map backgrounds
- Reinforced outline and visual effect in inline SVGs

## 0.7.13 — comfort, quest states and multiple tracked items

### FR
- Taille minimale de la fenêtre portée à 1280×720 (ouverture en 1280×800)
- Panneau de gauche de la carte élargi : la barre de défilement horizontale en bas a disparu
- Les textes longs (types de conteneurs, objets suivis) sont tronqués proprement au lieu de déborder
- Rattrapage OCR : une pastille par état sur chaque ligne (gris = pas fait, orange = en cours, rouge = raté, bleu = fait)
- La pastille choisie affiche une coche ; plus de cycle ambigu au clic
- Correction d'un bug où l'écouteur de clic s'empilait après une lecture de capture
- Toutes les quêtes reconnues restent modifiables, y compris celles encore verrouillées
- Jeu en anglais, application en français : la reconnaissance compare aussi le nom normalisé anglais
- Le texte reconnu est montré à côté du nom quand il diffère, pour vérifier la correspondance
- Carte : rechercher un objet l'ajoute à la liste au lieu de remplacer le précédent
- Chaque objet a sa propre couleur, avec le nombre d'emplacements et un bouton pour le retirer
- Bouton « Tout effacer » pour repartir de zéro

### EN
- Minimum window size set to 1280×720 (opens at 1280×800)
- Left map panel widened: horizontal scrollbar at the bottom is gone
- Long text (container types, tracked items) is properly truncated instead of overflowing
- OCR catch-up: one state dot per quest line (gray = not done, orange = started, red = failed, blue = finished)
- Selected dot shows a checkmark; no more ambiguous click cycling
- Fixed a bug where click listeners stacked up after reading a screenshot
- All recognized quests remain editable, including locked ones
- Game in English, app in French: recognition also compares the normalized English name
- Recognized text is shown next to the name when different, for verification
- Map: searching an item adds it to the list instead of replacing the previous one
- Each item has its own color, with location count and a remove button
- "Clear all" button to start fresh

## 0.7.12 — container names fixed

### FR
- Les icônes de conteneurs affichent leur vrai nom (« Sac de sport », « Caisse d'arme »…) au lieu d'un identifiant technique
- Le nom vient du référentiel officiel fourni par l'API (`lootContainers`)
- Le panneau des calques liste les noms au lieu des identifiants
- Repli automatique sur un libellé anglais lisible quand une traduction manque
- Plus de recensement du wiki quand l'API fournit déjà le référentiel : téléchargement initial bien plus rapide
- Cache de données renouvelé automatiquement pour appliquer le correctif sans manipulation

### EN
- Container icons now display their real name ("Sport bag", "Weapon crate"…) instead of a technical ID
- Name comes from the official repository provided by the API (`lootContainers`)
- Layer panel lists names instead of IDs
- Falls back to a readable English label when a translation is missing
- No more wiki scraping when the API already provides the repository: much faster initial download
- Data cache automatically renewed to apply the fix without manual steps

## 0.7.11 — improved update banner

### FR
- Le changelog est maintenant affiché en texte brut avec sauts de ligne
- Le titre et la version sont séparés pour une meilleure visibilité
- Le texte est maintenant resizable pour lire les changelogs longs

### EN
- Changelog now displayed as plain text with line breaks
- Title and version are separated for better visibility
- Text is now resizable to read long changelogs

## 0.7.10 — screenshot picker fix + complete translations

### FR
- Le bouton "Pick a screenshot" ouvre le picker de fichiers sans lire automatiquement le dernier screenshot
- L'utilisateur peut choisir n'importe quelle capture dans la liste déroulante
- Tous les noms d'étages traduits, boutons et textes d'interface traduits dans toutes les langues

### EN
- "Pick a screenshot" button opens the file picker without auto-reading the last screenshot
- User can choose any screenshot from the dropdown
- All floor names, buttons and interface texts translated in all languages

## 0.7.8 — OCR and language fixes

### FR
- Correction du système OCR : changement de fichier = nouvelle analyse
- Les états `ocrSeen` et `ocrState` sont correctement vides à l'ouverture et à la fermeture
- Alignement des couleurs avec l'interface Tarkov

### EN
- OCR system fix: file change = new analysis
- `ocrState` properly empty on open and close
- Colors aligned with the Tarkov interface

## 0.7.7 — color badges in OCR

### FR
- Lors de la lecture d'une capture d'écran de quêtes, l'utilisateur peut choisir l'état de chaque quête trouvée
- Options disponibles : « Non fait », « En cours », « Raté », « Fait »
- Les quêtes non cochées restent dans l'état actuel

### EN
- When reading a quest screenshot, the user can choose the state of each found quest
- Available options: "Not done", "Started", "Failed", "Finished"
- Unchecked quests remain in their current state

## 0.7.4 — unlocked quests + cyberpunk theme

### FR
- Affichage de toutes les quêtes disponibles sur la map (pas seulement 5)
- Correction de la détection d'étage
- Thème Cyberpunk amélioré avec police Orbitron

### EN
- Display all available quests on the map (not just 5)
- Fixed floor detection
- Improved Cyberpunk theme with Orbitron font

## 0.7.3 — reliable automatic updates

### FR
- Publication vérifiée de bout en bout : nom de fichiers normalisés, signature minisign vérifiée
- Filet de sécurité : bouton « Télécharger à la main » en cas d'échec

### EN
- End-to-end verified publishing: normalized file names, minisign signature verified
- Safety net: "Download manually" button on failure

## 0.7.2 — quests, themes & icons

### FR
- Les quêtes retirées du jeu sont automatiquement masquées (croisement avec le wiki officiel)
- Une quête débloquée est considérée comme en cours par défaut
- Trois thèmes : Sombre (Tarkov), Clair et Cyberpunk
- Icônes distinctes sur la carte : porte, flèche, silhouette, caisse, étoile
- Correction du crash OCR avec chemins contenant des crochets

### EN
- Removed quests are automatically hidden (crossed with official wiki)
- An unlocked quest is considered in progress by default
- Three themes: Dark (Tarkov), Light and Cyberpunk
- Distinct icons on the map: door, arrow, silhouette, crate, star
- Fixed OCR crash with paths containing brackets

## 0.7.1 — fixes

### FR
- Correction du crash OCR (`AggregateException`) : image convertie en format BGRA8
- Correction de la détection de Streets : le bundle `shopping_mall` est reconnu

### EN
- Fixed OCR crash (`AggregateException`): image converted to BGRA8 format
- Fixed Streets detection: `shopping_mall` bundle recognized

## 0.7.0 — automatic updates, full i18n

### FR
- L'app vérifie au démarrage si une nouvelle version existe et propose de l'installer en un clic
- Interface entièrement traduite : français, anglais, allemand, espagnol, russe
- Visite guidée au premier lancement
- Mémoire de l'état : dernière carte, calques, quêtes sauvegardés
- Clic droit désactivé, infobulles raccourcies

### EN
- App checks at startup if a new version exists and offers one-click install
- Fully translated interface: French, English, German, Spanish, Russian
- Guided tour on first launch
- State memory: last map, layers, quests saved
- Right-click disabled, shortened tooltips

## 0.6.0 — floors, overlay, hideout

### FR
- Sélecteur d'étage pour les cartes à niveaux (Customs, Interchange, Réserve…)
- Suivi automatique de l'étage d'après la hauteur du joueur
- Overlay objet au survol : prix flea, meilleur marchand, besoin de quête
- Recherche globale Ctrl+F (objets, quêtes, cartes)
- Stations et niveaux du hideout affichés dans la fiche

### EN
- Floor selector for multi-level maps (Customs, Interchange, Reserve…)
- Automatic floor tracking from player height
- Item overlay on hover: flea price, best trader, quest need
- Global Ctrl+F search (items, quests, maps)
- Hideout stations and levels shown in details

## 0.5.1 — log fix

### FR
- Correction : les versions récentes du jeu nomment le fichier `notifications_000.log` ;
  les suffixes de rotation sont désormais acceptés pour tous les fichiers de logs

### EN
- Fix: recent game versions name the file `notifications_000.log`;
  rotation suffixes are now accepted for all log files
