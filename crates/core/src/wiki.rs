//! Détection des quêtes retirées du jeu, **sans liste en dur**.
//!
//! Le wiki officiel classe tout le contenu supprimé dans `Category:Historical content`
//! (https://escapefromtarkov.fandom.com/wiki/Category:Historical_content). L'API tarkov.dev
//! fournit pour chaque quête un `wikiLink` : si la page liée est dans cette catégorie,
//! la quête n'existe plus dans le jeu. On filtre donc par croisement dynamique,
//! jamais par identifiant en dur.

/// Titre de page wiki normalisé, extrait d'un lien `https://escapefromtarkov.fandom.com/wiki/<titre>`.
///
/// Renvoie le titre décodé avec les espaces normaux (`%22` -> `"`, `_` -> ` `),
/// dans la même forme que `list=categorymembers` renvoie (`Glory to CPSU - Part 1`).
pub fn page_title(link: &str) -> Option<String> {
    let rest = link.split("/wiki/").nth(1)?;
    let rest = rest.split(['#', '?']).next().unwrap_or(rest);
    if rest.is_empty() {
        return None;
    }
    Some(decode(rest).replace('_', " "))
}

/// Décodage pourcent minimal (`%XX`), suffisant pour les titres de page du wiki.
fn decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                out.push(h << 4 | l);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn titres_de_page() {
        assert_eq!(
            page_title("https://escapefromtarkov.fandom.com/wiki/Glory_to_CPSU_-_Part_1").as_deref(),
            Some("Glory to CPSU - Part 1")
        );
        assert_eq!(
            page_title("https://escapefromtarkov.fandom.com/wiki/Don%E2%80%99t_Believe_Your_Eyes").as_deref(),
            Some("Don’t Believe Your Eyes")
        );
        assert_eq!(page_title("https://example.com/sans/wiki").as_deref(), None);
        assert_eq!(
            page_title("https://escapefromtarkov.fandom.com/wiki/A_New_Hope#Notes").as_deref(),
            Some("A New Hope")
        );
    }
}
