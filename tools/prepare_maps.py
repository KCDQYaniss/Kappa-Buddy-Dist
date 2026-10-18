#!/usr/bin/env python3
"""Prépare les cartes pour l'app.

- télécharge maps.json (calibration + niveaux) depuis the-hideout/tarkov-dev (MIT)
- télécharge les SVG depuis the-hideout/tarkov-dev-svg-maps (CC BY-NC-SA 4.0)
- écrit ui/maps.json (compact) et ui/maps/<slug>[-<étage>].svg

Les cartes à plusieurs niveaux (Interchange, Customs, Factory, Réserve, Streets, Labs, Icebreaker…)
reçoivent un visuel par étage : l'app bascule d'un niveau à l'autre, automatiquement selon la
hauteur du joueur quand les données de hauteur sont connues (extraits des `extents`).

Usage : python3 tools/prepare_maps.py
"""
import json, re, urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "ui"
RAW_DEV = "https://raw.githubusercontent.com/the-hideout/tarkov-dev/main/src/data/maps.json"
RAW_SVG = "https://raw.githubusercontent.com/the-hideout/tarkov-dev-svg-maps/main/"

NAMES = {
    "customs": "Customs", "factory": "Factory", "woods": "Woods", "shoreline": "Shoreline",
    "interchange": "Interchange", "reserve": "Reserve", "lighthouse": "Lighthouse",
    "streets-of-tarkov": "Streets of Tarkov", "ground-zero": "Ground Zero",
    "terminal": "Terminal", "the-lab": "The Lab", "the-labyrinth": "The Labyrinth",
    "icebreaker": "Icebreaker",
}

# Noms lisibles pour les groupes SVG « rez-de-chaussée » et les niveaux génériques.
FLOOR_NAMES = {
    "Ground_Level": "Rez-de-chaussée",
    "Ground_Floor": "Rez-de-chaussée",
    "Basement": "Sous-sol",
    "Underground_Level": "Sous-sol",
    "Bunkers": "Bunkers",
}
TILE_SEGMENT_NAMES = {
    "main": "Rez-de-chaussée", "main_summer": "Rez-de-chaussée", "main_winter": "Rez-de-chaussée",
    "1st": "Niveau 1", "2nd": "Niveau 2", "3rd": "Niveau 3", "4th": "Niveau 4", "5th": "Niveau 5",
    "bunkers": "Bunkers", "tunnels": "Sous-sol",
}

# Groupes de premier niveau qui contiennent un étage dans les SVG de the-hideout.
# Certains (First_Floor sur Customs) n'apparaissent pas dans les métadonnées : on les repère au nom.
FLOOR_ID = re.compile(
    r"^(Ground_Level|Ground_Floor|Underground_Level|Underground|Basement|Bunkers|Tunnels"
    r"|(First|Second|Third|Fourth|Fifth|Sixth|Seventh|Eighth)_Floor)$"
)


def get(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read()


def floor_ids(root) -> list:
    return [c.get("id") for c in list(root) if c.get("id") and FLOOR_ID.match(c.get("id"))]


def keep_only(root_bytes: bytes, keep):
    """Garde un seul étage : les autres groupes d'étage de premier niveau sont retirés.

    Les `defs`, styles et autres groupes non liés à un étage sont conservés.
    """
    ET.register_namespace("", "http://www.w3.org/2000/svg")
    ET.register_namespace("xlink", "http://www.w3.org/1999/xlink")
    root = ET.fromstring(root_bytes)
    floors = floor_ids(root)
    if keep not in floors:
        keep = floors[0] if floors else None
    for child in list(root):
        cid = child.get("id")
        if cid and cid != keep and FLOOR_ID.match(cid):
            root.remove(child)
    return ET.tostring(root, encoding="unicode")


def layer_ylim(layer) -> list:
    """Hauteur [min, max] couverte par un étage (union des `extents`), si connue."""
    hs = [e.get("height") for e in (layer.get("extents") or []) if e.get("height")]
    if not hs:
        return None
    return [min(h[0] for h in hs), max(h[1] for h in hs)]


def base_floor_name(m: dict, layers: list) -> str:
    sl = m.get("svgLayer")
    if sl in FLOOR_NAMES:
        return FLOOR_NAMES[sl]
    tiles = m.get("tilePath") or ""
    # Un étage de la liste utilise-t-il déjà ce visuel ? On reprend son nom (ex. Icebreaker).
    for l in layers:
        if l.get("tilePath") and l["tilePath"] == tiles and l.get("name"):
            return l["name"]
    seg = tiles.rstrip("/").split("/")[-2] if tokens_has_segment(tiles) else ""
    return TILE_SEGMENT_NAMES.get(seg, "Niveau principal")


def tokens_has_segment(tiles: str) -> bool:
    return "/{z}/" in tiles


def main():
    groups = json.loads(get(RAW_DEV))
    out, report = [], []
    (OUT / "maps").mkdir(parents=True, exist_ok=True)
    for g in groups:
        slug = g["normalizedName"]
        if slug not in NAMES:
            continue
        m = next((x for x in g["maps"] if x.get("projection") == "interactive"), None)
        if not m:
            continue
        layers = [l for l in (m.get("layers") or []) if l.get("name")]
        entry = {
            "slug": slug, "name": NAMES[slug],
            "transform": m["transform"], "rotation": m.get("coordinateRotation", 0),
            "bounds": m["bounds"], "svgBounds": m.get("svgBounds"),
            "minZoom": m.get("minZoom", 1), "maxZoom": m.get("maxZoom", 6),
        }
        svg_path = m.get("svgPath") or ""
        tile_path = m.get("tilePath") or ""
        floor_list = []

        if svg_path.endswith(".svg"):
            fname = svg_path.rsplit("/", 1)[1]
            base_layer = m.get("svgLayer")
            try:
                svg = get(RAW_SVG + fname)
                base_svg = keep_only(svg, base_layer)
                (OUT / "maps" / f"{slug}.svg").write_text(base_svg, encoding="utf-8")
                entry["image"] = f"maps/{slug}.svg"
                floor_list.append({"name": base_floor_name(m, layers), "image": entry["image"]})
                for i, l in enumerate(layers):
                    if not l.get("svgLayer"):
                        # Étages seulement disponibles en tuiles (ex. Réserve 2e-5e).
                        if l.get("tilePath"):
                            f = {"name": l["name"], "tiles": l["tilePath"], "tileSize": l.get("tileSize") or 256}
                            if layer_ylim(l):
                                f["ylim"] = layer_ylim(l)
                            floor_list.append(f)
                        continue
                    sub = keep_only(svg, l["svgLayer"])
                    fname_out = f"{slug}-f{i + 1}.svg"
                    (OUT / "maps" / fname_out).write_text(sub, encoding="utf-8")
                    f = {"name": l["name"], "image": f"maps/{fname_out}"}
                    if layer_ylim(l):
                        f["ylim"] = layer_ylim(l)
                    floor_list.append(f)
                report.append(f"{slug}: svg ok ({len(base_svg) // 1024} Ko) + {len(floor_list) - 1} étage(s)")
            except Exception as e:
                report.append(f"{slug}: ÉCHEC svg ({e})")
        elif tile_path:
            entry["tiles"] = tile_path
            entry["tileSize"] = m.get("tileSize", 256)
            used_base = False
            base_f = {"name": base_floor_name(m, layers), "tiles": tile_path, "tileSize": entry["tileSize"]}
            floor_list.append(base_f)
            for l in layers:
                if l.get("tilePath") == tile_path:
                    used_base = True
                    continue
                if not l.get("tilePath"):
                    continue
                f = {"name": l["name"], "tiles": l["tilePath"], "tileSize": l.get("tileSize") or entry["tileSize"]}
                if layer_ylim(l):
                    f["ylim"] = layer_ylim(l)
                floor_list.append(f)
            report.append(f"{slug}: tuiles distantes ({len(floor_list)} étage(s))")
        else:
            report.append(f"{slug}: IGNORÉE (ni SVG ni tuiles)")
            continue

        if len(floor_list) > 1:
            entry["floors"] = floor_list
        out.append(entry)
    (OUT / "maps.json").write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print("\n".join(report))


if __name__ == "__main__":
    main()
