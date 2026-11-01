# AI Cockpit — tasarım

Tarih: 2026-11-01. Taban: [hoangsonww/Claude-Code-Agent-Monitor](https://github.com/hoangsonww/Claude-Code-Agent-Monitor) v2.4.5 (MIT), `upstream` remote olarak duruyor.

## Neden

AI ile kod geliştirirken iş birden fazla ajana dağılıyor (ör. Claude Opus inceler, Cursor CLI üzerinden başka bir model yazar). Ajanlar arka planda çalışırken ne yaptıkları, plan içinde nerede olunduğu, ne zaman biteceği ve limitin ne kadar kaldığı görünmüyor. İstek: tek ekranda **proje kokpiti**: plan aşamaları, hangi ajan ne durumda, tahmini bitiş, harcanan token, kalan haftalık/5 saatlik limit, bekleyen işler sırası ve tahmini süreleri.

## Tabandan hazır gelenler (dokunulmaz)

- Claude Code (hook + döküm), Cursor (`~/.cursor/chats`, state DB), Codex (`~/.codex/sessions`) oturumları; canlı akış (WebSocket), oturum detayı, alt ajan ağacı, Kanban, analiz, token/maliyet.
- Run sayfası: Claude Code ve Codex'i panodan başlatma, çıktı akışı, devam ettirme.
- Yerel: 127.0.0.1, SQLite, telemetri yok. Webhook/push yalnız açıkça ayarlanırsa.

## Eklenecekler (ai-cockpit v1)

1. **Türkçe arayüz**: `tr` dili, varsayılan Türkçe. Mevcut i18n yapısı (`client/src/i18n/locales/<dil>/*.json`) kullanılır.
2. **Limitler**:
   - Codex: rollout loglarındaki `rate_limits` (5 saat ve haftalık `used_percent`, `resets_at`) okunur. Doğrulandı.
   - Claude Code: limit yalnız statusline girdisinde (`rate_limits.five_hour/seven_day.used_percentage`, `resets_at`). Doğrulandı (CLI 2.1.304). Küçük bir "tee" betiği girdiyi `~/.ai-cockpit/claude-limits.json`'a yazar ve mevcut statusline komutuna aynen aktarır. `settings.json` değişikliği kullanıcı onayıyla yapılır.
   - Panoda iki halka: kullanılan %, sıfırlanma saati. Veri yoksa "bilinmiyor", tahmin uydurulmaz.
3. **Plan sayfası**: proje başına bir plan Markdown dosyası ayarlanır (ör. `~/projem/docs/plans/plan.md`).
   - `## ` başlıkları aşama, `### Task <id>:` / `### Görev <id>:` başlıkları görev.
   - Durum: `bitti / sürüyor / sırada / bekliyor(bloklu)`. Bitti ve bloklu kullanıcı işaretler (kokpitte saklanır). "Sürüyor" otomatik: çalışan bir ajan oturumunun isteminde görev kimliği geçiyorsa (`Görev 17a`, `Task 17a`, `17a`).
   - Sıra: plan sırası, sürükleyerek değiştirilebilir.
   - Tahmini süre: görev kimliğinin geçtiği oturumların gerçek süresinden; biten görevlerin medyanı kalanlar için varsayılan. Ekranda "tahmin" etiketiyle. Toplam: kalan işler × tahmin → yaklaşık bitiş tarihi.
4. **Gemini CLI kaynağı**: `~/.gemini/tmp/<hash>/chats/session-*.json` salt okunur içe alınır (oturum, mesajlar, varsa token).
5. **Cursor başlatma**: Run sayfasına `cursor-agent -p --output-format stream-json --model <m>` sağlayıcısı; başlatmadan önce tam komut önizlemesi, durdurma düğmesi.
6. **Ad ve görünüm**: "AI Cockpit". Yeni ekranlar Apple kalitesinde (apple-design), açık/koyu tema, dar ekran.

## Kapsam dışı (v1)

- Bulut/çok cihaz senkronu, ekip paylaşımı.
- Planı ajanların kendiliğinden güncellemesi.
- Limitin olasılıksal tahmini (yalnız ölçülen değer).

## Kısıtlar

- Veri dışarı gitmez. `DASHBOARD_UPDATE_CHECK=0` varsayılan (GitHub'a periyodik `git fetch` kapalı).
- Upstream ile birleşebilir kalmak için değişiklikler mümkün olduğunca yeni dosyalarda.
- npm install betiklerinden yalnız `better-sqlite3` onaylı; `@scarf/scarf` (analitik) onaylanmadı.

## Uygulayıcıya bırakılanlar

Bileşen yapısı, SQLite şeması eklemeleri, test ayrıntıları.
