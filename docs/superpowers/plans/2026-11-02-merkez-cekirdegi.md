# Merkez Çekirdeği (Aşama 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI Cockpit'e "merkez modu" eklemek: PostgreSQL, kullanıcı/ekip/rol, parola + passkey + Google Workspace girişi ve toplayıcı cihaz eşleştirmesi. Veri gönderimi (Aşama 2) bu planda yok.

**Architecture:** `AI_COCKPIT_MODE=central` ile başlayan sunucu yalnız `/api/central/*` ve `/api/health` yollarını bağlar; yerel kokpit rotaları bu modda bağlanmaz. Merkez kodu `server/central/` altında, PostgreSQL'e `pg` ile bağlanır, SQL göçleri `server/central/migrations/` içindedir. İstemci açılışta `/api/central/status` sorar; merkez modundaysa ayrı bir `CentralApp` gösterir, değilse bugünkü `App`. Yerel mod davranışı değişmez.

**Tech Stack:** Node >=22.22 (CommonJS), Express 4.22.2, `pg` 8.23.1, `@simplewebauthn/server` 14.0.3, `@simplewebauthn/browser` 14.0.0, `openid-client` 6.8.8, parola için `node:crypto` scrypt, testler `node:test` (sunucu) ve vitest (istemci), React 19 + react-router 8 + i18next.

**Spec:** `docs/superpowers/specs/2026-11-02-merkezi-ekip-kokpiti-design.md`

## Global Constraints

- Lisans GPL-3.0; yeni dosya başlıklarında yazar "Caglar Ulkuderner". "HugVet" adı hiçbir yerde geçmez.
- Merkez yalnız HTTPS arkasında çalışır; oturum çerezi `Secure`, `HttpOnly`, `SameSite=Lax`. Yerel geliştirmede (`http://localhost`) `Secure` yalnız `AI_COCKPIT_CENTRAL_INSECURE_COOKIE=1` ile kapatılabilir.
- Commit mesajlarında Claude/AI imzası, `Co-Authored-By` satırı yok.
- Paket sürümleri tam sabitlenir (yukarıdaki sürümler, `^` yok).
- Arayüz metinleri `tr` ve `en` dillerinde i18n anahtarı olarak eklenir; düz metin yok.
- Yerel mod (bugünkü tek kişilik kullanım) hiçbir testte bozulmaz: `npm run test:server` ve `npm run test:client` her görev sonunda yeşil.
- Kişi parolası hiçbir zaman toplayıcıya/cihaza girilmez; cihazlar yalnız eşleştirme kodu ve cihaz anahtarıyla bağlanır.
- Arayüz kodu yazılmadan önce ekran taslakları kullanıcı onayına sunulur (Task 8).

## Review Focus

1. Kullanıcı adı büyük/küçük harf ve boşluk farkı ("Caglar " ile "caglar"): tek kullanıcı sayılmalı, girişte eşleşmeli. Test: Task 3.
2. Google ile izinli alan dışından ya da doğrulanmamış e-postayla giriş: reddedilmeli; aynı e-postalı mevcut kullanıcıya yalnız alan ve `email_verified` uyarsa bağlanmalı. Test: Task 6.
3. Devre dışı bırakılan kullanıcının açık oturumları ve cihaz anahtarları anında çalışmaz olmalı. Test: Task 4 ve Task 7.
4. Eşleştirme kodu: süresi geçmiş, ikinci kez kullanılan ya da tahminle denenen kod reddedilmeli, deneme hız sınırına takılmalı. Test: Task 7.
5. Son yöneticinin kendini düşürmesi ya da devre dışı bırakması: reddedilmeli, sistem yöneticisiz kalmamalı. Test: Task 5.

---

## Dosya yapısı

| Dosya | Sorumluluk |
|---|---|
| `server/central/config.js` | Ortam değişkenlerinden merkez ayarlarını okur ve doğrular |
| `server/central/db.js` | `pg` havuzu, göç çalıştırıcı |
| `server/central/migrations/001_core.sql` | users, teams, team_members, passkeys, auth_sessions, devices, pairing_codes, audit_log |
| `server/central/passwords.js` | scrypt hash/doğrulama, parola kuralı |
| `server/central/users.js` | kullanıcı/ekip veri erişimi (SQL burada) |
| `server/central/sessions.js` | sunucu tarafı oturum, çerez, `requireUser`, `requireAdmin`, CSRF |
| `server/central/rate-limit.js` | bellek içi deneme sınırlayıcı |
| `server/central/routes/auth.js` | parola girişi, çıkış, `me`, parola değiştirme |
| `server/central/routes/passkeys.js` | WebAuthn kayıt/giriş |
| `server/central/routes/google.js` | Google Workspace OIDC |
| `server/central/routes/admin.js` | kullanıcı, ekip, üyelik yönetimi |
| `server/central/routes/devices.js` | eşleştirme kodu, eşleştirme, cihaz listesi/iptal, `deviceGuard` |
| `server/central/index.js` | `mountCentral(app, { pool, config })` |
| `server/central/cli.js` | `create-admin` ve `migrate` komutları |
| `server/__tests__/central-helpers.js` | test PostgreSQL şeması kur/kaldır, test uygulaması |
| `scripts/central-connect.js` | toplayıcı tarafı eşleştirme, `~/.ai-cockpit/central.json` |
| `client/src/central/*` | merkez arayüzü (api, CentralApp, sayfalar) |

Test dosyaları `server/__tests__/central-*.test.js` adını alır, böylece mevcut `npm run test:server` deseni onları da çalıştırır.

---

### Task 1: Merkez ayarları, PostgreSQL bağlantısı ve göçler

**Files:**
- Modify: `package.json` (dependencies: `"pg": "8.23.1"`; scripts: `"central:migrate": "node server/central/cli.js migrate"`)
- Create: `server/central/config.js`, `server/central/db.js`, `server/central/migrations/001_core.sql`, `server/__tests__/central-helpers.js`
- Test: `server/__tests__/central-db.test.js`

**Interfaces:**
- Produces:
  - `readCentralConfig(env = process.env) -> { databaseUrl: string, publicUrl: string, rpId: string, rpName: string, google: { clientId, clientSecret, allowedDomain } | null, signupMode: "auto" | "approval", requirePasskey: boolean, insecureCookie: boolean }`. Throws `Error` with Turkish message when required values are missing.
  - `createPool(databaseUrl: string) -> pg.Pool`
  - `migrate(pool) -> Promise<string[]>` (uygulanan göç dosya adları; zaten uygulanmışları atlar, `schema_migrations(name text primary key, applied_at timestamptz)` tablosunda izler, her dosya kendi transaction'ında)
  - Test helper: `withCentralDb(t) -> Promise<{ pool, schema }>`: `CENTRAL_TEST_DATABASE_URL` (varsayılan `postgres://localhost/ai_cockpit_test`) üzerinde rastgele adlı şema açar, `search_path` ayarlar, `migrate` çalıştırır, `t.after` ile şemayı düşürür. Veritabanına bağlanamazsa `t.skip("PostgreSQL yok: CENTRAL_TEST_DATABASE_URL")` der.

Ortam değişkenleri (config.js'in okuduğu, tam adlar):
`AI_COCKPIT_CENTRAL_DATABASE_URL` (zorunlu), `AI_COCKPIT_CENTRAL_PUBLIC_URL` (zorunlu, `https://` ile başlamalı, `AI_COCKPIT_CENTRAL_INSECURE_COOKIE=1` iken `http://localhost` kabul), `AI_COCKPIT_CENTRAL_RP_NAME` (varsayılan `AI Cockpit`), `AI_COCKPIT_CENTRAL_GOOGLE_CLIENT_ID`, `AI_COCKPIT_CENTRAL_GOOGLE_CLIENT_SECRET`, `AI_COCKPIT_CENTRAL_GOOGLE_DOMAIN` (üçü birlikte verilir ya da hiçbiri), `AI_COCKPIT_CENTRAL_SIGNUP` (`auto`|`approval`, varsayılan `approval`), `AI_COCKPIT_CENTRAL_REQUIRE_PASSKEY` (`1` ise zorunlu, varsayılan kapalı). `rpId` = `publicUrl` host adı.

`001_core.sql` tabloları (sütun adları sonraki görevlerde kullanılır):
- `users(id uuid pk default gen_random_uuid(), username text unique not null, email text unique, display_name text not null, password_hash text, role text not null check (role in ('member','admin')) default 'member', status text not null check (status in ('active','pending','disabled')) default 'active', created_at timestamptz default now())`
- `teams(id uuid pk, name text unique not null, created_at)`
- `team_members(team_id fk on delete cascade, user_id fk on delete cascade, role text check (role in ('member','lead')) default 'member', is_primary boolean default false, primary key(team_id,user_id))` + kişi başına en çok bir `is_primary` için kısmi unique index
- `passkeys(id text pk /* credential id base64url */, user_id fk cascade, public_key bytea not null, counter bigint not null, transports text[], name text, created_at, last_used_at)`
- `auth_sessions(id text pk /* sha256 hex */, user_id fk cascade, needs_passkey boolean default false, created_at, last_seen_at, expires_at timestamptz not null, ip text, user_agent text)`
- `devices(id uuid pk, user_id fk cascade, name text not null, platform text, key_hash text not null, created_at, last_seen_at, revoked_at timestamptz)`
- `pairing_codes(code_hash text pk, user_id fk cascade, expires_at timestamptz not null, used_at timestamptz)`
- `audit_log(id bigserial pk, at timestamptz default now(), actor_user_id uuid, action text not null, target text, detail jsonb)`

- [ ] **Step 1: Write the failing tests** in `server/__tests__/central-db.test.js`:
  - `readCentralConfig` eksik `AI_COCKPIT_CENTRAL_DATABASE_URL` ile throw eder; `publicUrl` `http://example.com` iken throw eder; Google üçlüsünden yalnız biri verilince throw eder; tam ayarda `rpId === "cockpit.example.com"`, `signupMode === "approval"`, `requirePasskey === false`.
  - `migrate` ilk çağrıda `["001_core.sql"]`, ikinci çağrıda `[]` döner; `users`, `devices`, `audit_log` tabloları vardır.
- [ ] **Step 2: Run** `node --test server/__tests__/central-db.test.js`. Expected: FAIL (modül yok).
- [ ] **Step 3: Implement** `config.js`, `db.js`, `001_core.sql`, `central-helpers.js`; `npm install pg@8.23.1 --save-exact`.
- [ ] **Step 4: Run** aynı komut (yerelde `createdb ai_cockpit_test` sonrası). Expected: PASS. Ardından `npm run test:server` yeşil.
- [ ] **Step 5: Commit** `feat(central): merkez ayarları, PostgreSQL ve göçler`

### Task 2: Parola hash'i

**Files:**
- Create: `server/central/passwords.js`
- Test: `server/__tests__/central-passwords.test.js`

**Interfaces:**
- Produces:
  - `hashPassword(plain: string) -> Promise<string>`; biçim `scrypt$N$r$p$saltB64$hashB64`, N=2^15, r=8, p=1, 16 bayt tuz, 64 bayt çıktı.
  - `verifyPassword(plain: string, stored: string) -> Promise<boolean>`; `crypto.timingSafeEqual` ile karşılaştırır; bozuk biçimde `false`.
  - `checkPasswordPolicy(plain: string) -> string | null`; en az 12 karakter, en çok 256; ihlalde Türkçe hata metni anahtarı döner (`"password.tooShort"`, `"password.tooLong"`), uygunsa `null`.

- [ ] **Step 1: Write the failing tests:** aynı parola iki kez hash'lenince farklı dizge (tuz); `verifyPassword("dogru-parola-123", h) === true`; yanlış parola `false`; `verifyPassword("x", "bozuk") === false`; `checkPasswordPolicy("kisa") === "password.tooShort"`.
- [ ] **Step 2: Run** `node --test server/__tests__/central-passwords.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `crypto.scrypt` (promisify) ile, `maxmem` N*r*256'dan büyük ayarlanır.
- [ ] **Step 4: Run** aynı komut. Expected: PASS.
- [ ] **Step 5: Commit** `feat(central): scrypt parola hash'i`

### Task 3: Kullanıcı/ekip veri erişimi ve ilk yönetici CLI

**Files:**
- Create: `server/central/users.js`, `server/central/cli.js`
- Test: `server/__tests__/central-users.test.js`

**Interfaces:**
- Consumes: `migrate`, `createPool`, `hashPassword`.
- Produces (hepsi `pool` ilk parametre, Promise döner):
  - `normalizeUsername(s: string) -> string` (trim + `toLocaleLowerCase("tr")` değil, `toLowerCase()`; Türkçe İ/ı sorunundan kaçınmak için yalnız `[a-z0-9._-]` kabul, aksi `null`)
  - `createUser(pool, { username, displayName, email?, password?, role?, status? }) -> user`; kullanıcı adı normalize edilir, çakışmada `Error` `code = "EUSERNAME_TAKEN"`.
  - `findUserByUsername(pool, username) -> user | null` (normalize ederek arar)
  - `findUserByEmail(pool, email) -> user | null` (küçük harfle)
  - `getUser(pool, id)`, `listUsers(pool) -> user[]` (password_hash hariç), `updateUser(pool, id, { displayName?, role?, status?, email? })`, `setPassword(pool, id, plain)`
  - `createTeam(pool, name)`, `listTeams(pool)` (üyeleriyle), `renameTeam`, `deleteTeam`, `setMembership(pool, teamId, userId, { role, isPrimary })`, `removeMembership(pool, teamId, userId)`
  - `countActiveAdmins(pool) -> number`
  - `audit(pool, actorUserId, action, target, detail)`
  - CLI: `node server/central/cli.js create-admin <username>` parolayı stdin'den okur (TTY'de yankısız), politika kontrolü yapar, `role='admin'` kullanıcı oluşturur; `node server/central/cli.js migrate`.

- [ ] **Step 1: Write the failing tests:** `createUser({username:" Caglar "})` sonrası `findUserByUsername("CAGLAR").username === "caglar"`; aynı adla ikinci `createUser` `EUSERNAME_TAKEN`; `normalizeUsername("çağlar") === null`; kişi başına ikinci `isPrimary:true` üyelik önceki birincili `false` yapar; `listUsers` sonucunda `password_hash` alanı yok; `countActiveAdmins` devre dışı yöneticiyi saymaz.
- [ ] **Step 2: Run** `node --test server/__tests__/central-users.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `users.js` ve `cli.js`.
- [ ] **Step 4: Run** aynı komut. Expected: PASS.
- [ ] **Step 5: Commit** `feat(central): kullanıcı ve ekip veri erişimi, create-admin`

### Task 4: Oturumlar, parola girişi ve merkez modunun bağlanması

**Files:**
- Create: `server/central/sessions.js`, `server/central/rate-limit.js`, `server/central/routes/auth.js`, `server/central/index.js`
- Modify: `server/index.js:84-112` (merkez modunda yalnız merkez + health rotaları), `server/lib/security.js:202` (`TOKEN_EXEMPT_PREFIXES`'e `"/central"`)
- Test: `server/__tests__/central-auth.test.js`

**Interfaces:**
- Consumes: Task 1-3.
- Produces:
  - `mountCentral(app, { pool, config }) -> void`; `/api/central` altına tüm merkez rotalarını bağlar.
  - `GET /api/central/status` (kimlik istemez) -> `{ central: true, google: boolean, requirePasskey: boolean }`
  - `POST /api/central/auth/login` `{ username, password }` -> 200 `{ user, needsPasskey }` + `Set-Cookie: cockpit_session`; hatalı -> 401 `{ error: { code: "EBADLOGIN" } }` (kullanıcı yok / parola yanlış / devre dışı / onay bekliyor ayrımı yapılmaz, yalnız `pending` için 403 `EPENDING`)
  - `POST /api/central/auth/logout`, `GET /api/central/auth/me` -> `{ user, teams: [{id,name,role,isPrimary}], needsPasskey }`, `POST /api/central/auth/password` `{ current, next }`
  - `createSession(pool, userId, { needsPasskey, ip, userAgent }) -> token` (32 rastgele bayt base64url; DB'de sha256 hex saklanır; mutlak süre 7 gün, boşta kalma 12 saat)
  - `requireUser` middleware: çerezi doğrular, kullanıcı `active` değilse oturumu siler ve 401; `req.user`, `req.session` set eder; `needs_passkey` oturumda yalnız `/passkeys/register/*`, `/auth/me`, `/auth/logout` geçer, diğerleri 403 `EPASSKEY_REQUIRED`.
  - `requireAdmin` middleware (`req.user.role === "admin"`, aksi 403).
  - CSRF: `POST/PATCH/PUT/DELETE` isteklerinde `x-cockpit-csrf: 1` başlığı yoksa 403 `ECSRF` (eşleştirme uç noktası hariç, Task 7).
  - `createLimiter({ max, windowMs }) -> { hit(key) -> boolean /* true = engelle */, reset(key) }`; giriş: kullanıcı adı başına 15 dakikada 5 hatalı deneme, IP başına 15 dakikada 50.
  - Merkez modu `process.env.AI_COCKPIT_MODE === "central"` ile seçilir; bu modda yerel rotalar, izleyiciler (Codex/Cursor/Gemini sync, telemetry, price-sync, Claude usage poll) başlatılmaz.

- [ ] **Step 1: Write the failing tests** (supertest yok; test, uygulamayı `http.createServer` ile rastgele porta açıp `fetch` kullanır, mevcut `server/__tests__/api.test.js` deseni gibi):
  - doğru parola -> 200 ve `HttpOnly; SameSite=Lax` çerez; ardından `GET /auth/me` 200 ve `user.username === "caglar"`;
  - `"CAGLAR "` kullanıcı adıyla giriş de 200;
  - yanlış parola 401 `EBADLOGIN`; 5 yanlış denemeden sonra doğru parola da 429 `ERATELIMIT`;
  - CSRF başlığı olmayan `POST /auth/logout` 403 `ECSRF`;
  - kullanıcı `updateUser(..., {status:"disabled"})` yapılınca aynı çerezle `GET /auth/me` 401;
  - `AI_COCKPIT_MODE=central` iken `GET /api/sessions` 404 (yerel rota bağlı değil); yerel modda `GET /api/central/status` 404.
- [ ] **Step 2: Run** `node --test server/__tests__/central-auth.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** yukarıdaki dosyalar; `server/index.js` içinde merkez modu dalı.
- [ ] **Step 4: Run** aynı komut ve `npm run test:server`. Expected: PASS, yerel testler yeşil.
- [ ] **Step 5: Commit** `feat(central): oturumlar, parola girişi, merkez modu`

### Task 5: Yönetim API'si (kullanıcı, ekip, üyelik)

**Files:**
- Create: `server/central/routes/admin.js`
- Test: `server/__tests__/central-admin.test.js`

**Interfaces:**
- Consumes: `requireUser`, `requireAdmin`, `users.js`, `audit`.
- Produces (hepsi `requireAdmin`):
  - `GET /api/central/admin/users`, `POST /api/central/admin/users` `{ username, displayName, email?, role?, password }` (politika kontrolü), `PATCH /api/central/admin/users/:id` `{ displayName?, role?, status?, email? }`, `POST /api/central/admin/users/:id/password` `{ password }`
  - `GET/POST /api/central/admin/teams`, `PATCH/DELETE /api/central/admin/teams/:id`, `PUT /api/central/admin/teams/:id/members/:userId` `{ role, isPrimary }`, `DELETE /api/central/admin/teams/:id/members/:userId`
  - Kullanıcı `disabled` yapılınca o kullanıcının tüm `auth_sessions` satırları silinir ve cihazları `revoked_at = now()` olur.
  - Her değişiklik `audit_log`'a yazılır (`action`: `user.create`, `user.update`, `user.password`, `team.create`, `team.update`, `team.delete`, `team.member.set`, `team.member.remove`).

- [ ] **Step 1: Write the failing tests:** üye rolündeki kullanıcı `GET /admin/users` 403; yönetici kullanıcı oluşturur, listede görünür; tek aktif yönetici kendi `role`'ünü `member` yapmaya ya da `status`'unu `disabled` yapmaya çalışınca 409 `ELAST_ADMIN`; kullanıcı devre dışı bırakılınca onun açık oturumu ile `/auth/me` 401 ve cihaz satırında `revoked_at` dolu; her işlemden sonra `audit_log`'da beklenen `action` var.
- [ ] **Step 2: Run** `node --test server/__tests__/central-admin.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `admin.js`; `ELAST_ADMIN` kontrolü aynı transaction içinde `countActiveAdmins` ile.
- [ ] **Step 4: Run** aynı komut. Expected: PASS.
- [ ] **Step 5: Commit** `feat(central): yönetim API'si`

### Task 6: Passkey ve Google Workspace girişi

**Files:**
- Modify: `package.json` (`"@simplewebauthn/server": "14.0.3"`, `"openid-client": "6.8.8"`)
- Create: `server/central/routes/passkeys.js`, `server/central/routes/google.js`
- Test: `server/__tests__/central-passkeys.test.js`, `server/__tests__/central-google.test.js`

**Interfaces:**
- Consumes: `createSession`, `requireUser`, `users.js`, `config.rpId`, `config.publicUrl`, `config.google`, `config.signupMode`.
- Produces:
  - `POST /api/central/passkeys/register/options` (requireUser) -> `PublicKeyCredentialCreationOptionsJSON`; challenge oturuma bağlı bellek içi tabloda 5 dakika tutulur.
  - `POST /api/central/passkeys/register/verify` `{ response, name }` -> `{ id, name }`; başarılıysa oturumun `needs_passkey` bayrağı kalkar.
  - `GET /api/central/passkeys`, `DELETE /api/central/passkeys/:id` (kendi passkey'leri; `requirePasskey` açıkken son passkey silinemez: 409 `ELAST_PASSKEY`)
  - `POST /api/central/passkeys/login/options` (kimliksiz, kullanıcı adı istemez: discoverable credential) -> options; `POST /api/central/passkeys/login/verify` `{ response }` -> oturum çerezi + `{ user }`; sayaç güncellenir, `last_used_at` yazılır.
  - Parola girişinde `config.requirePasskey && kullanıcının passkey'i yok` ise oturum `needs_passkey = true` açılır (Task 4 davranışı burada test edilir).
  - `GET /api/central/auth/google/start` -> Google'a yönlendirme (PKCE + state + nonce, `hd` parametresi = `allowedDomain`); `GET /api/central/auth/google/callback` -> kod değişimi `openid-client` ile; kabul koşulları: `email_verified === true` ve e-posta alan adı `allowedDomain` ile tam eşit (`hd` iddiasına tek başına güvenilmez). Eşleşme: önce e-postası aynı kullanıcı; yoksa `signupMode === "auto"` ise `active`, `"approval"` ise `pending` kullanıcı oluşturulur (kullanıcı adı e-postanın `@` öncesi, çakışırsa sonuna `-2`, `-3`). `pending` kullanıcıya oturum açılmaz, `/?pending=1`'e yönlenir.
  - Google rotaları yalnız `config.google` doluysa bağlanır.

- [ ] **Step 1: Write the failing tests:**
  - passkey: `@simplewebauthn/server`'ın `verifyRegistrationResponse`/`verifyAuthenticationResponse` fonksiyonları test içinde enjekte edilen sahte ile değiştirilir (`passkeys.js` bunları `deps` parametresiyle alır). Kayıt sonrası `GET /passkeys` bir kayıt döner; `requirePasskey` açık kullanıcı parolayla girince `/admin/users` 403 `EPASSKEY_REQUIRED`, passkey kaydından sonra aynı oturum geçer; son passkey silinmesi 409 `ELAST_PASSKEY`; giriş doğrulaması sahte `verified:true` ile çerez verir, `verified:false` ile 401.
  - google: `google.js` token değişimini `deps.exchange(code, checks) -> claims` ile alır; testte sahte. `email_verified:false` -> 403; `foo@baska.com` -> 403; `ali@profelis.com.tr` ve `signupMode:"approval"` -> kullanıcı `pending`, çerez yok; aynı e-postalı mevcut aktif kullanıcı -> o kullanıcıyla oturum; state uyuşmazlığı -> 400.
- [ ] **Step 2: Run** `node --test server/__tests__/central-passkeys.test.js server/__tests__/central-google.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement**; `npm install @simplewebauthn/server@14.0.3 openid-client@6.8.8 --save-exact`. `openid-client` v6 ESM ise CommonJS'ten dinamik `import()` ile yüklenir.
- [ ] **Step 4: Run** aynı komut ve `npm run test:server`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(central): passkey ve Google Workspace girişi`

### Task 7: Cihaz eşleştirme (sunucu ve toplayıcı)

**Files:**
- Create: `server/central/routes/devices.js`, `scripts/central-connect.js`
- Modify: `bin/ai-cockpit` (yeni alt komutlar `central-connect <url> <kod>`, `central-status`, `central-disconnect`; kullanım yorumu)
- Test: `server/__tests__/central-devices.test.js`, `server/__tests__/central-connect.test.js`

**Interfaces:**
- Consumes: `requireUser`, `createLimiter`, `audit`.
- Produces:
  - `POST /api/central/devices/pairing-codes` (requireUser) -> `{ code, expiresAt }`; kod 10 karakter, alfabe `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, 10 dakika geçerli, DB'de sha256 hex.
  - `POST /api/central/devices/pair` (kimliksiz, CSRF muaf, IP başına 15 dakikada 10 deneme) `{ code, name, platform }` -> `{ deviceId, deviceKey }`; kod tek kullanımlık (`used_at` aynı `UPDATE ... WHERE used_at IS NULL AND expires_at > now() RETURNING` ile atomik), anahtar 32 bayt base64url, DB'de sha256 hex.
  - `GET /api/central/devices` (kendi cihazları; yönetici `?all=1` ile hepsi), `DELETE /api/central/devices/:id` (kendi cihazı ya da yönetici) -> `revoked_at`.
  - `deviceGuard` middleware: `Authorization: Device <deviceId>.<deviceKey>`; cihaz iptal edilmiş, kullanıcı `active` değil ya da anahtar uyuşmuyorsa 401; `req.device = { id, userId }`; `last_seen_at` günceller. Aşama 2 bu middleware'i kullanır.
  - `GET /api/central/devices/whoami` (deviceGuard) -> `{ deviceId, userId, username }`.
  - `scripts/central-connect.js`: `connect(url, code) -> Promise<void>` (yalnız `https://`, `AI_COCKPIT_CENTRAL_INSECURE_COOKIE=1` iken `http://localhost` de), `~/.ai-cockpit/central.json`'a `{ url, deviceId, deviceKey }` 0600 izinle yazar, sonra `whoami` ile doğrular; `status()`, `disconnect()` (dosyayı siler; sunucudaki iptal panelden yapılır).

- [ ] **Step 1: Write the failing tests:** kod üretilir, `pair` anahtar döner, `whoami` doğru kullanıcıyı verir; aynı kodla ikinci `pair` 400 `EBADCODE`; süresi geçmiş kod (DB'de `expires_at` geçmişe çekilerek) 400; 10 hatalı denemeden sonra 429; cihaz `DELETE` sonrası `whoami` 401; kullanıcı devre dışı bırakılınca `whoami` 401; başka kullanıcının cihazını silmeye çalışan üye 404. `central-connect.test.js`: test sunucusuna bağlanır, dosya 0600 izinle oluşur, `http://example.com` adresi reddedilir.
- [ ] **Step 2: Run** `node --test server/__tests__/central-devices.test.js server/__tests__/central-connect.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** aynı komut. Expected: PASS.
- [ ] **Step 5: Commit** `feat(central): cihaz eşleştirme`

### Task 8: Merkez ekran taslakları (onay kapısı)

**Files:**
- Create: `docs/cockpit/central-mockups.html` (statik, bugünkü kokpit renk ve tipografisiyle)

Ekranlar: Giriş (kullanıcı adı/parola, "Passkey ile gir", "Google ile gir" yalnız açıksa, onay bekliyor mesajı), Passkey zorunlu kayıt ekranı, Hesabım (passkey listesi ekle/sil, parola değiştir), Cihazlarım (eşleştirme kodu oluştur ve kopyalanacak komut `ai-cockpit central-connect <url> <kod>`, cihaz listesi, iptal), Yönetim/Kullanıcılar (liste, ekle, rol, durum, onay bekleyenler), Yönetim/Ekipler (ekip listesi, üye ekle, lider yap, birincil ekip), Ana sayfa yer tutucu ("Ekip ekranları sonraki aşamada").

- [ ] **Step 1:** Taslakları hazırla, `apple-design` denetiminden geçir (kontrast, odak sırası, klavye ile kullanım).
- [ ] **Step 2:** Kullanıcıya sun. Onay gelmeden Task 9'a geçilmez; istenen değişiklikler taslağa işlenir.
- [ ] **Step 3: Commit** `docs(central): ekran taslakları`

### Task 9: Merkez arayüzü

**Files:**
- Modify: `client/package.json` (`"@simplewebauthn/browser": "14.0.0"`), `client/src/main.tsx` (açılışta mod seçimi)
- Create: `client/src/central/api.ts`, `client/src/central/CentralApp.tsx`, `client/src/central/pages/{Login,PasskeySetup,Account,Devices,AdminUsers,AdminTeams,Home}.tsx`, `client/src/i18n/locales/{tr,en}/central.json`
- Test: `client/src/central/__tests__/{bootstrap,Login,Devices,AdminUsers}.test.tsx`

**Interfaces:**
- Consumes: Task 4-7 uç noktaları.
- Produces:
  - `centralApi`: `status()`, `login(username, password)`, `logout()`, `me()`, `changePassword(current, next)`, `passkeys.{list, register(name), remove(id), login()}`, `devices.{list(all?), createCode(), revoke(id)}`, `admin.{users, createUser, updateUser, setPassword, teams, createTeam, updateTeam, deleteTeam, setMember, removeMember}`. Hepsi `credentials: "include"` ve durum değiştiren isteklerde `x-cockpit-csrf: 1`; hata gövdesindeki `error.code` ile `CentralApiError` fırlatır.
  - `main.tsx`: `GET /api/central/status` 200 ve `central:true` ise `<CentralApp />`, aksi her durumda bugünkü `<App />` (ağ hatası dahil; yerel mod hiç etkilenmez).
  - `CentralApp` rotaları: `/login`, `/passkey-setup`, `/`, `/account`, `/devices`, `/admin/users`, `/admin/teams`. Oturum yoksa `/login`'e, `needsPasskey` ise `/passkey-setup`'a, yönetici olmayan `/admin/*`'a girerse `/`'a yönlenir.
  - Ekranlar Task 8'de onaylanan taslağa uyar.

- [ ] **Step 1: Write the failing tests:** `status` 404 dönünce bugünkü `App` render edilir; `central:true` ve `me` 401 iken `/login` görünür; giriş formu yanlış parolada `central:login.badLogin` metnini gösterir; `needsPasskey:true` iken `/passkey-setup`'a gidilir; Cihazlarım'da "Kod oluştur" sonrası komut metni `ai-cockpit central-connect https://cockpit.example.com ABCD...` görünür; üye rolündeki kullanıcı `/admin/users`'a giderse `/`'a yönlenir.
- [ ] **Step 2: Run** `cd client && npx vitest run src/central`. Expected: FAIL.
- [ ] **Step 3: Implement**; `cd client && npm install @simplewebauthn/browser@14.0.0 --save-exact`.
- [ ] **Step 4: Run** `cd client && npx vitest run && npx tsc --noEmit -p .`. Expected: PASS, tsc temiz.
- [ ] **Step 5: Commit** `feat(central): merkez arayüzü`

### Task 10: Uçtan uca deneme ve belgeler

**Files:**
- Create: `docs/cockpit/MERKEZ_KURULUM.md`
- Modify: `README.md` (kısa "Merkez modu" bölümü ve belgeye bağlantı)

- [ ] **Step 1:** Yerel PostgreSQL ile merkez modunu başlat: `AI_COCKPIT_MODE=central AI_COCKPIT_CENTRAL_DATABASE_URL=postgres://localhost/ai_cockpit_dev AI_COCKPIT_CENTRAL_PUBLIC_URL=http://localhost:4820 AI_COCKPIT_CENTRAL_INSECURE_COOKIE=1 npm start`. `node server/central/cli.js create-admin caglar` ile yönetici oluştur.
- [ ] **Step 2:** Tarayıcıda: parolayla giriş, passkey ekleme, çıkış, passkey ile giriş, ekip oluşturma, ikinci kullanıcı ekleme ve ekibe lider atama, eşleştirme kodu oluşturma, `bin/ai-cockpit central-connect http://localhost:4820 <kod>` ve `central-status` çıktısında kullanıcı adı. Ekran görüntülerini al.
- [ ] **Step 3:** `MERKEZ_KURULUM.md`: ortam değişkenleri tablosu, ilk yönetici, Google Workspace OAuth istemcisi oluşturma (yetkili yönlendirme adresi `<publicUrl>/api/central/auth/google/callback`), passkey için HTTPS ve alan adı şartı, cihaz bağlama. Docker paketi Aşama 6'ya bırakıldığı not edilir.
- [ ] **Step 4: Run** `npm run test:server && npm run test:client`. Expected: PASS.
- [ ] **Step 5: Commit** `docs(central): merkez kurulum belgesi`

---

## Sonraki aşamalar (ayrı planlar)

Her biri bu plan tamamlanınca kendi planını alır; sıralama tasarımdaki gibidir:
2. Gönderim (giden kuyruk, özet veri, proje kimliği, canlı durum kanalı, Go ajanının özet gönderimi)
3. Ekip ekranları (şirket/ekip/kişi, limitler, bekleyen onaylar, hatalar, abonelik koltukları ve atıl abonelikler)
4. İş paketleri
5. İçerik (maskeleme, dışlama, arama, okuma kaydı, saklama, KVKK)
6. Kurulum paketi (Docker imajı + compose, yedekleme, pilot)
