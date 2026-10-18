# Changelog / Journal des modifications

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
- Thème clair entièrement refondu : la chrome est maintenant vraiment claire (barre du bas, onglets, boutons, panneaux, dialogues, scrollbars)
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
- Container icons now display their real name (« Sport bag », « Weapon crate »…) instead of a technical ID
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
