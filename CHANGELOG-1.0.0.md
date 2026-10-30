<!-- Prêt à insérer en tête de CHANGELOG.md au moment de la release 1.0.0
     (avec le bump de version : package.json, tauri.conf.json, Cargo.toml, Cargo.lock). -->

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
