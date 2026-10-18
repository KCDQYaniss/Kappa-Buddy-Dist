//! Conversion des données brutes de json.tarkov.dev vers le format interne de l'app.
//!
//! Ce que l'on sait des fichiers (vérifié dans du code qui les consomme pour de vrai) :
//! * enveloppe `{"data": {...}}` ; les listes sont parfois des tableaux, parfois des objets indexés par id ;
//! * les textes (noms, descriptions) sont des **clés de traduction** ; les vraies chaînes sont dans le fichier
//!   `<chemin>_<langue>` (`{"data": {"<clé>": "<texte>"}}`) ;
//! * les références entre fichiers sont des identifiants (carte d'une zone, quête prérequise, objet au sol...).
//!
//! Tout est volontairement tolérant : un champ absent, nul ou d'un type inattendu ne fait jamais échouer
//! le téléchargement, il est simplement ignoré.

use serde::de::{Deserializer, IgnoredAny, MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::collections::HashSet;
use std::fmt;
use std::marker::PhantomData;

/* ---------- Désérialisation tolérante et sans copie intermédiaire ---------- */

/// Liste d'éléments, que le JSON soit un tableau ou un objet indexé par id. `null` = liste vide.
pub struct ListOrMap<T>(pub Vec<T>);
impl<T> Default for ListOrMap<T> {
    fn default() -> Self {
        ListOrMap(Vec::new())
    }
}
struct LmVisitor<T>(PhantomData<T>);
impl<'de, T: Deserialize<'de>> Visitor<'de> for LmVisitor<T> {
    type Value = ListOrMap<T>;
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("une liste ou un objet d'éléments")
    }
    fn visit_seq<A: SeqAccess<'de>>(self, mut a: A) -> Result<Self::Value, A::Error> {
        let mut v = Vec::with_capacity(a.size_hint().unwrap_or(0).min(100_000));
        while let Some(x) = a.next_element()? {
            v.push(x);
        }
        Ok(ListOrMap(v))
    }
    fn visit_map<A: MapAccess<'de>>(self, mut a: A) -> Result<Self::Value, A::Error> {
        let mut v = Vec::new();
        while let Some((_k, x)) = a.next_entry::<IgnoredAny, T>()? {
            v.push(x);
        }
        Ok(ListOrMap(v))
    }
    fn visit_unit<E>(self) -> Result<Self::Value, E> {
        Ok(ListOrMap(Vec::new()))
    }
    fn visit_none<E>(self) -> Result<Self::Value, E> {
        Ok(ListOrMap(Vec::new()))
    }
}
impl<'de, T: Deserialize<'de>> Deserialize<'de> for ListOrMap<T> {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        d.deserialize_any(LmVisitor(PhantomData))
    }
}

/// `null` (ou absent) devient la valeur par défaut.
fn nullable<'de, D, T>(d: D) -> Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de> + Default,
{
    Ok(Option::<T>::deserialize(d)?.unwrap_or_default())
}

/// Texte lu depuis n'importe quel scalaire JSON.
#[derive(Default)]
pub struct Lax(pub String);
struct LaxVisitor;
impl<'de> Visitor<'de> for LaxVisitor {
    type Value = Lax;
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("un texte ou un nombre")
    }
    fn visit_str<E>(self, v: &str) -> Result<Lax, E> {
        Ok(Lax(v.to_string()))
    }
    fn visit_string<E>(self, v: String) -> Result<Lax, E> {
        Ok(Lax(v))
    }
    fn visit_i64<E>(self, v: i64) -> Result<Lax, E> {
        Ok(Lax(v.to_string()))
    }
    fn visit_u64<E>(self, v: u64) -> Result<Lax, E> {
        Ok(Lax(v.to_string()))
    }
    fn visit_f64<E>(self, v: f64) -> Result<Lax, E> {
        Ok(Lax(v.to_string()))
    }
    fn visit_bool<E>(self, v: bool) -> Result<Lax, E> {
        Ok(Lax(v.to_string()))
    }
    fn visit_unit<E>(self) -> Result<Lax, E> {
        Ok(Lax(String::new()))
    }
    fn visit_none<E>(self) -> Result<Lax, E> {
        Ok(Lax(String::new()))
    }
    fn visit_some<D: Deserializer<'de>>(self, d: D) -> Result<Lax, D::Error> {
        d.deserialize_any(LaxVisitor)
    }
    fn visit_seq<A: SeqAccess<'de>>(self, mut a: A) -> Result<Lax, A::Error> {
        while a.next_element::<IgnoredAny>()?.is_some() {}
        Ok(Lax(String::new()))
    }
    fn visit_map<A: MapAccess<'de>>(self, mut a: A) -> Result<Lax, A::Error> {
        while a.next_entry::<IgnoredAny, IgnoredAny>()?.is_some() {}
        Ok(Lax(String::new()))
    }
}
impl<'de> Deserialize<'de> for Lax {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        d.deserialize_any(LaxVisitor)
    }
}

#[derive(Deserialize)]
pub struct Envelope<D> {
    pub data: D,
}

/// Table de traduction : clé -> texte.
pub type Table = HashMap<String, String>;
pub fn table_from(raw: HashMap<String, Lax>) -> Table {
    raw.into_iter().map(|(k, v)| (k, v.0)).filter(|(_, v)| !v.is_empty()).collect()
}
fn tr(t: &Table, key: Option<&str>) -> Option<String> {
    t.get(key?).cloned()
}

/* ---------- Types bruts ---------- */

#[derive(Deserialize, Clone, Copy, Serialize, Debug)]
pub struct Pos {
    #[serde(default, deserialize_with = "nullable")]
    pub x: f64,
    #[serde(default, deserialize_with = "nullable")]
    pub y: f64,
    #[serde(default, deserialize_with = "nullable")]
    pub z: f64,
}

#[derive(Deserialize, Default)]
pub struct RawSpawn {
    pub position: Option<Pos>,
    #[serde(default, deserialize_with = "nullable")]
    pub sides: Vec<String>,
    #[serde(default, deserialize_with = "nullable")]
    pub categories: Vec<String>,
    #[serde(default, rename = "zoneName")]
    pub zone_name: Option<String>,
}
#[derive(Deserialize, Default)]
pub struct RawExtract {
    pub id: Option<String>,
    pub name: Option<String>,
    pub faction: Option<String>,
    pub position: Option<Pos>,
    /// Interrupteurs à actionner pour ouvrir cette extraction (noms de lieux).
    #[serde(default, deserialize_with = "nullable")]
    pub switches: Vec<String>,
    /// Contour de la zone d'extraction, s'il existe.
    #[serde(default, deserialize_with = "nullable")]
    pub outline: Vec<Pos>,
}
#[derive(Deserialize, Default)]
pub struct RawTransit {
    pub id: Option<String>,
    pub description: Option<String>,
    pub position: Option<Pos>,
}
#[derive(Deserialize, Default)]
pub struct RawLoose {
    pub position: Option<Pos>,
    #[serde(default, deserialize_with = "nullable")]
    pub items: Vec<Value>,
}
#[derive(Deserialize, Default)]
pub struct RawContainer {
    pub position: Option<Pos>,
    #[serde(default, rename = "lootContainer")]
    pub template: Value,
}
/// Fiche d'un conteneur, fournie par l'API au niveau global (`data.lootContainers`).
/// `name` est une clé de la table de traduction des cartes (« <id> Name ») et
/// `normalizedName` un libellé anglais lisible (« duffle-bag »).
#[derive(Deserialize, Default)]
pub struct RawContainerInfo {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default, rename = "normalizedName")]
    pub normalized_name: Option<String>,
}
#[derive(Deserialize, Default)]
pub struct RawMap {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default, rename = "normalizedName")]
    pub normalized_name: Option<String>,
    #[serde(default, rename = "nameId")]
    pub name_id: Option<String>,
    #[serde(default, rename = "raidDuration")]
    pub raid_duration: Value,
    #[serde(default)]
    pub players: Value,
    #[serde(default, deserialize_with = "nullable")]
    pub spawns: Vec<RawSpawn>,
    #[serde(default, deserialize_with = "nullable")]
    pub extracts: Vec<RawExtract>,
    #[serde(default, deserialize_with = "nullable")]
    pub transits: Vec<RawTransit>,
    #[serde(default, rename = "lootLoose", deserialize_with = "nullable")]
    pub loot_loose: Vec<RawLoose>,
    #[serde(default, rename = "lootContainers", deserialize_with = "nullable")]
    pub loot_containers: Vec<RawContainer>,
    #[serde(default, rename = "stationaryWeapons", deserialize_with = "nullable")]
    pub stationary: Vec<Value>,
    #[serde(default, deserialize_with = "nullable")]
    pub bosses: Vec<Value>,
    /// Verrous des portes et coffres (`{ id, lockType, key, needsPower, position }`).
    #[serde(default, deserialize_with = "nullable")]
    pub locks: Vec<Value>,
}
#[derive(Deserialize, Default)]
pub struct MapsDoc {
    #[serde(default)]
    pub maps: ListOrMap<RawMap>,
    #[serde(default)]
    pub bosses: ListOrMap<Value>,
    /// Référentiel global des conteneurs de loot (id → libellé / clé de traduction).
    #[serde(default, rename = "lootContainers")]
    pub loot_containers: ListOrMap<RawContainerInfo>,
}

#[derive(Deserialize, Default, Clone)]
pub struct SellFor {
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub price: Option<f64>,
}

#[derive(Deserialize, Default)]
pub struct RawItem {
    pub id: Option<String>,
    pub name: Option<String>,
    #[serde(default, rename = "shortName")]
    pub short_name: Option<String>,
    #[serde(default, rename = "normalizedName")]
    pub normalized_name: Option<String>,
    #[serde(default, rename = "iconLink")]
    pub icon_link: Option<String>,
    #[serde(default, rename = "basePrice")]
    pub base_price: Option<f64>,
    #[serde(default, rename = "avg24hPrice")]
    pub avg24h: Option<f64>,
    #[serde(default, rename = "lastLowPrice")]
    pub last_low: Option<f64>,
    #[serde(default, rename = "low24hPrice")]
    pub low24h: Option<f64>,
    /// Prix de vente : marché (flea) et marchands. Sert à indiquer où vendre au meilleur prix.
    #[serde(default, rename = "sellFor")]
    pub sell_for: Vec<SellFor>,
    pub width: Option<f64>,
    pub height: Option<f64>,
    #[serde(default, deserialize_with = "nullable")]
    pub types: Vec<String>,
    #[serde(default)]
    pub category: Value,
    #[serde(default)]
    pub categories: Value,
}
#[derive(Deserialize, Default)]
pub struct ItemsDoc {
    #[serde(default)]
    pub items: ListOrMap<RawItem>,
    #[serde(default, rename = "itemCategories")]
    pub item_categories: ListOrMap<Value>,
    #[serde(default)]
    pub categories: ListOrMap<Value>,
}
#[derive(Deserialize, Default)]
pub struct TasksDoc {
    #[serde(default)]
    pub tasks: ListOrMap<Value>,
}

/* ---------- Aides ---------- */

/// Identifiant d'une référence : soit la chaîne elle-même, soit un objet `{ "id": ... }`.
pub fn id_of(v: &Value) -> Option<String> {
    match v {
        Value::String(s) if !s.is_empty() => Some(s.clone()),
        Value::Object(o) => o.get("id").and_then(Value::as_str).map(str::to_string),
        _ => None,
    }
}
fn s(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(Value::as_str).map(str::to_string)
}
fn pos_json(p: &Option<Pos>) -> Value {
    p.as_ref().map_or(Value::Null, |p| json!({ "x": p.x, "y": p.y, "z": p.z }))
}
fn pos_value(v: Option<&Value>) -> Option<Value> {
    let o = v?.as_object()?;
    let n = |k: &str| o.get(k).and_then(Value::as_f64);
    Some(json!({ "x": n("x")?, "y": n("y").unwrap_or(0.0), "z": n("z")? }))
}
fn pretty(slug: &str) -> String {
    let mut out = slug.replace('-', " ");
    if let Some(c) = out.get(0..1) {
        out = c.to_uppercase() + &out[1..];
    }
    out
}

/// Statistiques de qualité de la conversion, affichées dans le diagnostic.
#[derive(Default, Serialize, Clone, Debug)]
pub struct Quality {
    pub tasks: usize,
    pub tasks_with_trader: usize,
    pub objectives: usize,
    pub objectives_with_zone: usize,
    pub maps: usize,
    pub extracts: usize,
    pub containers: usize,
    pub containers_named: usize,
    pub loose_points: usize,
    pub locks: usize,
    pub items: usize,
    pub items_with_category: usize,
    pub items_with_price: usize,
    pub hideout_stations: usize,
    pub hideout_items: usize,
}

/* ---------- Objets ---------- */

pub struct ItemsOut {
    pub items: Value,
    pub names: HashMap<String, String>,
}

fn category_names(doc: &ItemsDoc, t: &Table) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for c in doc.item_categories.0.iter().chain(doc.categories.0.iter()) {
        if let Some(id) = id_of(c) {
            let name = tr(t, c.get("name").and_then(Value::as_str)).or_else(|| s(c, "normalizedName").map(|n| pretty(&n)));
            if let Some(n) = name {
                out.insert(id, n);
            }
        }
    }
    out
}

pub fn convert_items(doc: &ItemsDoc, t: &Table, q: &mut Quality) -> ItemsOut {
    let cats = category_names(doc, t);
    let mut names = HashMap::new();
    let mut out = Vec::with_capacity(doc.items.0.len());
    for it in &doc.items.0 {
        let Some(id) = it.id.clone() else { continue };
        let name = tr(t, it.name.as_deref())
            .or_else(|| it.normalized_name.as_deref().map(pretty))
            .unwrap_or_else(|| id.clone());
        let short = tr(t, it.short_name.as_deref()).unwrap_or_else(|| name.clone());
        // Catégorie : référence (`category`), sinon première de `categories`, sinon rien.
        let cat = id_of(&it.category)
            .or_else(|| it.categories.as_array().and_then(|a| a.first()).and_then(id_of))
            .and_then(|cid| cats.get(&cid).cloned())
            .or_else(|| it.category.get("name").and_then(Value::as_str).and_then(|k| tr(t, Some(k))));
        if cat.is_some() {
            q.items_with_category += 1;
        }
        let price = it.avg24h.or(it.last_low).or(it.low24h);
        if price.is_some() || it.base_price.is_some() {
            q.items_with_price += 1;
        }
        names.insert(id.clone(), name.clone());
        let sell: Vec<Value> = it
            .sell_for
            .iter()
            .filter_map(|s| s.price.map(|p| json!({ "source": s.source, "price": p })))
            .collect();
        out.push(json!({
            "id": id, "name": name, "shortName": short, "normalizedName": it.normalized_name,
            "iconLink": it.icon_link, "basePrice": it.base_price, "avg24hPrice": price, "sellFor": sell,
            "width": it.width.unwrap_or(1.0), "height": it.height.unwrap_or(1.0),
            "types": it.types, "category": cat.map(|n| json!({ "name": n })), "wikiLink": Value::Null,
        }));
    }
    q.items = out.len();
    ItemsOut { items: Value::Array(out), names }
}

/* ---------- Hideout ---------- */

/// Convertit les stations du hideout : niveau par niveau, avec les objets à réunir,
/// les bonus débloqués, la description, le temps de construction et les prérequis.
/// L'interface en déduit « cet objet sert au hideout » (station + niveau + quantité).
pub fn convert_hideout(data: &Value, t: &Table, q: &mut Quality) -> Value {
    let list: Vec<&Value> = match data {
        Value::Array(a) => a.iter().collect(),
        Value::Object(o) => ["hideoutStations", "stations"]
            .iter()
            .find_map(|k| o.get(*k).and_then(Value::as_array))
            .map(|a| a.iter().collect())
            .unwrap_or_else(|| o.values().collect()),
        _ => vec![],
    };
    let mut out = Vec::new();
    let mut item_total = 0usize;
    for st in list {
        let Some(id) = id_of(st) else { continue };
        let name = tr(t, st.get("name").and_then(Value::as_str))
            .or_else(|| s(st, "normalizedName").map(|n| pretty(&n)))
            .unwrap_or_else(|| id.clone());
        let mut levels = Vec::new();
        for lv in st.get("levels").and_then(Value::as_array).into_iter().flatten() {
            let level = lv.get("level").and_then(Value::as_i64).unwrap_or(1);
            let mut items = Vec::new();
            for r in lv.get("itemRequirements").and_then(Value::as_array).into_iter().flatten() {
                let Some(iid) = id_of(r.get("item").unwrap_or(&Value::Null)) else { continue };
                let count = r.get("count").and_then(Value::as_i64).unwrap_or(1);
                let fir = r.get("attributes").and_then(|a| a.get("foundInRaid")).and_then(Value::as_bool).unwrap_or(false);
                items.push(json!({ "id": iid, "count": count, "fir": fir }));
            }
            // Bonus débloqués à ce niveau (passifs et de production).
            let bonuses: Vec<Value> = lv
                .get("bonuses")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|b| {
                    let btype = s(b, "type")?;
                    Some(json!({
                        "type": btype,
                        "name": s(b, "name").unwrap_or_default(),
                        "value": b.get("value").cloned().unwrap_or(Value::Null),
                        "passive": b.get("passive").and_then(Value::as_bool).unwrap_or(true),
                        "production": b.get("production").and_then(Value::as_bool).unwrap_or(false),
                        "skill": b.get("skill").and_then(Value::as_str).map(|s| s.to_string()),
                    }))
                })
                .collect();
            // Prérequis : compétences, marchands, autres stations.
            let skills: Vec<Value> = lv
                .get("skillRequirements")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|r| Some(json!({ "skill": s(r, "skill")?, "level": r.get("level").and_then(Value::as_i64).unwrap_or(1) })))
                .collect();
            let traders: Vec<Value> = lv
                .get("traderRequirements")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|r| Some(json!({ "trader": id_of(r.get("trader").unwrap_or(&Value::Null))?, "level": r.get("level").and_then(Value::as_i64).unwrap_or(1) })))
                .collect();
            let stations_req: Vec<Value> = lv
                .get("stationLevelRequirements")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|r| Some(json!({ "station": id_of(r.get("station").unwrap_or(&Value::Null))?, "level": r.get("level").and_then(Value::as_i64).unwrap_or(1) })))
                .collect();
            if !items.is_empty() || !bonuses.is_empty() {
                item_total += items.len();
                levels.push(json!({
                    "level": level,
                    "items": items,
                    "bonuses": bonuses,
                    "description": tr(t, lv.get("description").and_then(Value::as_str)).unwrap_or_default(),
                    "constructionTime": lv.get("constructionTime").and_then(Value::as_i64).unwrap_or(0),
                    "skills": skills,
                    "traders": traders,
                    "stations": stations_req,
                }));
            }
        }
        if levels.is_empty() {
            continue;
        }
        q.hideout_stations += 1;
        out.push(json!({
            "id": id, "name": name, "normalizedName": s(st, "normalizedName"),
            "imageLink": st.get("imageLink").and_then(Value::as_str).map(|s| s.to_string()),
            "levels": levels,
        }));
    }
    q.hideout_items += item_total;
    Value::Array(out)
}

/* ---------- Marchands ---------- */

/// `data` est soit `{ "traders": [...] }`, soit directement la liste (ou l'objet indexé) des marchands.
pub fn convert_traders(data: &Value, t: &Table) -> HashMap<String, Value> {
    let list: Vec<&Value> = match data.get("traders").unwrap_or(data) {
        Value::Array(a) => a.iter().collect(),
        Value::Object(o) => o.values().collect(),
        _ => vec![],
    };
    let mut out = HashMap::new();
    for tr_ in list {
        let Some(id) = id_of(tr_) else { continue };
        let slug = s(tr_, "normalizedName").unwrap_or_else(|| id.clone());
        let name = tr(t, tr_.get("name").and_then(Value::as_str)).unwrap_or_else(|| pretty(&slug));
        let img = s(tr_, "imageLink").or_else(|| s(tr_, "image4xLink"));
        out.insert(id.clone(), json!({ "id": id, "name": name, "normalizedName": slug, "imageLink": img }));
    }
    out
}

/* ---------- Cartes ---------- */

pub struct MapsOut {
    pub maps: Value,
    /// identifiant de carte -> slug (`customs`...)
    pub slugs: HashMap<String, String>,
}

pub fn convert_maps(doc: &MapsDoc, t: &Table, item_names: &HashMap<String, String>, container_nodes: &HashMap<String, String>, q: &mut Quality) -> MapsOut {
    let mut slugs = HashMap::new();
    for m in &doc.maps.0 {
        if let (Some(id), Some(n)) = (&m.id, &m.normalized_name) {
            slugs.insert(id.clone(), n.clone());
        }
    }
    let boss_names: HashMap<String, String> = doc
        .bosses
        .0
        .iter()
        .filter_map(|b| Some((id_of(b)?, tr(t, b.get("name").and_then(Value::as_str)).or_else(|| s(b, "normalizedName").map(|n| pretty(&n)))?)))
        .collect();

    // Libellés officiels des conteneurs fournis par l'API : id → clé de traduction (« <id> Name »)
    // et id → libellé anglais de repli (« duffle-bag »). Bien plus fiable que la devinette sur l'id.
    let mut container_label: HashMap<String, String> = HashMap::new();
    let mut container_slug: HashMap<String, String> = HashMap::new();
    for c in &doc.loot_containers.0 {
        let Some(id) = c.id.clone() else { continue };
        if let Some(k) = c.name.clone() {
            container_label.insert(id.clone(), k);
        }
        if let Some(n) = c.normalized_name.clone() {
            container_slug.insert(id, n);
        }
    }

    let mut maps = Vec::new();
    for m in &doc.maps.0 {
        let Some(slug) = m.normalized_name.clone() else { continue };
        let container_name = |tpl: &Value| -> Option<(String, String)> {
            let id = id_of(tpl)?;
            let name = container_label.get(&id).and_then(|k| t.get(k))
                .or_else(|| t.get(&format!("{id} Name")))
                .or_else(|| t.get(&format!("{id} name")))
                .or_else(|| item_names.get(&id))
                .or_else(|| container_nodes.get(&id))
                .cloned()
                .or_else(|| container_slug.get(&id).map(|n| pretty(n)));
            Some((id, name.unwrap_or_default()))
        };
        let mut containers = Vec::new();
        for c in &m.loot_containers {
            let (Some(p), Some((id, name))) = (&c.position, container_name(&c.template)) else { continue };
            q.containers += 1;
            if !name.is_empty() {
                q.containers_named += 1;
            }
            let shown = if name.is_empty() { format!("Conteneur ({})", id.get(..6).unwrap_or(&id)) } else { name };
            containers.push(json!({ "lootContainer": { "id": id, "name": shown, "normalizedName": id }, "position": p }));
        }
        let loose: Vec<Value> = m
            .loot_loose
            .iter()
            .filter_map(|l| {
                let p = l.position.as_ref()?;
                let items: Vec<Value> = l.items.iter().filter_map(id_of).map(|id| json!({ "id": id })).collect();
                Some(json!({ "items": items, "position": p }))
            })
            .collect();
        q.loose_points += loose.len();
        let extracts: Vec<Value> = m
            .extracts
            .iter()
            .filter(|e| e.position.is_some())
            .map(|e| {
                let outline: Vec<Value> = e.outline.iter().map(|p| json!({ "x": p.x, "y": p.y, "z": p.z })).collect();
                json!({
                    "id": e.id,
                    "name": tr(t, e.name.as_deref()).or_else(|| e.name.clone()),
                    "faction": e.faction,
                    "position": pos_json(&e.position),
                    "outline": if outline.is_empty() { Value::Null } else { Value::Array(outline) },
                    "switches": e.switches,
                })
            })
            .collect();
        q.extracts += extracts.len();
        let spawns: Vec<Value> = m
            .spawns
            .iter()
            .filter(|s_| s_.position.is_some())
            .map(|s_| json!({ "zoneName": s_.zone_name, "sides": s_.sides, "categories": s_.categories, "position": pos_json(&s_.position) }))
            .collect();
        let transits: Vec<Value> = m
            .transits
            .iter()
            .filter(|x| x.position.is_some())
            .map(|x| json!({ "id": x.id, "description": tr(t, x.description.as_deref()), "conditions": Value::Null, "position": pos_json(&x.position) }))
            .collect();
        // Verrous : portes et coffres fermés à clé. `key` est l'objet-clé requis (identifiant et nom
        // résolus ici pour l'interface), `needsPower` indique une alimentation électrique nécessaire.
        let locks: Vec<Value> = m
            .locks
            .iter()
            .filter_map(|l| {
                let p = pos_value(l.get("position"))?;
                // La clé est un identifiant simple ; on tolère aussi une référence `{ id }`.
                let key_id = l.get("key").and_then(|k| match k {
                    Value::String(s) => Some(s.clone()),
                    Value::Object(_) => id_of(k),
                    _ => None,
                });
                let key_name = key_id.as_ref().and_then(|id| item_names.get(id)).cloned();
                Some(json!({
                    "id": l.get("id").cloned().unwrap_or(Value::Null),
                    "lockType": l.get("lockType").cloned().unwrap_or(json!("door")),
                    "key": match &key_id { Some(id) => json!({ "id": id, "name": key_name }), None => Value::Null },
                    "needsPower": l.get("needsPower").cloned().unwrap_or(json!(false)),
                    "position": p,
                }))
            })
            .collect();
        q.locks += locks.len();
        let stationary: Vec<Value> = m
            .stationary
            .iter()
            .filter_map(|w| {
                let p = pos_value(w.get("position"))?;
                let name = w.get("stationaryWeapon").and_then(id_of).and_then(|id| t.get(&format!("{id} name")).cloned().or_else(|| item_names.get(&id).cloned()));
                Some(json!({ "stationaryWeapon": { "name": name.unwrap_or_else(|| "Arme fixe".into()) }, "position": p }))
            })
            .collect();
        let bosses: Vec<Value> = m
            .bosses
            .iter()
            .filter_map(|b| {
                let name = b.get("boss").and_then(id_of).and_then(|id| boss_names.get(&id).cloned()).or_else(|| b.get("name").and_then(Value::as_str).and_then(|k| tr(t, Some(k))))?;
                let locs: Vec<Value> = b
                    .get("spawnLocations")
                    .and_then(Value::as_array)
                    .map(|a| a.iter().filter_map(|l| Some(json!({ "name": tr(t, l.get("name").and_then(Value::as_str))?, "chance": l.get("chance").cloned().unwrap_or(Value::Null) }))).collect())
                    .unwrap_or_default();
                Some(json!({ "boss": { "name": name, "normalizedName": name }, "spawnChance": b.get("spawnChance").cloned().unwrap_or(json!(0)), "spawnLocations": locs }))
            })
            .collect();
        maps.push(json!({
            "normalizedName": slug,
            "name": tr(t, m.name.as_deref()).unwrap_or_else(|| pretty(&slug)),
            "nameId": m.name_id, "raidDuration": m.raid_duration, "players": m.players,
            "extracts": extracts, "transits": transits, "spawns": spawns,
            "lootContainers": containers, "lootLoose": loose, "stationaryWeapons": stationary, "bosses": bosses,
            "locks": locks,
        }));
    }
    q.maps = maps.len();
    MapsOut { maps: Value::Array(maps), slugs }
}

/* ---------- Quêtes ---------- */

fn type_label(t: &str) -> &'static str {
    match t {
        "visit" => "Rejoindre cet endroit",
        "mark" => "Placer un marqueur ici",
        "shoot" => "Éliminer des cibles",
        "findQuestItem" => "Trouver l'objet de quête",
        "giveQuestItem" => "Remettre l'objet de quête",
        "plantItem" | "plantQuestItem" => "Placer l'objet ici",
        "findItem" => "Trouver l'objet",
        "giveItem" => "Remettre l'objet",
        "useItem" => "Utiliser l'objet ici",
        "extract" => "Extraire",
        _ => "Objectif",
    }
}

pub fn convert_tasks(raw: &[Value], slugs: &HashMap<String, String>, traders: &HashMap<String, Value>, t: &Table, q: &mut Quality, removed: &HashSet<String>) -> Value {
    let slug_of = |v: &Value| id_of(v).and_then(|id| slugs.get(&id).cloned());
    let norm = |slug: String| json!({ "normalizedName": slug });
    let mut out = Vec::new();
    for task in raw {
        let Some(id) = s(task, "id") else { continue };
        // Quête retirée du jeu : sa page wiki est classée « Historical content ».
        if let Some(link) = task.get("wikiLink").and_then(Value::as_str) {
            if let Some(title) = crate::wiki::page_title(link) {
                if removed.contains(&title) { continue }
            }
        }
        let normalized = s(task, "normalizedName");
        let name = tr(t, task.get("name").and_then(Value::as_str)).or_else(|| normalized.clone().map(|n| pretty(&n))).unwrap_or_else(|| id.clone());
        let trader = task.get("trader").and_then(id_of).and_then(|tid| traders.get(&tid).cloned());
        if trader.is_some() {
            q.tasks_with_trader += 1;
        }
        let mut objectives = Vec::new();
        for o in task.get("objectives").and_then(Value::as_array).into_iter().flatten() {
            let Some(oid) = s(o, "id") else { continue };
            let typ = s(o, "type").unwrap_or_default();
            let description = tr(t, o.get("description").and_then(Value::as_str)).unwrap_or_else(|| type_label(&typ).to_string());
            let maps: Vec<Value> = o.get("maps").and_then(Value::as_array).into_iter().flatten().filter_map(|m| slug_of(m)).map(norm).collect();
            let zones: Vec<Value> = o
                .get("zones")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|z| {
                    let p = pos_value(z.get("position"))?;
                    let outline = z.get("outline").and_then(Value::as_array).map(|a| a.iter().filter_map(|p| pos_value(Some(p))).collect::<Vec<_>>());
                    Some(json!({ "map": z.get("map").and_then(|m| slug_of(m)).map(norm), "position": p, "outline": outline, "top": z.get("top"), "bottom": z.get("bottom") }))
                })
                .collect();
            if !zones.is_empty() {
                q.objectives_with_zone += 1;
            }
            let refs = |k: &str| -> Vec<Value> { o.get(k).and_then(Value::as_array).into_iter().flatten().filter_map(id_of).map(|i| json!({ "id": i })).collect() };
            let locations: Vec<Value> = o
                .get("possibleLocations")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|l| {
                    let slug = l.get("map").and_then(|m| slug_of(m))?;
                    let pts: Vec<Value> = l.get("positions").and_then(Value::as_array).into_iter().flatten().filter_map(|p| pos_value(Some(p))).collect();
                    Some(json!({ "map": norm(slug), "positions": pts }))
                })
                .collect();
            q.objectives += 1;
            objectives.push(json!({
                "id": oid, "type": typ, "description": description, "optional": o.get("optional").and_then(Value::as_bool).unwrap_or(false),
                "maps": maps, "zones": zones, "items": refs("items"), "useAny": refs("useAny"),
                "markerItem": o.get("markerItem").and_then(id_of).map(|i| json!({ "id": i })),
                "count": o.get("count").and_then(Value::as_f64), "foundInRaid": o.get("foundInRaid").and_then(Value::as_bool),
                "possibleLocations": locations, "exitName": tr(t, o.get("exitName").and_then(Value::as_str)).or_else(|| s(o, "exitName")),
            }));
        }
        let requirements: Vec<Value> = task
            .get("taskRequirements")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|r| {
                let tid = r.get("task").and_then(id_of)?;
                Some(json!({ "task": { "id": tid }, "status": r.get("status").cloned().unwrap_or(json!([])) }))
            })
            .collect();
        out.push(json!({
            "id": id, "name": name, "normalizedName": normalized, "trader": trader,
            "map": task.get("map").and_then(|m| slug_of(m)).map(norm),
            "minPlayerLevel": task.get("minPlayerLevel"), "experience": task.get("experience"), "wikiLink": task.get("wikiLink"),
            "kappaRequired": task.get("kappaRequired").and_then(Value::as_bool).unwrap_or(false),
            "lightkeeperRequired": task.get("lightkeeperRequired").and_then(Value::as_bool).unwrap_or(false),
            "factionName": task.get("factionName"), "restartable": task.get("restartable"),
            "taskRequirements": requirements, "objectives": objectives,
        }));
    }
    q.tasks = out.len();
    Value::Array(out)
}

/// Assemble le jeu de données complet tel que l'interface le lit.
pub fn assemble(tasks: Value, maps: Value, items: Value, hideout: Value, lang: &str, fetched_at: u64, q: &Quality) -> Value {
    let mut o = Map::new();
    o.insert("version".into(), json!(2));
    o.insert("source".into(), json!("json.tarkov.dev"));
    o.insert("fetchedAt".into(), json!(fetched_at));
    o.insert("lang".into(), json!(lang));
    o.insert("tasks".into(), tasks);
    o.insert("maps".into(), maps);
    o.insert("items".into(), items);
    o.insert("hideout".into(), hideout);
    o.insert("quality".into(), serde_json::to_value(q).unwrap_or(Value::Null));
    Value::Object(o)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn table(pairs: &[(&str, &str)]) -> Table {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn liste_ou_objet_indexe() {
        let a: Envelope<TasksDoc> = serde_json::from_str(r#"{"data":{"tasks":[{"id":"a"},{"id":"b"}]}}"#).unwrap();
        let b: Envelope<TasksDoc> = serde_json::from_str(r#"{"data":{"tasks":{"a":{"id":"a"},"b":{"id":"b"}}}}"#).unwrap();
        let c: Envelope<TasksDoc> = serde_json::from_str(r#"{"data":{"tasks":null}}"#).unwrap();
        assert_eq!((a.data.tasks.0.len(), b.data.tasks.0.len(), c.data.tasks.0.len()), (2, 2, 0));
    }

    #[test]
    fn traduction_tolerante() {
        let t: Envelope<HashMap<String, Lax>> = serde_json::from_str(r#"{"data":{"k1 name":"Bouteille","n":12,"nul":null,"o":{"x":1}}}"#).unwrap();
        let t = table_from(t.data);
        assert_eq!(t.get("k1 name").map(String::as_str), Some("Bouteille"));
        assert_eq!(t.get("n").map(String::as_str), Some("12"));
        assert!(!t.contains_key("nul") && !t.contains_key("o"));
    }

    fn sample() -> (ItemsDoc, MapsDoc, Vec<Value>, Value) {
        let items: Envelope<ItemsDoc> = serde_json::from_str(
            r#"{"data":{"items":{"i1":{"id":"i1","name":"i1 name","shortName":"i1 shortName","normalizedName":"water-bottle","iconLink":"https://x/i1.webp","basePrice":3000,"avg24hPrice":null,"lastLowPrice":4200,"sellFor":[{"source":"prapor","price":3000,"currency":"RUB"},{"source":"flea-market","price":4500,"currency":"RUB"}],"width":1,"height":2,"types":["loot"],"category":"c1"},
              "i2":{"id":"i2","name":"i2 name","normalizedName":"weapon-box","types":null,"category":{"id":"c9"}}},
              "itemCategories":[{"id":"c1","name":"c1 name","normalizedName":"food-drink"}]}}"#,
        )
        .unwrap();
        let maps: Envelope<MapsDoc> = serde_json::from_str(
            r#"{"data":{"maps":[{"id":"m1","name":"m1 name","normalizedName":"customs","raidDuration":45,"players":"8-12",
              "spawns":[{"position":{"x":1,"y":2,"z":3},"sides":["pmc"],"categories":["player"],"zoneName":"z1"},{"position":null,"sides":null}],
              "extracts":[{"id":"e1","name":"e1 name","faction":"pmc","position":{"x":5,"y":0,"z":6},"switches":["s1"],"outline":[{"x":5,"y":0,"z":6},{"x":6,"y":0,"z":6},{"x":6,"y":0,"z":7}]}],
              "transits":[{"id":"t1","description":"t1 desc","map":"m2","position":{"x":7,"y":0,"z":8}}],
              "lootLoose":[{"position":{"x":9,"y":1,"z":2},"items":["i1","i2",{"id":"i3"}]},{"position":null,"items":null}],
              "lootContainers":[{"lootContainer":"i2","position":{"x":3,"y":3,"z":3}},{"lootContainer":"zzzzzzzzzz","position":{"x":4,"y":4,"z":4}}],
              "stationaryWeapons":[{"stationaryWeapon":"i1","position":{"x":1,"y":1,"z":1}}],
              "bosses":[{"boss":"b1","spawnChance":0.35,"spawnLocations":[{"name":"loc1 name","chance":0.5}]}]},
              {"id":"m2","normalizedName":"woods"}],
              "bosses":[{"id":"b1","name":"b1 name","normalizedName":"reshala"}]}}"#,
        )
        .unwrap();
        let tasks = serde_json::json!({"tasks":{"t1":{
            "id":"t1","name":"t1 name","normalizedName":"debut","trader":"tr1","map":"m1","minPlayerLevel":1,"kappaRequired":true,
            "taskRequirements":[{"task":"t0","status":["complete"]},{"task":{"id":"t9"},"status":null}],
            "objectives":[
              {"id":"o1","type":"visit","description":"o1 description","zones":[{"map":"m1","position":{"x":1,"y":2,"z":3},"outline":[{"x":0,"y":0,"z":0},{"x":1,"y":0,"z":0},{"x":1,"y":0,"z":1}],"top":9,"bottom":-1}],"maps":["m1"]},
              {"id":"o2","type":"findItem","description":"zzz sans traduction","items":["i1",{"id":"i2"}],"count":3,"foundInRaid":true,"maps":["m1","m2"]},
              {"id":"o3","type":"findQuestItem","possibleLocations":[{"map":"m2","positions":[{"x":10,"y":0,"z":11}]}],"maps":[]},
              {"type":"visit"}
            ]}}});
        let traders = serde_json::json!({"data":{"traders":[{"id":"tr1","name":"tr1 name","normalizedName":"prapor","imageLink":"https://x/prapor.webp"}]}});
        (items.data, maps.data, TasksDoc::deserialize(tasks).unwrap().tasks.0, traders["data"].clone())
    }

    #[test]
    fn conversion_complete() {
        let (items, maps, tasks, traders_doc) = sample();
        let t = table(&[
            ("i1 name", "Bouteille d'eau"), ("i1 shortName", "Eau"), ("c1 name", "Nourriture"), ("i2 name", "Boîte à armes"),
            ("m1 name", "Customs"), ("e1 name", "ZB-1011"), ("t1 desc", "Vers Woods"), ("b1 name", "Reshala"), ("loc1 name", "Dortoirs"),
            ("t1 name", "Début du tournage"), ("o1 description", "Visitez la station"), ("tr1 name", "Prapor"),
        ]);
        let mut q = Quality::default();
        let it = convert_items(&items, &t, &mut q);
        let i1 = it.items.as_array().unwrap().iter().find(|i| i["id"] == "i1").unwrap();
        assert_eq!(i1["name"], "Bouteille d'eau");
        assert_eq!(i1["shortName"], "Eau");
        assert_eq!(i1["category"]["name"], "Nourriture");
        assert_eq!(i1["avg24hPrice"], 4200.0, "avg24h absent => repli sur lastLow");
        assert_eq!(i1["sellFor"][0]["source"], "prapor");
        assert_eq!(i1["sellFor"][1]["price"], 4500.0, "prix de vente par marchand conservés");
        let i2 = it.items.as_array().unwrap().iter().find(|i| i["id"] == "i2").unwrap();
        assert_eq!(i2["types"], serde_json::json!([]), "types nul => liste vide");
        assert!(i2["category"].is_null(), "catégorie inconnue => aucune (pas de plantage)");
        assert_eq!(i2["sellFor"], serde_json::json!([]), "pas de prix de vente => liste vide");

        let m = convert_maps(&maps, &t, &it.names, &HashMap::new(), &mut q);
        assert_eq!(m.slugs.get("m2").map(String::as_str), Some("woods"));
        let c = &m.maps[0];
        assert_eq!(c["name"], "Customs");
        assert_eq!(c["extracts"][0]["name"], "ZB-1011");
        assert_eq!(c["extracts"][0]["switches"], serde_json::json!(["s1"]), "interrupteurs conservés");
        assert_eq!(c["extracts"][0]["outline"].as_array().unwrap().len(), 3, "contour d'extraction conservé");
        assert_eq!(c["spawns"].as_array().unwrap().len(), 1, "spawn sans position ignoré");
        assert_eq!(c["transits"][0]["description"], "Vers Woods");
        let loose = c["lootLoose"].as_array().unwrap();
        assert_eq!(loose.len(), 1);
        assert_eq!(loose[0]["items"].as_array().unwrap().len(), 3, "objets en chaîne ou en objet");
        let cont = c["lootContainers"].as_array().unwrap();
        assert_eq!(cont[0]["lootContainer"]["name"], "Boîte à armes", "nom retrouvé via la table des objets");
        assert!(cont[1]["lootContainer"]["name"].as_str().unwrap().starts_with("Conteneur (zzzzzz)"), "nom inconnu => libellé de repli, regroupement conservé");
        assert_eq!(c["bosses"][0]["boss"]["name"], "Reshala");
        assert_eq!(c["bosses"][0]["spawnLocations"][0]["name"], "Dortoirs");
        assert_eq!(c["stationaryWeapons"][0]["stationaryWeapon"]["name"], "Bouteille d'eau");
        assert_eq!((q.containers, q.containers_named), (2, 1));

        let traders = convert_traders(&traders_doc, &t);
        assert_eq!(traders["tr1"]["name"], "Prapor");
        let out = convert_tasks(&tasks, &m.slugs, &traders, &t, &mut q, &HashSet::new());
        let task = &out[0];
        assert_eq!(task["name"], "Début du tournage");
        assert_eq!(task["trader"]["normalizedName"], "prapor");
        assert_eq!(task["map"]["normalizedName"], "customs");
        assert_eq!(task["taskRequirements"].as_array().unwrap().len(), 2);
        assert_eq!(task["taskRequirements"][0]["task"]["id"], "t0");
        let objs = task["objectives"].as_array().unwrap();
        assert_eq!(objs.len(), 3, "objectif sans id ignoré");
        assert_eq!(objs[0]["description"], "Visitez la station");
        assert_eq!(objs[0]["zones"][0]["map"]["normalizedName"], "customs");
        assert_eq!(objs[0]["zones"][0]["outline"].as_array().unwrap().len(), 3);
        assert_eq!(objs[1]["description"], "Trouver l'objet", "pas de traduction => libellé du type");
        assert_eq!(objs[1]["items"][1]["id"], "i2");
        assert_eq!(objs[1]["maps"].as_array().unwrap().len(), 2);
        assert_eq!(objs[1]["count"], 3.0);
        assert_eq!(objs[2]["possibleLocations"][0]["map"]["normalizedName"], "woods");
        assert_eq!((q.tasks, q.tasks_with_trader, q.objectives, q.objectives_with_zone), (1, 1, 3, 1));
    }

    #[test]
    fn marchands_en_liste_directe_ou_objet() {
        let t = table(&[("a name", "Prapor")]);
        let direct = serde_json::json!([{"id":"a","name":"a name","normalizedName":"prapor"}]);
        let objet = serde_json::json!({"a":{"id":"a","name":"a name","normalizedName":"prapor"}});
        assert_eq!(convert_traders(&direct, &t)["a"]["name"], "Prapor");
        assert_eq!(convert_traders(&objet, &t)["a"]["name"], "Prapor");
    }

    #[test]
    fn quete_retiree_masquee_par_wikilink() {
        // Deux quêtes : une valide, une dont la page wiki est « Historical content ».
        let raw = serde_json::json!([
            {"id":"ok","name":"ok name","normalizedName":"ok","wikiLink":"https://escapefromtarkov.fandom.com/wiki/Glory_to_CPSU","objectives":[]},
            {"id":"old","name":"old name","normalizedName":"old","wikiLink":"https://escapefromtarkov.fandom.com/wiki/Glory_to_CPSU_-_Part_1","objectives":[]}
        ]);
        let t = table(&[("ok name", "Glory to CPSU"), ("old name", "Gloire au PCUS - Partie 1")]);
        let mut q = Quality::default();
        let mut removed = HashSet::new();
        removed.insert("Glory to CPSU - Part 1".to_string());
        let out = convert_tasks(raw.as_array().unwrap(), &HashMap::new(), &HashMap::new(), &t, &mut q, &removed);
        let names: Vec<&str> = out.as_array().unwrap().iter().filter_map(|v| v["name"].as_str()).collect();
        assert_eq!(names, vec!["Glory to CPSU"], "la quête historique est filtrée, la valide reste");
    }

    #[test]
    fn le_format_produit_est_celui_lu_par_l_interface() {        let (items, maps, tasks, traders_doc) = sample();
        let t = table(&[]);
        let mut q = Quality::default();
        let it = convert_items(&items, &t, &mut q);
        let m = convert_maps(&maps, &t, &it.names, &HashMap::new(), &mut q);
        let tr_ = convert_traders(&traders_doc, &t);
        let ts = convert_tasks(&tasks, &m.slugs, &tr_, &t, &mut q, &HashSet::new());
        let ho = convert_hideout(&hideout_doc(), &t, &mut q);
        let all = assemble(ts, m.maps, it.items, ho, "fr", 123, &q);
        assert_eq!((all["version"].clone(), all["source"].clone()), (serde_json::json!(2), serde_json::json!("json.tarkov.dev")));
        assert_eq!(all["quality"]["tasks"], 1);
        // sans aucune traduction, rien ne plante et les noms retombent sur les identifiants lisibles
        assert_eq!(all["tasks"][0]["name"], "Debut");
        assert_eq!(all["maps"][0]["name"], "Customs");
    }

    fn hideout_doc() -> Value {
        serde_json::json!({
            "s1": { "id": "s1", "name": "stash", "normalizedName": "stash", "levels": [
                { "level": 1, "itemRequirements": [] },
                { "level": 2, "itemRequirements": [
                    { "item": "i1", "count": 3, "attributes": { "foundInRaid": true } },
                    { "item": { "id": "i2" }, "count": 1 }
                ] }
            ] },
            "s2": { "id": "s2", "name": "library", "normalizedName": "library", "levels": [
                { "level": 1, "itemRequirements": [] }
            ] }
        })
    }

    #[test]
    fn hideout_converti_par_niveau() {
        let t = table(&[("stash", "Coffre"), ("library", "Bibliothèque")]);
        let mut q = Quality::default();
        let h = convert_hideout(&hideout_doc(), &t, &mut q);
        let arr = h.as_array().unwrap();
        assert_eq!(arr.len(), 1, "les stations sans objet à réunir sont ignorées");
        assert_eq!(arr[0]["name"], "Coffre");
        assert_eq!(arr[0]["levels"].as_array().unwrap().len(), 1, "niveaux vides ignorés");
        let lv = &arr[0]["levels"][0];
        assert_eq!(lv["level"], 2);
        assert_eq!(lv["items"][0]["count"], 3);
        assert_eq!(lv["items"][0]["fir"], true);
        assert_eq!(lv["items"][1]["id"], "i2", "référence objet sous forme d'objet");
        assert_eq!((q.hideout_stations, q.hideout_items), (1, 2));
    }

    #[test]
    fn conteneur_nomme_via_wiki() {
        let json = r#"{
            "maps": [
                {
                    "id": "m1", "normalizedName": "customs",
                    "lootContainers": [
                        { "lootContainer": "5909d50c86f774659e6aaebe", "position": {"x":1,"y":2,"z":3} },
                        { "lootContainer": "578f87ad245977356274f2cc", "position": {"x":4,"y":5,"z":6} }
                    ],
                    "lootLoose": [], "stationaryWeapons": [], "bosses": []
                }
            ]
        }"#;
        let doc: MapsDoc = serde_json::from_str(json).unwrap();
        let t = table_from(HashMap::new());
        let mut q = Quality::default();
        let mut nodes = HashMap::new();
        nodes.insert("5909d50c86f774659e6aaebe".to_string(), "Technical supply crate".to_string());
        nodes.insert("578f87ad245977356274f2cc".to_string(), "Sports bag".to_string());
        let m = convert_maps(&doc, &t, &HashMap::new(), &nodes, &mut q);
        let map = &m.maps[0];
        let containers = map["lootContainers"].as_array().unwrap();
        assert_eq!(containers[0]["lootContainer"]["name"], "Technical supply crate");
        assert_eq!(containers[1]["lootContainer"]["name"], "Sports bag");
        assert_eq!(q.containers_named, 2);
    }

    #[test]
    fn conteneur_nomme_via_referentiel_api() {
        // L'API fournit au niveau global `lootContainers` : id -> clé de traduction (`<id> Name`).
        // C'est la source fiable ; l'ancien code cherchait `<id> name` (minuscule) et échouait toujours.
        let json = r#"{
            "maps": [
                { "id": "m1", "normalizedName": "customs",
                  "lootContainers": [
                      { "lootContainer": "578f87a3245977356274f2cb", "position": {"x":1,"y":2,"z":3} },
                      { "lootContainer": "5909d50c86f774659e6aaebe", "position": {"x":4,"y":5,"z":6} },
                      { "lootContainer": "aaaaaaaaaaaaaaaaaaaaaaaa", "position": {"x":7,"y":8,"z":9} }
                  ],
                  "lootLoose": [], "stationaryWeapons": [], "bosses": [] }
            ],
            "lootContainers": {
                "578f87a3245977356274f2cb": { "id": "578f87a3245977356274f2cb", "name": "578f87a3245977356274f2cb Name", "normalizedName": "duffle-bag" },
                "5909d50c86f774659e6aaebe": { "id": "5909d50c86f774659e6aaebe", "name": "5909d50c86f774659e6aaebe Name", "normalizedName": "technical-crate" },
                "aaaaaaaaaaaaaaaaaaaaaaaa": { "id": "aaaaaaaaaaaaaaaaaaaaaaaa", "name": "aaaaaaaaaaaaaaaaaaaaaaaa Name", "normalizedName": "weapon-crate" }
            }
        }"#;
        let doc: MapsDoc = serde_json::from_str(json).unwrap();
        let t = table(&[
            ("578f87a3245977356274f2cb Name", "Sac de sport"),
            ("5909d50c86f774659e6aaebe Name", "Caisse technique"),
        ]);
        let mut q = Quality::default();
        let m = convert_maps(&doc, &t, &HashMap::new(), &HashMap::new(), &mut q);
        let containers = m.maps[0]["lootContainers"].as_array().unwrap();
        assert_eq!(containers[0]["lootContainer"]["name"], "Sac de sport", "nom résolu via le référentiel de l'API");
        assert_eq!(containers[1]["lootContainer"]["name"], "Caisse technique");
        assert_eq!(containers[2]["lootContainer"]["name"], "Weapon crate", "sans traduction => libellé anglais de repli");
        assert_eq!(q.containers_named, 3);
    }

    #[test]
    fn verrous_extraits_avec_cle_et_position() {
        // L'API `maps` fournit les verrous (portes et coffres) avec la clé requise et la position.
        let json = r#"{
            "maps": [
                { "id": "m1", "normalizedName": "customs",
                  "locks": [
                      { "id": "L1", "lockType": "door", "key": "k1", "needsPower": false, "position": {"x":-19.08,"y":1.45,"z":-48.57} },
                      { "id": "L2", "lockType": "trunk", "key": "k2", "needsPower": true, "position": {"x":66.83,"y":-1.61,"z":-29.32} },
                      { "id": "L3", "lockType": "door", "key": null, "position": null }
                  ],
                  "lootContainers": [], "lootLoose": [], "stationaryWeapons": [], "bosses": [] }
            ]
        }"#;
        let doc: MapsDoc = serde_json::from_str(json).unwrap();
        let t = table_from(HashMap::new());
        let mut q = Quality::default();
        let mut names = HashMap::new();
        names.insert("k1".to_string(), "Clé de la salle 214".to_string());
        let m = convert_maps(&doc, &t, &names, &HashMap::new(), &mut q);
        let locks = m.maps[0]["locks"].as_array().unwrap();
        assert_eq!(locks.len(), 2, "le verrou sans position est ignoré");
        assert_eq!(locks[0]["id"], "L1");
        assert_eq!(locks[0]["lockType"], "door");
        assert_eq!(locks[0]["key"]["id"], "k1");
        assert_eq!(locks[0]["key"]["name"], "Clé de la salle 214");
        assert_eq!(locks[0]["needsPower"], false);
        assert_eq!(locks[0]["position"]["x"], -19.08);
        assert_eq!(locks[1]["lockType"], "trunk");
        assert_eq!(locks[1]["needsPower"], true);
        assert_eq!(q.locks, 2);
    }

    #[test]
    fn verrous_absents_ne_plantent_pas() {
        // Sans champ `locks`, la conversion produit un tableau vide (rétrocompatibilité du cache).
        let json = r#"{ "maps": [ { "id": "m1", "normalizedName": "customs",
            "lootContainers": [], "lootLoose": [], "stationaryWeapons": [], "bosses": [] } ] }"#;
        let doc: MapsDoc = serde_json::from_str(json).unwrap();
        let mut q = Quality::default();
        let m = convert_maps(&doc, &table_from(HashMap::new()), &HashMap::new(), &HashMap::new(), &mut q);
        assert_eq!(m.maps[0]["locks"].as_array().unwrap().len(), 0);
        assert_eq!(q.locks, 0);
    }
}
