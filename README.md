# AI Cockpit

Yapay zekâ ile kod geliştirirken çalışan ajanları tek ekranda izleme ve yönetme kokpiti. Yerel çalışır, veri makineden çıkmaz.

**Developed by Caglar Ulkuderner** · Lisans: [GPL-3.0-or-later](./LICENSE)

Adım adım ekran görüntülü kılavuz: **[docs/NASIL_KULLANILIR.md](docs/NASIL_KULLANILIR.md)**

[Claude-Code-Agent-Monitor](https://github.com/hoangsonww/Claude-Code-Agent-Monitor) (MIT, Son Nguyen) üzerine kurulu bir çatallamadır; o projenin tüm özellikleri (canlı oturumlar, alt ajan ağacı, Kanban, analiz, token/maliyet, Run) aynen durur. Aşağıdakiler AI Cockpit eklemeleridir.

<p align="center">
  <a href="images/cockpit/dashboard.png"><img src="images/cockpit/dashboard.png" alt="Panel: canlı telemetri, önbellek isabeti, toplam tasarruf ve model kırılımı" width="100%"></a>
</p>

| Plan | Ajan Çalıştır (Cursor) |
| --- | --- |
| <a href="images/cockpit/plan.png"><img src="images/cockpit/plan.png" alt="Plan: aşamalar, çalışan görevler, sıra ve tahminler"></a> | <a href="images/cockpit/run-cursor.png"><img src="images/cockpit/run-cursor.png" alt="Cursor çalıştırma ve komut önizlemesi"></a> |
| **Topluluk** | **Oturumlar** |
| <a href="images/cockpit/community.png"><img src="images/cockpit/community.png" alt="Topluluk: ortak iş kuyruğu"></a> | <a href="images/cockpit/sessions.png"><img src="images/cockpit/sessions.png" alt="Oturumlar"></a> |
| **Kanban** | |
| <a href="images/cockpit/kanban.png"><img src="images/cockpit/kanban.png" alt="Kanban panosu"></a> | |

Ekran görüntüleri örnek veriyle çekildi.

## Ne ekler

- **Plan**: herhangi bir projenin plan Markdown dosyasını ekle. `#`/`##` başlıkları aşama, `### Task 3a:` / `### Görev 17c:` başlıkları görev olur. Bitti/bekliyor elle işaretlenir; "çalışıyor" otomatik gelir (çalışan bir oturumun ya da alt ajanın isteminde görev kimliği geçiyorsa). Sıradaki işler yukarı/aşağı oklarıyla sıralanır. Tahmini süreler, biten görevlerin gerçek oturum sürelerinin medyanından hesaplanır ve "tahmin" diye etiketlenir.
- **Canlı telemetri**: dakikada token, önbellek isabeti, önbellek sayesinde toplam tasarruf (API liste fiyatıyla) ve Claude, Codex/GPT, Cursor, Gemini modellerine göre kırılım; son 1 saatin dakikalık grafiği.
- **Topluluk**: GitHub Issues üzerinde ortak iş kuyruğu. `cockpit-task` etiketli açık issue'lar görevdir, `est:3h` gibi etiketler tahmini süredir. "Al ve başlat" issue'yu sana atar (başkası aldıysa reddeder), yerel klonunda `task/<no>-...` dalını açar ve Ajan Çalıştır'ı görev metniyle doldurur; ajanı sen başlatırsın. "PR gönder" önce `git push` ve `gh pr create` komutlarını ve gidecek commit'leri gösterir, onayınla `Closes #<no>` içeren PR'ı açar. Herkes kendi `gh` oturumu ve kendi AI aboneliğiyle çalışır; hesap ya da limit paylaşılmaz, dökümler hiçbir yere gitmez.
- **Fiyat senkronu**: Ayarlar'daki "LiteLLM'den senkronize et" düğmesi LiteLLM'in açık model fiyat listesini çeker ve yalnız kullandığın modellerin eksik ya da farklı fiyatlarını günceller (mevcut satırlarda hızlı mod, 1 saatlik önbellek ve uzun bağlam fiyatları korunur; Cursor kendi faturalandırmasıyla kalır). Haftada bir kendiliğinden yalnız kontrol edilir; fark varsa Panel'de uyarı çıkar. Dışarı giden tek şey fiyat listesine yapılan GET isteğidir; `AI_COCKPIT_PRICE_CHECK=0` haftalık kontrolü kapatır.
- **Topluluk ekibi**: depo bağlanınca üyeler ve rolleri (GitHub: admin/maintain/write..., GitLab: owner/maintainer/developer..., yerel: commit sahipleri) ve her birinin aktif/bitmiş görev sayısı gelir. Klon yolu "Gözat" ile ev dizini altından seçilebilir.
- **Giden istemler**: Claude alt ajanlarına ve Bash ile başlatılan Cursor, Codex, Gemini ve `claude -p` çağrılarına giden istemler; model, çalışma klasörü ve oturumla birlikte. İstem bir dosyadaysa (`"$(cat brief.md)"`) yalnız ajanın kendi çalışma klasörünün içindeki, gizli olmayan bir dosyadan en fazla 20 KB okunur.
- **Tekrar okunan dosyalar** (token tasarrufu v1): son 7 günde ajanların tekrar tekrar okuduğu dosyalar ve bunun yaklaşık bağlam tokenı maliyeti; özetleyip devir istemine ya da CLAUDE.md'ye koymak için aday listesi.
- **Plan tahmini**: ölçülmüş ajan süresi yoksa takvim temposuna düşer (plan dosyasının git'e girdiği günden bu yana geçen süre / biten görev); ekranda "takvim temposu" diye etiketlenir.
- **Dar ekran**: telefonda kenar çubuğu ikon şeridine iner, dokununca içeriğin üzerine açılır.
- **Samba**: köşedeki yardımcı, beyaz-kahverengi bir İngiliz Seteri.
- **Kullanım limitleri**: Codex 5 saatlik/haftalık limit loglardan okunur. Claude Code limitleri yalnız durum satırına bildirir; bağlamak için aşağıya bak.
- **Gemini CLI** oturumları (`~/.gemini/tmp/*/chats/session-*.json`) salt okunur içe alınır.
- **Cursor'dan ajan başlatma**: Ajan Çalıştır sayfasında Cursor seçilir; tam `cursor-agent` komutu başlatmadan önce önizlenir, "Bu klasöre güven (--trust)" açıkça işaretlenmeden güvenilmeyen klasörde çalışmaz, durdurma düğmesi vardır.
- **Türkçe arayüz** (varsayılan; es/ko/vi/zh/en de var), "AI Cockpit" adı, **açık/koyu/sistem teması** (kenar çubuğunun altında).

## Kurulum ve açma

Node 22.22+ gerekir.

```bash
git clone <bu depo> ~/ai-cockpit
ln -s ~/ai-cockpit/bin/ai-cockpit ~/.local/bin/ai-cockpit   # bir kez
ai-cockpit start      # başlatır ve tarayıcıda açar: http://localhost:4820
ai-cockpit stop       # durdurur
ai-cockpit restart    # yeniden başlatır (kod güncellemesinden sonra)
ai-cockpit status     # çalışıyor mu
```

Sunucu arka planda çalışır, terminali kapatsan da açık kalır. Log ve pid: `~/.ai-cockpit/server.log`, `~/.ai-cockpit/server.pid`. Port değiştirmek için `AI_COCKPIT_PORT=4900 ai-cockpit start`.

İlk açılışta Claude Code hook'ları `~/.claude/settings.json`'a eklenir (yalnız `localhost`'a, en geç 2.5 sn içinde biten olay gönderimi). Geliştirme modu: `DASHBOARD_UPDATE_CHECK=0 npm run dev` (http://localhost:5173).

npm kurulum betiklerinden yalnız `better-sqlite3` onaylıdır (`package.json` > `allowScripts`); `@scarf/scarf` analitik betiği çalışmaz.

## Tailscale ile uzaktan erişim

Tailscale çalışıyorsa `ai-cockpit start` kokpiti tailnet içine de açar: `https://<makine-adı>.<tailnet>.ts.net:8443`. Sunucu yine yalnız `127.0.0.1`'e bağlıdır; dışarıya açılmaz, `tailscale serve` yalnız tailnet cihazlarına HTTPS ile yönlendirir. `ai-cockpit stop` paylaşımı da kapatır.

- İlk kullanımda tailnet yönetici panelinde **Serve** (ve HTTPS sertifikaları) bir kez açılmalı; kapalıysa betik 15 sn bekleyip açma bağlantısını `~/.ai-cockpit/server.log`'a yazar.
- Kapatmak için `AI_COCKPIT_TAILSCALE=0 ai-cockpit start`, port değiştirmek için `AI_COCKPIT_TS_PORT=443`.
- Kokpitten ajan başlatılabildiği için tailnet'ini başkalarıyla paylaşıyorsan `DASHBOARD_TOKEN` ile bir erişim anahtarı tanımla.

## Başka bilgisayardan erişim ve uzak ajanlar

`ai-cockpit start` kokpiti varsayılan olarak başka cihazlara da açar. Yerel taraf `http://127.0.0.1:4820` olarak kalır (dışarıya kapalı); dış ağa **yalnız HTTPS** ile ayrı bir dinleyici açılır (`https://<ip>:4821`).

- İlk açılışta bu makinenin adı ve IP'leri için bir TLS sertifikası, bir erişim anahtarı ve bir hook anahtarı üretilir (`~/.ai-cockpit/`, yalnız senin okuyabileceğin izinlerle).
- Başlatıcı her IP için `https://<ip>:4821/#token=...` bağlantısını ve sertifikanın SHA256 parmak izini yazar. `#token` kısmı sunucuya gönderilmez; tarayıcı anahtarı saklar ve adres çubuğundan siler. Anahtarsız gelen tarayıcıya anahtar soran bir pencere çıkar.
- Tarayıcı kendi üretilmiş sertifika için bir kez uyarı verir; parmak izi aynıysa kabul et. Tailscale açıksa `https://<makine>.ts.net:8443` gerçek sertifikayla çalışır.
- `ai-cockpit start --local` yalnız o çalıştırma için kokpiti yerelde tutar.

**Uzak ajan (Go, tek dosya):** ajanların çalıştığı makinede Node ya da kokpit kurmaya gerek yok.

```bash
cd agent && ./build.sh --all          # bin/ai-cockpit-agent ve dist/ altında macOS, Linux, Windows
ai-cockpit-agent connect https://<kokpit-ip>:4821 <hook-anahtarı> <sha256-parmak-izi>
ai-cockpit-agent install              # Claude Code hook'larını ekler (önce yedek alır)
ai-cockpit-agent status
```

- Veri yalnız HTTPS ile gider; kendi üretilmiş sertifikada parmak izi zorunludur ve sertifika sabitlenir (araya giren biri taklit edemez). `.ts.net` adreslerinde sistem sertifikalarına güvenilir.
- Her olay ayrı bir süreç olarak birkaç milisaniyede gönderilir; kokpite ulaşılamazsa ajan asla beklemez.
- `ai-cockpit-agent uninstall` hook'ları, `disconnect` bağlantıyı kaldırır.

## Claude limitleri

Claude Code `rate_limits` bilgisini yalnız statusline komutuna verir. `statusline/cockpit-tee.js` girdiyi `~/.ai-cockpit/claude-limits.json`'a yazar ve mevcut statusline komutuna aynen aktarır. `~/.claude/settings.json` içinde:

```json
"statusLine": {
  "type": "command",
  "command": "node /Users/<sen>/ai-cockpit/statusline/cockpit-tee.js -- \"<önceki statusline komutun>\""
}
```

## Lisans

AI Cockpit GNU GPL v3 (veya sonraki sürümler) altındadır, bkz. [LICENSE](./LICENSE). Taban projeden gelen kod MIT lisanslıdır; özgün telif ve izin notu [LICENSE-MIT](./LICENSE-MIT) dosyasında korunur.

## Veriler nerede

- Kokpit veritabanı: `~/.claude/agent-dashboard/dashboard.db` (yerel SQLite).
- Plan listesi, elle işaretler ve sıra: `~/.ai-cockpit/plans.json`.
- GitHub güncelleme denetimi başlatıcıda kapalıdır (`DASHBOARD_UPDATE_CHECK=0`). Webhook ve push bildirimleri yalnız Ayarlar'dan açıkça kurulursa dışarı bağlanır.

## Bilinen sınırlar

- Etkileşimli Cursor sohbetlerinin içeriği `~/.cursor/chats` altında şifreli tutulduğu için okunamaz; o oturumlar listede görünür ama hangi görev üzerinde çalıştıkları algılanmaz. Kokpitten başlatılan Cursor çalıştırmaları tam görünür.

---

# Agent Dashboard for Claude Code, Cursor & Codex

### A local-first control room for AI coding agents

Monitor Claude Code, Cursor, and Codex sessions in real time. Follow conversations and tools, inspect agent hierarchies, understand token usage and cost, analyze orchestration, and operate local agents from one responsive dashboard.

> [!TIP]
> **Complete guides:** [English](./README-EN.md) · [中文](./README-CN.md) · [Tiếng Việt](./README-VN.md) · [한국어](./README-KO.md) · [Español](./README-ES.md)

![Claude Code](https://img.shields.io/badge/Claude_Code-orange?style=flat-square&logo=claude&logoColor=white)
![Cursor](https://img.shields.io/badge/Cursor-111827?style=flat-square&logo=cursor&logoColor=white)
![OpenAI Codex](https://img.shields.io/badge/OpenAI_Codex-blue?style=flat-square&logo=githubcopilot&logoColor=white)
![Claude Code Plugins](https://img.shields.io/badge/Claude_Code_&_Codex-Plugins_&_Skills-orange?style=flat-square&logo=anthropic&logoColor=white)
![Model Context Protocol](https://img.shields.io/badge/Model_Context_Protocol-1.0-0f766e?style=flat-square&logo=modelcontextprotocol&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.22-339933?style=flat-square&logo=node.js&logoColor=white)
![Python](https://img.shields.io/badge/Python-%3E%3D3.6-3776AB?style=flat-square&logo=python&logoColor=white)
![Express](https://img.shields.io/badge/Express-4.21-000000?style=flat-square&logo=express&logoColor=white)
![ws](https://img.shields.io/badge/ws-WebSocket_server-010101?style=flat-square&logo=socketdotio&logoColor=white)
![web-push](https://img.shields.io/badge/web--push-VAPID-3b82f6?style=flat-square&logo=javascript&logoColor=white)
![swagger-ui-express](https://img.shields.io/badge/swagger--ui--express-5.0-85EA2D?style=flat-square&logo=swagger&logoColor=white)
![multer](https://img.shields.io/badge/multer-multipart_upload-FF6B6B?style=flat-square&logo=express&logoColor=white)
![adm-zip](https://img.shields.io/badge/adm--zip-archive_extract-FBBF24?style=flat-square&logo=files&logoColor=white)
![tar](https://img.shields.io/badge/tar-tgz_extract-A78BFA?style=flat-square&logo=gnu&logoColor=white)
![Commander CLI](https://img.shields.io/badge/Commander_CLI-14-F05032?style=flat-square&logo=gnubash&logoColor=white)
![React](https://img.shields.io/badge/React-19.2-61DAFB?style=flat-square&logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Javascript](https://img.shields.io/badge/JavaScript-ES6-F7DF1E?style=flat-square&logo=javascript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-7.3-646CFF?style=flat-square&logo=vite&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3.4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)
![PostCSS](https://img.shields.io/badge/PostCSS-8.5-DD3A0A?style=flat-square&logo=postcss&logoColor=white)
![Autoprefixer](https://img.shields.io/badge/Autoprefixer-10.4-DD3735?style=flat-square&logo=autoprefixer&logoColor=white)
![React Router](https://img.shields.io/badge/React_Router-8.3-CA4245?style=flat-square&logo=reactrouter&logoColor=white)
![Lucide](https://img.shields.io/badge/Lucide_Icons-0.474-F56565?style=flat-square&logo=lucide&logoColor=white)
![D3.js](https://img.shields.io/badge/D3.js-7-F9A03C?style=flat-square&logo=d3&logoColor=white)
![Mermaid](https://img.shields.io/badge/Mermaid-10.2-ff3333?style=flat-square&logo=mermaid&logoColor=white)
![i18next](https://img.shields.io/badge/i18next-22.4-7A42FF?style=flat-square&logo=i18next&logoColor=white)
![i18next Language Detector](https://img.shields.io/badge/i18next_Language_Detector-6.1-7A42FF?style=flat-square&logo=i18next&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-3-003B57?style=flat-square&logo=sqlite&logoColor=white)
![better--sqlite3](https://img.shields.io/badge/better--sqlite3-11.7-003B57?style=flat-square&logo=sqlite&logoColor=white)
![better-sqlite3 WAL](https://img.shields.io/badge/better--sqlite3-WAL_mode-003B57?style=flat-square&logo=sqlite&logoColor=white)
![WebSocket](https://img.shields.io/badge/WebSocket-RFC_6455-010101?style=flat-square&logo=socketdotio&logoColor=white)
![SSE](https://img.shields.io/badge/SSE-Server_Sent_Events-FF6600?style=flat-square&logo=googlechrome&logoColor=white)
![OpenAPI](https://img.shields.io/badge/OpenAPI-3.0-000000?style=flat-square&logo=openapiinitiative&logoColor=white)
![Swagger](https://img.shields.io/badge/Swagger-3.0-85EA2D?style=flat-square&logo=swagger&logoColor=white)
![VS Code](https://img.shields.io/badge/VS_Code-Extension-007ACC?style=flat-square&logo=vscodium&logoColor=white)
![Electron](https://img.shields.io/badge/Electron-35-47848F?style=flat-square&logo=electron&logoColor=white)
![electron-builder](https://img.shields.io/badge/electron--builder-25.1-2c2e3b?style=flat-square&logo=electron&logoColor=white)
![macOS](https://img.shields.io/badge/macOS-Desktop_App-000000?style=flat-square&logo=apple&logoColor=white)
![Windows](https://img.shields.io/badge/Windows-Desktop_App-0078D6?style=flat-square&logo=windows&logoColor=white)
![SMAppService](https://img.shields.io/badge/SMAppService-Login_Items-000000?style=flat-square&logo=apple&logoColor=white)
![macOS DMG](https://img.shields.io/badge/macOS_DMG-arm64_%2B_x64-7c3aed?style=flat-square&logo=apple&logoColor=white)
![NSIS Installer](https://img.shields.io/badge/Windows-NSIS_%2B_Portable-1f6feb?style=flat-square&logo=windows&logoColor=white)
![Vitest](https://img.shields.io/badge/Vitest-1.0-646CFF?style=flat-square&logo=vitest&logoColor=white)
![React Testing Library](https://img.shields.io/badge/React_Testing_Library-13.0-FF5733?style=flat-square&logo=testinglibrary&logoColor=white)
![ESLint](https://img.shields.io/badge/ESLint-8.44-4B32C3?style=flat-square&logo=eslint&logoColor=white)
![Prettier](https://img.shields.io/badge/Prettier-3.8-F7B93E?style=flat-square&logo=prettier&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-20.10-2496ED?style=flat-square&logo=docker&logoColor=white)
![Podman](https://img.shields.io/badge/Podman-4.0-CC342D?style=flat-square&logo=podman&logoColor=white)
![Open Container Initiative](https://img.shields.io/badge/Open_Container_Initiative-OCI-000000?style=flat-square&logo=opencontainersinitiative&logoColor=white)
![Prometheus](https://img.shields.io/badge/Prometheus-3.13-E6522C?style=flat-square&logo=prometheus&logoColor=white)
![Grafana](https://img.shields.io/badge/Grafana-13.1-F46800?style=flat-square&logo=grafana&logoColor=white)
![Terraform](https://img.shields.io/badge/Terraform-%3E%3D1.7-844FBA?style=flat-square&logo=terraform&logoColor=white)
![Kubernetes](https://img.shields.io/badge/Kubernetes-%3E%3D1.29-326CE5?style=flat-square&logo=kubernetes&logoColor=white)
![Helm](https://img.shields.io/badge/Helm-4-0F1689?style=flat-square&logo=helm&logoColor=white)
![Kustomize](https://img.shields.io/badge/Kustomize-5.0-326CE5?style=flat-square&logo=kubernetes&logoColor=white)
![Nginx](https://img.shields.io/badge/Nginx-Ingress-009639?style=flat-square&logo=nginx&logoColor=white)
![Coralogix](https://img.shields.io/badge/Coralogix-Observability-1a1a2e?style=flat-square&logo=datadog&logoColor=white)
![OpenTelemetry](https://img.shields.io/badge/OpenTelemetry-Collector-4f46e5?style=flat-square&logo=opentelemetry&logoColor=white)
![AWS](https://img.shields.io/badge/AWS-ECS%20%7C%20RDS-232F3E?style=flat-square&logo=task&logoColor=white)
![Google Cloud](https://img.shields.io/badge/Google_Cloud-GKE%20%7C%20SQL-4285F4?style=flat-square&logo=googlecloud&logoColor=white)
![Azure](https://img.shields.io/badge/Azure-AKS%20%7C%20SQL-0078D4?style=flat-square&logo=cloudflare&logoColor=white)
![Oracle Cloud](https://img.shields.io/badge/Oracle_Cloud-OKE%20%7C%20DB-F80000?style=flat-square&logo=cloudways&logoColor=white)
![GitHub Actions](https://img.shields.io/badge/GitHub_Actions-pipelines-2088FF?style=flat-square&logo=githubactions&logoColor=white)
![Make](https://img.shields.io/badge/Make-4.3-000000?style=flat-square&logo=make&logoColor=white)
![Auto Release](https://img.shields.io/badge/CI-auto--release_to_GitHub-22c55e?style=flat-square&logo=githubactions&logoColor=white)
![GPLv3 License](https://img.shields.io/badge/License-GPLv3-blue?style=flat-square)

<p align="center">
  <a href="images/analytics.png"><img src="images/readme/analytics.png" alt="CCAM dashboard with live agent and session activity" width="100%"></a>
  <br>
  <em>Live fleet state, active work, recent events, cost, and system health.</em>
</p>

## See what your agents are doing

CCAM combines native hooks with provider-aware transcript discovery. It stays local by default and turns agent activity into a searchable, durable operational record.

- **One live fleet:** Claude Code, Cursor, and Codex sessions appear in the same Dashboard, Sessions, Activity Feed, and Kanban views.
- **Complete conversations:** Rendered Markdown, highlighted code, tool calls, command output, queued prompts, attachments, and provider-native titles.
- **Agent orchestration:** Parent-child trees, background agents, dynamic workflow runs, tool-flow graphs, concurrency, delegation, and compaction analysis.
- **Cost and usage:** Model-aware tokens, configurable pricing, introductory rates, subagent costs, trends, and budget-friendly CLI/MCP access.
- **Run and resume agents:** Launch Claude Code or Codex, stream output, send follow-ups, resume previous work, and reattach to background runs.
- **Configuration visibility:** Inspect Claude Code and Codex settings, skills, hooks, MCP servers, rules, plugins, memory, profiles, and instructions.
- **Operational safety:** Loopback binding, optional authentication, guarded mutations, backup-first edits, bounded uploads, and no automatic self-update.
- **Team-ready delivery:** Desktop applications, containers, Kubernetes, Terraform, monitoring, alerts, webhooks, and remote data sources.

## See CCAM in action

<p align="center">
  <a href="images/session-conversation.png"><img src="images/readme/session-conversation.png" alt="Rendered agent conversation with code and tool activity" width="100%"></a>
  <br>
  <em>Conversation history with code, tools, reasoning, and session context.</em>
</p>

<p align="center">
  <a href="images/workflows.png"><img src="images/readme/workflows.png" alt="Workflow and orchestration analytics" width="100%"></a>
  <br>
  <em>Workflow intelligence for orchestration, delegation, tools, errors, and concurrency.</em>
</p>

<p align="center">
  <a href="images/config.png"><img src="images/readme/config.png" alt="Claude Code and Codex configuration explorers" width="100%"></a>
  <br>
  <em>Provider-aware configuration, skills, hooks, plugins, MCP, rules, and memory.</em>
</p>

<p align="center">
  <a href="images/run.png"><img src="images/readme/run.png" alt="Run Agent provider selection" width="100%"></a>
  <br>
  <em>Launch and manage Claude Code or Codex without leaving the dashboard.</em>
</p>

## Quick start

**Requirements:** Node.js 22.22 or newer and npm 9 or newer.

```bash
git clone https://github.com/hoangsonww/Claude-Code-Agent-Monitor.git
cd Claude-Code-Agent-Monitor
npm run setup
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). `npm run setup` installs the root, client, and VS Code extension dependencies, builds the MCP server, and links the `ccam` CLI. On first launch, follow the dashboard prompt to install hooks for the providers you select, or run `npm run install-hooks` manually.

For production, run `npm run build && npm start` and open [http://localhost:4820](http://localhost:4820).

Before an upgrade that may recount usage, capture and compare read-only cost snapshots:

```bash
node scripts/cost-snapshot.js snapshot --out before.tsv
# Upgrade and restart CCAM, then let startup maintenance finish.
node scripts/cost-snapshot.js snapshot --out after.tsv
node scripts/cost-snapshot.js compare before.tsv after.tsv --fail-on-local-change
```

Keep these TSV files private because they contain session identifiers and ownership metadata. The guard fails when an existing local session's usage or cost changes, ownership moves to or from local, or a local session disappears; remote and newly added sessions are reported separately. See the [complete upgrade safeguard](./README-EN.md#cost-snapshots-before-an-upgrade) for the exact compared fields.

## Choose how to run CCAM

| Option | Best for | Guide |
| --- | --- | --- |
| Source checkout | Development and local customization | [Full setup guide](./README-EN.md#quick-start) |
| Desktop app | A persistent macOS or Windows app with tray controls | [Desktop guide](./DESKTOP.md) |
| Docker or Podman | Isolated local or server deployments | [Deployment guide](./DEPLOYMENT.md) |
| Kubernetes or Terraform | Production infrastructure | [Deployment reference](./docs/DEPLOYMENT.md) |
| MCP sidecar | Agent-driven dashboard queries and guarded operations | [MCP guide](./mcp/README.md) |

## Extensions and automation

CCAM ships **14 plugins**, **66 plugin skills**, **18 Claude subagents**, **34 Claude commands**, and **77 total repository skills** across Claude Code and Codex formats.

```bash
claude plugin marketplace add hoangsonww/Claude-Code-Agent-Monitor
codex plugin marketplace add hoangsonww/Claude-Code-Agent-Monitor
npx skills add hoangsonww/Claude-Code-Agent-Monitor --list
```

The `ccam` CLI and local MCP server expose sessions, agents, events, transcripts, analytics, pricing, workflows, alerts, imports, configuration, remote sources, and maintenance operations for humans and automation.

## Documentation

- **Complete product and operational reference:** [README-EN.md](./README-EN.md)
- **Documentation index:** [docs/README.md](./docs/README.md)
- **Task-oriented handbook:** [GitHub Wiki](https://github.com/hoangsonww/Claude-Code-Agent-Monitor/wiki)
- **Localized product tour:** [Static Wiki](https://hoangsonww.github.io/Claude-Code-Agent-Monitor/wiki/)
- **Architecture:** [ARCHITECTURE.md](./ARCHITECTURE.md)
- **CLI:** [docs/CLI.md](./docs/CLI.md)
- **REST and OpenAPI:** [docs/API.md](./docs/API.md)
- **Hooks and lifecycle:** [docs/HOOKS.md](./docs/HOOKS.md)
- **Database:** [docs/DATABASE.md](./docs/DATABASE.md)
- **Plugins:** [docs/PLUGINS.md](./docs/PLUGINS.md)
- **MCP:** [docs/MCP.md](./docs/MCP.md) and [mcp/README.md](./mcp/README.md)
- **Desktop application:** [DESKTOP.md](./DESKTOP.md) and [desktop/README.md](./desktop/README.md)
- **Deployment:** [DEPLOYMENT.md](./DEPLOYMENT.md) and [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)
- **Security:** [.github/SECURITY.md](./.github/SECURITY.md)

## Local-first and secure by default

The dashboard binds to `127.0.0.1` by default. It does not require cloud credentials, and it does not transmit your transcripts or agent data to a hosted service. Optional tokens protect HTTP, WebSocket, hook, MCP, and remote-push surfaces when you deliberately expose them beyond loopback.

See the [security policy](./.github/SECURITY.md) and [full configuration reference](./README-EN.md#configuration) before enabling remote access.

## Contributing and support

- Read the [contributing guide](./.github/CONTRIBUTING.md).
- Report bugs through [GitHub Issues](https://github.com/hoangsonww/Claude-Code-Agent-Monitor/issues).
- Ask questions and share ideas in [GitHub Discussions](https://github.com/hoangsonww/Claude-Code-Agent-Monitor/discussions).
- Follow the [Code of Conduct](./.github/CODE_OF_CONDUCT.md).

## License

GPL-3.0-or-later. See [LICENSE](./LICENSE). Upstream MIT notice: [LICENSE-MIT](./LICENSE-MIT).
