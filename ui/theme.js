"use strict";
// Thèmes visuels. Pour ajouter un thème : dépose un bloc [data-theme="mon-theme"] dans style.css
// avec les mêmes variables CSS que :root, puis ajoute une ligne dans THEMES ci-dessous.
(function () {
  const TT = (window.TT = window.TT || {});

  /** id du thème -> clé i18n du libellé. Le premier est le défaut. */
  const THEMES = [
    ["dark", "set.theme.dark"],
    ["light", "set.theme.light"],
    ["cyberpunk", "set.theme.cyberpunk"],
  ];
  const KEY = "theme";
  const ids = THEMES.map(([id]) => id);

  function load() {
    const saved = localStorage.getItem(KEY);
    return ids.includes(saved) ? saved : "dark";
  }

  function apply(id) {
    const t = ids.includes(id) ? id : "dark";
    document.documentElement.dataset.theme = t;
    localStorage.setItem(KEY, t);
    TT.store && TT.store.emit && TT.store.emit("theme");
    return t;
  }

  TT.theme = {
    list: THEMES,
    current: load,
    set: apply,
    init() { apply(load()); },
  };

  // Applique le thème avant le premier rendu pour éviter un flash.
  apply(load());
})();
