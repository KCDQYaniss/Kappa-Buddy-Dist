# license-worker — Backend de licence de Kappa Buddy

> **Note** : Kappa Buddy est distribué gratuitement ; ce backend de licence n'est
> **pas déployé et n'est pas utilisé** par l'app. Il est conservé dans le dépôt comme
> option future (si une revente ou un gate devenait pertinent).

Worker Cloudflare (gratuit) + base **D1** (SQLite). Déploiement **unique**,
aucune gestion au quotidien : l'acheteur colle sa clé itch, le Worker lie
son appareil et émet un **token signé perma** que l'app vérifie localement.
L'app ne recontacte ce Worker que pour **activer** une machine ou **libérer**
l'ancienne (swap) — jamais en jeu.

## Modèle retenu (décisions du 27 oct. 2026)

- Un achat itch = une **download key** = une licence **à vie**.
- **1 appareil par clé** (`MAX_BINDS`), change de PC en self-service :
  **1×/30 jours par clé** (`SWAP_COOLDOWN_DAYS`) — c'est le pivot anti-partage.
- **Token perma** (`KB1.<payload>.<sig>`, Ed25519) : pas d'expiration. L'app
  vérifie la signature avec la clé publique **compilée dans le binaire**.
- ⚠ Conséquence assumée : révéler/révoquer une clé ne bloque que la
  **ré-activation ailleurs** (et les nouveaux swaps) ; l'app déjà activée
  reste débloquée hors-ligne. C'est le prix du « zéro maintenance ».
- **Vie privée** : on ne stocke que des **SHA-256** (clé itch, empreinte
  machine). Pas d'IP, pas d'User-Agent, pas d'email, clé jamais en clair —
  jamais en query string (les routes sont POST-only), pas de cache d'edge.

## Vérification itch — patterns documentés (docs itch.io « Serverside API »)

```
GET https://itch.io/api/1/{GAME_ID}/{DOWNLOAD_KEY}              (direct, sans clé vendeur)
  → { download_key: { key, game_id, owner: { display_name, ... } } }
  → { errors: ["invalid download key"] }
```

Plan B (si le pattern direct évolue) :
```
GET https://itch.io/api/1/{SELLER_KEY}/my-game/{GAME_ID}/download_keys?download_key=…
```
⚠ À revalider au déploiement avec une **vraie** clé (achat réel sur la page
de test) AVANT que l'app n'active son gate. Un `401` vendeur ou un shape
inconnu → `config_error` (500) : visible immédiatement, jamais de fail-open.

## Fichiers

| Fichier | Rôle |
|---|---|
| `src/index.js` | Le Worker : routes `/v1/*`, `/admin`, itch, Ed25519, D1 |
| `schema.sql` | Tables D1 `licenses` / `devices` / `events` (hashes only) |
| `wrangler.toml` | Bindings + vars (`GAME_ID`, `MAX_BINDS`, `SWAP_COOLDOWN_DAYS`) |
| `test.js` | Suite locale : fausse D1 (`node:sqlite`), itch stub, **58 checks** |
| `package.json` | `{"type":"module"}` + `npm test` |

## Test local (sans compte Cloudflare, sans réseau)

```bash
cd license-worker
npm test
```
La suite injecte une fausse itch et une D1 en mémoire et vérifie : activation,
idempotence, refus 2ᵉ appareil, swap + cooldown, clés négatives, plan B
vendeur, admin complet, confidentialité (aucune clé brute dans une réponse).

## Protocole app ↔ Worker (contrat du module de licence de l'app, à implémenter)

- Empreinte machine : `SHA-256 hex` de l'empreinte (MachineGuid + sel fixe).
- `POST /v1/activate {key, device, label?}` →
  `200 {token, key_hash(16), device_hash(16), itch_name?}` | `400 missing_key|invalid_device` |
  `403 invalid_key|revoked` | `409 already_bound {max_binds, can_swap, next_swap_at}` |
  `502 itch_unreachable` | `500 config_error`
- `POST /v1/swap {key, device, label?}` → idem `200` | `429 cooldown {next_swap_at}` |
  `403 unknown_key` (activer via /activate) | `502` | `500`
- `POST /v1/status {key}` → `200 {status, devices[{label,bound_at}], next_swap_at, can_swap}` | `404 unknown_key`
- `GET /v1/health` → `200 ok` / `503 degraded {db, sign_key, game_id}`
- Token : `KB1.<payload b64url>.<sig b64url>` ; payload `{v:1, k:key_hash, d:device_hash, iat}`.
- UI app : sur `409` avec `can_swap=true` → bouton « Libérer mon ancien PC »
  → appelle `/v1/swap`. Sur `429` → affiche la date de `next_swap_at`.

## Déploiement (une fois, avec l'agent)

```bash
npx wrangler login                                  # auth navigateur, une fois
npx wrangler d1 create kappa-license                # → database_id dans wrangler.toml
npx wrangler d1 execute kappa-license --file schema.sql --remote
npx wrangler secret put LICENSE_PRIVATE_PKCS8_B64   # clé privée (base64 pkcs8)
npx wrangler secret put ADMIN_PASSWORD              # page d'admin
npx wrangler secret put ITCH_API_KEY                # optionnel : plan B vendeur
npx wrangler deploy                                 # ^ clé peut venir d'un fichier local
```

`GAME_ID` se renseigne dans `wrangler.toml [vars]` après création de la page
itch (un simple `npx wrangler deploy` de plus). Tant qu'il manque, `/v1/health`
renvoie 503 et les activations sont refusées — sécurité voulue.

Smoke test au premier déploiement : `/v1/health` → 200, puis une activation
réelle avec la clé d'un achat test (revalider les patterns itch ci-dessus).

## Clés Ed25519 (une fois, hors dépôt)

```bash
node -e "const c=require('crypto');const k=c.generateKeyPairSync('ed25519');console.log('PRIVATE_PKCS8_B64='+k.privateKey.export({type:'pkcs8',format:'der'}).toString('base64'));console.log('PUBLIC_RAW_HEX='+k.publicKey.export({type:'spki',format:'der'}).subarray(12).toString('hex'))"
```
- `PRIVATE_PKCS8_B64` → secret Worker (signe les tokens)
- `PUBLIC_RAW_HEX` → 32 octets compilés dans le module de licence de l'app (vérifie)

## Admin

`GET /admin` (HTML) protégé par `ADMIN_PASSWORD` (Bearer). Actions :
`list`, `events` (200 derniers), `revoke`, `unrevoke`, `unbind`
(libère tous les appareils), `refund` (révocation + déliaison — remboursement
itch). Les clés sont cherchables par leur hash ou leur valeur brute (hachée
à l'entrée, jamais persistée).

## Garanties de confidentialité (auditables via test.js)

- Clés et empreintes : **hashes SHA-256 uniquement** (PK indexés).
- La clé itch n'existe jamais en clair en base, ni en query string, ni
  dans une réponse, ni dans les logs.
- Pas d'IP / User-Agent / email stockés ; `cache-control: no-store` partout.
