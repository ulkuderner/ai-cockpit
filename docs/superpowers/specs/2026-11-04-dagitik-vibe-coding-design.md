# Dağıtık Vibe Coding - Tasarım

Tarih: 2026-11-04. Durum: onaylandı (4 Kasım 2026); inceleme notu işlendi, açık soru yok. Önceki belge: `2026-11-02-merkezi-ekip-kokpiti-design.md` (beklemede; buradaki kararlar aksi yazılmadıkça sürer, değişenler "ÖNCEKİ KARARI DEĞİŞTİRİR" ile işaretlidir).

## Amaç ve neden

Bir proje bir kez planlanır; plan iş parçalarına bölünür; birden çok kişi, her biri kendi yapay zeka ajanıyla (Claude Code, Codex, Cursor, Gemini, Hermes, yerel modeller), bu parçaları alır ve yürütür; merkez tüm akışı izler: kim neyi yapıyor, ne kadar ilerledi, kaça mal oldu, kimin limiti kaldı. Buna "dağıtık vibe coding" diyoruz.

Önceki istekler bu döngünün içine oturur:

- Çoklu model ve aynı sağlayıcıda çoklu hesap; herkes kendi sistemini bağlar, başkası ona iş gönderebilir.
- claude-code-router (ccr) ile yerel yönlendirme, ya da merkezi tek geçit.
- Yerel modeller (Ollama Qwen, LM Studio).
- Ajanlar arası bağlam aktarımı (claude-mem).
- İşin ihtiyacına göre otomatik yükseltme/ucuzlatma/hesap değiştirme önerisi.
- Yeniden yazmak yerine açık kaynak projeleri bağlamak.

Bugünkü kokpitte çekirdek zaten var: `server/lib/plan.js` plan dosyasını görevlere ayırır ve SDD defterinden ilerleme okur; `server/lib/community.js` GitHub/GitLab issue tabanlı ortak iş kuyruğu sunar ("Al ve başlat" issue'yu atar, `task/<no>-...` dalını açar, Ajan Çalıştır'ı doldurur; "PR gönder" `Closes #<no>` ile PR açar); `run-spawner.js`, `codex-run-spawner.js`, `cursor-run-spawner.js` ajanı yerelde başlatır ve denetler. Bu belge o parçaları tek döngüye bağlar.

## Kararlar (kullanıcının)

- Planlama bir kez yapılır, yürütme dağıtıktır, izleme merkezidir.
- Her kişi kendi ajanını ve kendi hesabını kullanır; başkası ona iş gönderebilir.
- ccr yerel yönlendirici olarak kullanılır; kokpit onu kurup yapılandırabilir. Merkezi geçit seçeneği de olur.
- Yerel modeller birinci sınıf seçenektir.
- Bağlam aktarımı claude-mem üzerinden yapılır.
- Sistem yükseltme/ucuzlatma/hesap değiştirme önerir.
- İş tahtasının doğruluk kaynağı reponun issue sistemidir (GitHub/GitLab; yalnız yerel repoda `.ai-cockpit/board/`). Merkez tahtayı aynalar, ayrı tahta tutmaz. (4 Kasım 2026)
- Ekip liderinden gelen iş isteğinin onaysız başlayıp başlamayacağına işi alan kişi karar verir: kendi kokpitinde "liderimin işleri onaysız başlasın" iznini açar ya da kapalı tutar. İzin kapalıysa lider isteği de onay kartına düşer. Diğer herkesten gelen istek her zaman sahibinin onayını bekler. (4 Kasım 2026, ilk karar güncellendi)
- Ekip adına çalışan havuz ajanı makinesi ilk sürümde vardır. (4 Kasım 2026)
- Model kaynağı hibrittir: şirket API anahtarı alınır ve yerel modeller (geliştiricide Ollama, sunucuda Qwen) birlikte kullanılır. Kişisel abonelikler sahibinde kalır. (4 Kasım 2026)
- İlk tercih, kişinin kendi aboneliğiyle resmi CLI'dır (Claude Code, Codex CLI, Gemini CLI). Gerekçe: abonelikler CLI ve masaüstü uygulamasından API'ye göre daha yüksek kullanım veriyor. (4 Kasım 2026)
- Küçük görevlerde otomatik birleştirme ilk sürümde vardır; bir görevin otomatik birleşip birleşmeyeceğine ekip lideri işi verirken (iş isteğinde ya da görevi tahtaya açarken) karar verir. (4 Kasım 2026, ilk karar güncellendi)
- Nevo'nun Hermes pilot makinesi ilk havuz ajanıdır; Mattermost ekip bildirim kanalıdır. (4 Kasım 2026)
- Ekip hafızası mcp-memory-service (doobidoo) ile kurulur: merkezde şirket içinde çalışan tek sunucu; kişisel hafıza claude-mem'de kalır. (4 Kasım 2026)
- Önceki merkezi plan kararları sürer: 50+ kişi, ekip görünürlüğü, maskeleme, cihaz eşleştirme, PostgreSQL, Docker, yalnız HTTPS, GPL-3.0, "Developed by Caglar Ulkuderner".

## Fable'ın kararları

1. **Döngü çekirdektir, iş isteği eklenti değil.** Plan -> görev -> al -> çalıştır -> raporla -> incele -> birleştir -> ilerleme. Her ekran ve her veri bu döngünün bir adımına bağlanır.
2. **İş tahtasının doğruluk kaynağı reponun kendi issue sistemidir** (GitHub Issues / GitLab Issues; yalnız yerel repo için reponun içindeki `.ai-cockpit/board/` klasörü). Gerekçe: `community.js` bunu zaten yapıyor; merkez kapalıyken tahta çalışır; ekip zaten issue kullanıyor. Merkez tahtayı aynalar ve üstüne dağıtım, maliyet ve izleme koyar; kendi ayrı tahtası yoktur. (Önceki spec "İş paketleri plan dosyasından okunur" dedi; plan dosyası kaynak kalır, issue'lar ondan üretilir.)
3. **ÖNCEKİ KARARI DEĞİŞTİRİR: merkez iş isteği iletir; çalıştıran her zaman sahibinin makinesidir.** Önceki "merkez yalnız izler, ajan çalıştırmaz" kararı yerine: merkez hiçbir ajanı kendisi çalıştırmaz, hiçbir anahtar tutmaz; bir iş isteğini hedef kişinin cihazına iletir. İş, o kişinin yerel kokpitinde, onun onayıyla (ekip liderinden gelen istekte onaysız), onun hesabıyla, görev dalına açılmış ayrı bir worktree içinde çalışır. Kill switch iki tarafta da vardır; her adım merkezde denetim kaydına düşer.
4. **Abonelik OAuth belirteçleri hiçbir geçitten geçmez.** Kaynak (4 Kasım 2026'da resmi sayfalardan doğrulandı): Claude Code "Legal and compliance" sayfası, "Authentication and credential use" bölümü: OAuth girişi abonelik planlarının (Free/Pro/Max/Ultra/Team/Enterprise) Claude Code ve Anthropic'in kendi uygulamalarındaki olağan kullanımı içindir; ürün veya servis geliştirenler (Agent SDK dahil) API anahtarı kullanır; Claude.ai kimlik bilgisi veya oturum belirteci toplanamaz, saklanamaz, aracılık edilemez. Aynı sayfa müşterinin kendi API anahtarını kendi yetkili kullanıcıları için bir makine imajına koymasına izin verir (havuz makinesinin dayanağı budur). Tüketici Koşulları'nda ilgili madde Bölüm 3'ün 7. maddesidir (bot/script ile otomatik erişim yalnız API anahtarıyla); uyum sayfası madde numarası vermez, önceki taslaktaki "3.7" bu maddeye karşılık gelir. Kural: havuzlanan tek şey API anahtarıdır. Claude Code abonelikle çalışırken Anthropic'e doğrudan gider; ccr ve LiteLLM yalnız API anahtarlı sağlayıcıları ve yerel modelleri taşır. Codex/ChatGPT ve Gemini abonelikleri için aynı varsayım uygulanır (builder sağlayıcı koşullarını doğrular).
5. **Görev çakışması önleme: alan + dal + bağımlılık.** Her görevin `alan` (dosya/klasör desenleri), `bağlı` (önce bitmesi gereken görev numaraları) ve `est` alanı vardır. Aynı alanı kesen iki görev aynı anda alınamaz (tahta uyarır, ikinciyi bekletir). Her görev `task/<no>-...` dalında ve ayrı git worktree'de çalışır. Bağımlılığı bitmemiş görev "hazır" listesine girmez.
6. **İnceleme ve birleştirme PR üzerinden; insan kapısı varsayılan, küçük görevlerde otomatik birleştirme.** Sonuç PR/MR olur; kokpit önce yerelde "gözden geçiren ajan" çalıştırır (abonelikli CLI, salt okur, yorum üretir); PR'da bu yorum ve maliyet görünür; birleştirmeyi insan yapar. Küçük görevlerde otomatik birleştirme vardır (kullanıcının kararı). Karar görev başınadır: ekip lideri işi verirken "otomatik birleştir" işaretler (kullanıcının kararı); işaret yoksa insan birleştirir. İşaret olsa bile şu koşullar sağlanmazsa insan kapısına düşer (Claude'un kararı): görev tek dosya ve en çok ~50 satır değişiklik; testler ve CI yeşil; gözden geçiren ajan bulgu çıkarmadı; dal ana dalla çakışmasız; dokunulan dosya hassas listede değil (kimlik doğrulama, izinler, veritabanı göçleri, CI/CD yapılandırması, bağımlılık dosyaları, gizli anahtar içerebilecek yapılandırma; liste repo başına düzenlenir). Otomatik birleştirme denetim kaydına düşer, ekip lideri günlük özetinde görür ve tek tıkla geri alma (revert PR) sunulur. Ek koşullar (Fable'ın kararı, inceleme notu sonrası): veri etiketi "yalnız yerel model" olan repolarda (müşteri verisi, üretim sistemleri) otomatik birleştirme açılamaz, arayüz düğmeyi göstermez; otomatik birleştirme yalnız gözden geçiren ajan abonelikli CLI veya şirket API anahtarıyla çalıştıysa geçerlidir, yerel Qwen yedeğiyle yapılan inceleme insan kapısına düşer; gözden geçiren ajanın istemi diff içindeki metni veri sayar, oradaki talimatı uygulamaz ve "diff'te ajana yönelik talimat var" bulgusunu otomatik birleştirmeyi kesen bulgu olarak çıkarır. İnceleme notu otomatik birleştirmenin ilk aylarda tamamen kapalı kalmasını önerdi; kullanıcı bunun yerine görev başına liderin kararını seçti.
7. **Al/bırak kuralı.** Alınan görev için yerel kokpit kalp atışı gönderir (dalda commit, canlı oturum). Varsayılan 4 saat (yönetici ayarı) canlı oturum olmadan bekleyen görev "sahipsiz kalmış" diye işaretlenir; sahibi veya ekip lideri serbest bırakır; otomatik bırakma yoktur (yarım iş kaybolmasın). Kişi "bırak" dediğinde dal ve worktree kalır, issue atanması kaldırılır, "yarıda kaldı" notu ve son özet eklenir.
8. **Bağlam devri bir brief dosyasıdır.** Görev alınınca kokpit worktree içine `.ai-cockpit/brief.md` yazar: spec'in ilgili bölümü, plan görevi, bağlı görevlerin PR özetleri, aynı alandaki önceki görevlerden claude-mem gözlemleri (yerel HTTP API'den, maskelenmiş), açık kabul ölçütleri. Ajan ne olursa olsun bu dosyayla başlar. Ekip arası devirde brief merkez bağlam deposundan gelir (M5 sonrası); öncesinde PR metni tek devir aracıdır.
9. **Maliyet görev başına dal adıyla bağlanır.** `task/<no>` dalında çalışan her oturum (Claude, Codex, Cursor, Gemini, ccr kayıtları) o göreve yazılır; görev maliyeti = oturum toplamı; kişi/model/hesap kırılımı aynı veriden gelir. Önceki spec'teki oturum-iş paketi bağlama sırası (düzenlenen plan dosyası, dal adı, saat) korunur; dal adı öne çekilir.
10. **Havuz ajanı özel kod değildir.** "Merkezi tek kaynak" isteği, ekip adına bir servis kullanıcısına bağlı bir makinedir: üstünde yerel kokpit + ccr + Hermes/Claude Code, yalnız API anahtarı ve yerel modellerle. Kimse almayan görevler ona gönderilir; aynı döngüden geçer. Ayrı mimari yok. İlk sürümde vardır (kullanıcının kararı). İnceleme notu, önümüzdeki hafta başlayacak ayrı Hermes pilotunun (ayrı sunucu, Mattermost kanalı, Claude API + yerel model) bu havuz ajanının kendisi olmasını önerdi; tasarımla uyumludur, iki sistem kurulmaz. Koşullar (Fable'ın kararı, inceleme notu sonrası): o makinede yazılım işi bu belgedeki döngüden (issue, worktree, PR, denetim kaydı) geçer; yazılım dışı işler (müşteri yanıt taslağı, fatura) bu tasarımın kapsamı dışıdır ve aynı makinede ayrı izin setiyle durur, kokpit onları izlemez; Mattermost bildirim kanalıdır (kullanıcının kararı). Maliyet (Claude'un kararı): repoyu sahiplenen ekibe yazılır, isteği gönderen kişi ayrıca kırılımda görünür; ekip başına aylık havuz bütçesi tanımlanır, dolunca havuz yeni iş almaz. Havuz önce yerel modelleri (sunucuda Qwen), gerektiğinde şirket API anahtarını kullanır.
11. **A2A ilk sürümde yok.** İş isteği merkez-cihaz kanalından gider (M1 cihaz eşleştirmesi). Mesaj biçimi A2A Task durum adlarını (submitted, working, input-required, completed, failed, canceled) kullanır ki ileride dış ajanlara A2A köprüsü ucuz olsun.
12. **Öneri motoru kurallıdır, uygular değil önerir.** İlk sürümde beş kural (aşağıda); veri birikince geçmiş başarıya dayalı eşikler. RouteLLM bağımlılık değil, kaynak.
13. **Onaysız başlayan iş yalnız konteynerde çalışır (Fable'ın kararı, inceleme notu sonrası).** İnceleme notu haklı: iş isteği başkasının bilgisayarında komut çalıştırmaktır; worktree yalnız kodu ayırır, ajan aynı işletim sistemi kullanıcısıyla çalışırsa SSH anahtarlarına, bulut kimlik bilgilerine, müşteri bağlantılarına ve tarayıcı oturumlarına ulaşır. Ekip liderinin isteğinin onaysız başlaması kullanıcının kararıdır ve sürer; buna şu koşul eklenir: onaysız başlayan iş, kişisel anahtar barındırmayan bir konteynerde (reponun devcontainer'ı varsa o, yoksa kokpitin varsayılan imajı) çalışır; konteynere yalnız worktree bağlanır; ağ, repo başına tanımlı izinli sunucu listesiyle sınırlıdır (git uzak sunucusu, paket kayıtları, seçilen model sağlayıcısı); abonelikli CLI konteyner içinde çalışamıyorsa onaysız iş şirket API anahtarı veya yerel modelle çalışır. Makinede konteyner çalışma zamanı yoksa liderin isteği onay kartına düşer, onaysız başlamaz. Sahibinin onayladığı işler için konteyner varsayılan açık, sahibi kapatabilir. Issue gövdesi, yorumlar, brief.md ve PR açıklaması ajan için veridir, talimat değildir; kokpitin ürettiği her sistem istemi bunu açıkça yazar. M1 cihaz eşleştirmesinde iş isteği gönderenin anahtarıyla imzalanır, cihaz imzayı doğrular; merkez iş isteği dışında komut iletemez. Kullanıcı kararı: onaysız başlama izni işi alan kişidedir, varsayılan kapalı.
14. **Repo başına veri etiketi (Fable'ın kararı, inceleme notu sonrası).** Maskeleme brief'i korur ama kod, günlükler ve hata çıktısı bulut modele gidebilir; Profelis müşteri veritabanları ve sistemleri üstünde çalışır. Her repo iki etiketten birini taşır: "bulut serbest" veya "yalnız yerel model". Etiket ekip liderince konur, varsayılan "yalnız yerel model"dir. Uygulama sert kuraldır, alışkanlık değil: ccr ve LiteLLM "yalnız yerel model" repoda bulut rotasını reddeder; abonelikli CLI ccr'den geçmediği için kokpitin Ajan Çalıştır sayfası o repoda bulut ajanlarını (Claude Code, Codex, Gemini, Cursor) seçilemez yapar ve yalnız yerel model rotalarını sunar; gözden geçiren ajan da aynı kurala uyar. Etiket issue tahtasında ve görev kartında görünür. İstek içeriği tutan ccr ve hook kayıtları makinede kalır; merkeze yalnız özet (model, token, maliyet, süre, maskeleme sayısı) gider; bu, önceki spec'in "özet veri" kuralının açık yazımıdır.

## Hedef olmayanlar (ilk sürüm)

- Merkezin kendisinin ajan çalıştırması, konteyner havuzu (OpenHands tarzı) barındırması.
- A2A/MCP ile şirket dışı ajanlarla konuşma.
- Plan üretimi (PRD'den görev çıkarma); plan hâlâ insan + kendi ajanıyla yazılır, kokpit okur.
- Jira/Linear bağlayıcısı; GitHub ve GitLab ile başlanır.
- Kod inceleme aracı yazmak; gözden geçiren ajan mevcut CLI'ların salt okur çalıştırılmasıdır.

## Kaçınılacaklar (çalışsa bile başarısızlık sayılır)

- Bir kişinin abonelik OAuth belirtecinin başka bir kişi, geçit veya servis tarafından kullanılması.
- Sahibinin onayı olmadan bir makinede ajan başlaması; tek istisna, kendi ekibinin lideri tarafından, ekibin reposunda, bütçe ve süre tavanı yazılmış ve kişisel anahtarsız konteynerde çalışan istek.
- "Yalnız yerel model" etiketli repodan kod, günlük veya hata çıktısının bulut modele gitmesi.
- Issue, yorum, brief veya PR metnindeki bir talimatın ajan tarafından komut gibi uygulanması.
- Aynı dosyaları değiştiren iki görevin aynı anda "çalışıyor" olması ve bunun fark edilmemesi.
- Bir görevin kime ve kaça mal olduğunun bilinmemesi.
- Merkez kapalıyken görev alınamaması, PR açılamaması veya yerel ajanın yavaşlaması.
- Maskelenmemiş brief'in makineden çıkması.
- İş isteğinin sahibinin makinesinde worktree dışına, başka repoya veya ana dala yazması.

## Mimari

Üç katman, tek kod tabanı (önceki spec'teki "yerel toplayıcı + merkez modu" korunur, araya "iş tahtası" eklenir):

1. **Yerel kokpit** (bugünkü uygulama + eklentiler): plan okuyucu, iş tahtası istemcisi (community.js genişler), ccr kurulum/yapılandırma/kayıt okuma, yerel model izleme, brief üretici, ajan çalıştırıcı (mevcut spawner'lar), gözden geçiren ajan, iş isteği alıcısı, öneri motoru. Merkez olmadan tek kişi ve küçük ekip (GitHub/GitLab issue'larıyla) tam döngüyü çalıştırır.
2. **İş tahtası**: GitHub/GitLab Issues (`cockpit-task` etiketi) veya yalnız yerel repo için `.ai-cockpit/board/*.md`. Görev alanları issue gövdesinde sabit başlıklarla: `Alan:`, `Bağlı:`, `est:`, `Kabul:`. Plan dosyasından üretim: "Planı tahtaya aç" düğmesi her `### Task` için issue açar (varsa günceller), plan dosyasına `<!-- issue:#12 -->` yazar.
3. **Merkez** (M1-M6): kullanıcı/ekip/cihaz, tahtanın aynası, iş isteği kuyruğu ve denetim kaydı, görev/kişi/model/hesap maliyet toplamı, bağlam deposu, öneri motoru verisi, LiteLLM geçidi (şirket API anahtarı alınacağı için ilk sürümde).

### Çekirdek döngü

1. **Plan**: `docs/superpowers/plans/*.md` (plan.js okur). Spec dosyası plan başlığında bağlanır.
2. **Görevler**: "Planı tahtaya aç" -> issue'lar. `Alan` boşsa kokpit plan görevindeki `Files:` satırlarından önerir.
3. **Al**: kişi tahtadan "Al ve başlat" der ya da biri ona iş isteği gönderir. Kontroller: bağımlılık bitti mi, alan çakışıyor mu, kişinin limiti/bütçesi yeter mi (uyarı, engel değil). Issue atanır, `task/<no>-...` dalı ve worktree açılır, brief yazılır.
4. **Çalıştır**: Ajan Çalıştır sayfası görev metni + brief ile dolar; kişi ajanı seçer (ccr rotası dahil) ve başlatır. Oturumlar dal adıyla göreve bağlanır. Kalp atışı: commit veya canlı oturum.
5. **Raporla**: "PR gönder" push + PR (`Closes #<no>`), PR gövdesine kokpit özeti: ne yapıldı, hangi ajan/model/hesap, maliyet, süre, maskeleme sayısı.
6. **İncele**: gözden geçiren ajan yerelde PR diff'i üzerinde salt okur çalışır (varsayılan: kişinin kendi aboneliğiyle CLI, ör. `claude -p`; limit doluysa yerel Qwen), yorumunu PR'a yazar. Ekip lideri veya görev sahibi dışı bir kişi onaylar.
7. **Birleştir**: insan birleştirir (küçük görevde koşullar sağlanırsa kokpit otomatik birleştirir); issue kapanır; plan dosyasındaki `- [ ]` kokpit tarafından `- [x]` yapılır (ayrı küçük commit) ve SDD defteri varsa `Task N: complete` düşer.
8. **İlerleme**: plan ekranı ve merkez: biten/toplam, görev başına maliyet, kişi/model kırılımı, sahipsiz kalmış görevler.

### İş isteği (dağıtım)

- Kim gönderir: aynı ekibin üyesi veya lideri; yönetici tüm şirkete. Kime: bir kişiye, ya da "ekibin havuz ajanına".
- Yol: merkez -> hedef cihazın canlılık kanalı (önceki spec'teki küçük, hemen giden kanal; cihaz merkeze bağlanır, merkez cihaza port açmaz). Merkez yoksa: aynı GitHub/GitLab issue'ya atama + yorum; alıcının kokpiti issue atamasını görür ve bildirir.
- Onay: ekip liderinden gelen istek, işi alan kişi kendi kokpitinde "liderimin işleri onaysız başlasın" iznini açtıysa onaysız başlar; izin kapalıysa onay kartına düşer (kullanıcının kararı). İzin varsayılan olarak kapalıdır ve kişi istediği an kapatabilir (Claude'un kararı). Onaysız başlama için ek koşullar (Claude'un kararı): gönderen hedef kişinin kendi ekibinin lideridir, repo o ekibe bağlıdır, istekte bütçe ve süre tavanı zorunludur. Sahibine "başladı" bildirimi gider, istediği an durdurabilir. Sahibi "rahatsız etme" açtıysa lider isteği kuyrukta bekler, kapatınca başlar. Diğer herkesten gelen istek için sahibi yerel kokpitte onaylar (istek kartı: kim, hangi görev, alan, bütçe tavanı, tahmini süre). Sahibi "şu repoda, şu kişiden, şu bütçeye kadar otomatik kabul" kuralı açabilir; kural yalnız sahibin makinesinde durur.
- Sandbox: ayrı worktree, çalışma klasörü worktree ile sınırlı (mevcut Cursor `--trust` mantığı gibi açıkça işaretlenmeden güvenilmeyen klasör yok), ana dala push yok, bütçe tavanı aşılırsa durdur, süre tavanı. Onaysız başlayan iş ek olarak kişisel anahtarsız konteynerde ve izinli sunucu listesiyle çalışır (Fable'ın kararı 13). İstek metni, issue gövdesi ve brief ajan için veridir; sistem istemi bunu yazar.
- Kill switch: sahibi yerelden, gönderen ve ekip lideri merkezden durdurur; durdurma komutu aynı kanaldan iner, yerel spawner'ın mevcut durdurma yoluna bağlanır.
- Denetim: istek, onay/ret, başlama, durdurma, PR, birleştirme merkezde `audit_log`'a; yerelde `~/.ai-cockpit/requests.json`.
- Durumlar: submitted, accepted, working, input-required (ajan onay bekliyor), completed (PR açık), merged, failed, canceled, released.

### Model, hesap ve yönlendirme

- Kokpitte "Modeller ve hesaplar" kaydı: sağlayıcı, hesap (e-posta/anahtar adı), tür (abonelik | API anahtarı | yerel), limit kaynağı. Abonelik hesapları "yalnız bu makinede, yalnız kendi aracında" etiketini taşır ve hiçbir havuza eklenemez (arayüz bunu engeller).
- ccr: kokpit kurar (`npm i -g` komutunu önizler, kullanıcı onaylar), `~/.claude-code-router/config.json` üretir (yerel Ollama/LM Studio rotaları, API anahtarlı sağlayıcılar, havuzlar), 127.0.0.1:3456 dinlediğini izler, istek kayıtlarını okur (sağlayıcı/model/kimlik/token/maliyet). Claude Code'un ccr'den geçip geçmeyeceği oturum başına seçimdir: abonelikle çalışırken ccr devre dışı (doğrudan Anthropic); API anahtarıyla veya başka sağlayıcıyla çalışırken ccr açık.
- Yerel modeller: Ollama ve LM Studio keşfi, yüklü modeller, bellek kullanımı, ccr'de "yerel" rotası. Qwen 3.6 (Ollama etiketi `qwen3.6:latest`, mimari qwen35moe, 35.5B, Q4_K_M; 4 Kasım 2026'da `ollama show` ile doğrulandı) abonelik limiti dolarken kullanılan yedek rotadır.
- Sunucu yerel modeli (Fable'ın kararı, inceleme notu sonrası): iki Mac Studio'da vLLM kullanılmaz. vLLM'in macOS desteği resmi belgede "deneysel, kaynaktan derlenir, yalnız CPU" diye geçer; Metal hızlandırması ancak topluluk eklentisi vllm-metal (MLX tabanlı) ile var. Bunun yerine her Mac Studio'da Ollama veya LM Studio sunucusu (OpenAI uyumlu, `localhost:1234/v1`) ya da `mlx_lm.server` (OpenAI benzeri, `localhost:8080`) çalışır. İki makine tek sisteme bağlanmaz; her birinde ayrı model durur (biri kod modeli, biri genel), LiteLLM ikisini ayrı rota olarak sunar.
- Merkezi geçit (M2 sonrası, ilk sürümde): LiteLLM Proxy, şirket API anahtarlarını kişi başı sanal anahtar ve bütçeyle dağıtır; sunucudaki yerel Qwen'i de aynı uç noktadan sunar; ccr sağlayıcı olarak ona bağlanır. Repo veri etiketi (karar 14) burada da uygulanır: "yalnız yerel model" repodan gelen istek bulut sağlayıcıya yönlendirilmez. Sıra: 1) kişinin kendi aboneliğiyle resmi CLI (kullanıcının kararı; ccr devre dışı, doğrudan sağlayıcı); 2) aboneliğin limiti dolmak üzereyse ya da kişinin o sağlayıcıda aboneliği yoksa yerel model (küçük görev) veya şirket API anahtarı (zor görev) (Claude'un kararı). Limit verisi kokpitin bugün okuduğu 5 saatlik ve haftalık pencerelerden gelir. Havuz ajanı kişisel abonelik kullanamaz; yerel model ve şirket anahtarıyla çalışır. Havuz makinesine şirket adına ayrı bir CLI koltuğu (Team/Enterprise) atanıp atanamayacağını builder sağlayıcı koşullarından doğrular; doğrulanana kadar koltuk yok.

### Bağlam

- Yerel: claude-mem gözlemleri (SQLite + yerel HTTP API) kokpitte görünür; brief üretici aynı repo/alan için son gözlemleri çeker.
- Ekip: TeamBrain kullanılmaz (cmem.ai bulutu). Ekip hafızası = merkezde çalışan mcp-memory-service (kullanıcının kararı). Depolama yalnız yerel SQLite (sqlite-vec) ya da şirket içi Milvus; Cloudflare ve Hybrid'in bulut eşitlemesi kapalı. Embedding yerel ONNX; özet ve kalite puanlama gibi LLM isteyen özellikler kapalı ya da yalnız merkezin LiteLLM/yerel Qwen uç noktasına bağlı. Yalnız HTTPS ve OAuth; 0.0.0.0'a açılmaz, merkez ters vekil arkasında durur.
- İçerik: görev başına maskelenmiş brief, kapanış özeti ve kişinin "ekiple paylaş" dediği claude-mem gözlemleri. Her kayıt `repo:<ad>`, `task:<n>`, `area:<kök>` etiketleri ve `X-Agent-ID` (kişi/cihaz) ile yazılır. Her okuma `repo:` etiketiyle süzülür; servisin bootstrap profilleri projeye göre ayrılmadığı için kullanılmaz. Kim neyi okudu M5 okuma kaydına merkezden düşer. M5 maskeleme kuralları aynen uygulanır: maskeleme çalışmazsa gönderilmez. "Yalnız yerel model" etiketli repo (karar 14) da ekip hafızasına yazar, çünkü sunucu şirket içinde; dışarı çıkan tek yol yok.
- Brief üretici (D1 Task 5) M5 sonrası iki kaynaktan okur: kişisel anılar claude-mem'den, ekip anıları mcp-memory-service `POST /api/search` (etiket süzgeçli) üzerinden. Merkez kapalıysa brief yalnız claude-mem ile yazılır, alma işlemi beklemez.
- Merkezdeki PostgreSQL bağlam içeriğini tutmaz; yalnız ekip/kişi yetkisi, okuma kaydı ve denetimi tutar.
- Kişi kendi reposunu "bağlam gönderme" olarak dışlayabilir (önceki spec'in dışlama kuralı).

### Öneri motoru

Girdi: görev türü ve `est`, aynı alandaki geçmiş görevlerin model/başarı/maliyeti, kişinin kalan limitleri, hesap havuzu doluluğu. Çıktı: uygulanmayan öneri kartı. İlk kurallar:

1. Aynı görev 2+ düzeltme turuna girdi -> daha güçlü model öner.
2. Kişinin aboneliğinin haftalık limiti >= %70 ve görev küçük (`est` <= 30 dk, tek dosya) -> aboneliği korumak için yerel model öner. Limit rahatsa CLI'da kal; öneri çıkmaz.
3. Kişinin aktif hesabının 5 saatlik limiti >= %85 -> aynı sağlayıcıda kendi diğer hesabına (abonelik ise yalnız kendi hesabı) ya da API anahtarına geçmeyi öner.
4. Gözden geçiren ajan 3 kez aynı tür hatayı yakaladı -> görev sahibine model/istem değişikliği öner.
5. Görev 4 saat kalp atışı almadı -> sahibine "bırak veya devam" sor, lidere bildir.

## Ekranlar

- **İş tahtası** (yerel ve merkez): sütunlar Hazır / Alındı / Çalışıyor / İnceleme / Birleşti; kartta görev, alan, bağlı, kim, ajan+model, maliyet, kalp atışı. "Planı tahtaya aç", "Al ve başlat", "İş gönder", "Bırak".
- **İş isteği kartı** (yerel): gelen istek, onay/ret, bütçe tavanı, otomatik kabul kuralı.
- **Görev detayı**: brief, oturumlar, maliyet kırılımı, PR ve gözden geçiren ajan yorumu, denetim satırları.
- **Modeller ve hesaplar**: sağlayıcı/hesap/tür/limit, ccr durumu ve rotaları, yerel modeller.
- **Öneriler**: kartlar, kabul/yoksay, geçmiş.
- Merkez ekranları (önceki spec) aynen; şirket özetine "sahipsiz kalmış görevler" ve "bekleyen iş istekleri" eklenir.

Görsel dil bugünkü kokpitle aynı; ekran taslakları kodlamadan önce onaya sunulur.

## Aşamalar (tek sıralı yol haritası)

Merkez gerektirmeyenler bugünkü kokpitte hemen başlar.

| Sıra | Aşama | Merkez | İçerik |
|---|---|---|---|
| D1 | İş tahtası v1 | Gerekmez | community.js genişler: Alan/Bağlı/est/Kabul alanları, "Planı tahtaya aç", alan çakışma kontrolü, worktree, brief.md, bırak/sahipsiz işareti, yalnız yerel repo için `.ai-cockpit/board/` |
| D2 | Modeller, hesaplar, ccr, yerel model | Gerekmez | hesap kaydı ve abonelik kilidi, ccr kur/yapılandır/kayıt oku, Ollama ve LM Studio keşfi |
| D3 | Görev maliyeti ve rapor | Gerekmez | dal adıyla oturum-görev bağlama, PR gövdesine özet, plan dosyası `- [x]` ve SDD defteri yazımı |
| D4 | Gözden geçiren ajan | Gerekmez | salt okur inceleme çalıştırması (varsayılan abonelikli CLI, yedek yerel Qwen), PR yorumu, insan onayı |
| D5 | Öneri motoru v1 | Gerekmez | beş kural, kart arayüzü |
| M1 | Merkez çekirdeği | Merkez | önceki plan aynen (kullanıcı, ekip, giriş, cihaz) |
| M2 | Gönderim | Merkez | önceki plan + görev/istek olayları kuyruğa eklenir; Mattermost bildirim bağlayıcısı (iş isteği, onay kartı, sahipsiz görev, otomatik birleştirme, bütçe uyarısı) |
| M3 | Ekip ekranları | Merkez | önceki plan + tahta aynası, sahipsiz görevler |
| M4 | İş paketleri ve dağıtım | Merkez | tahta aynası, iş isteği kuyruğu, onay/kill switch kanalı, havuz ajanı kaydı (ilk makine: Nevo'nun Hermes pilotu), denetim kaydı, görev maliyeti toplamı |
| M5 | İçerik ve bağlam | Merkez | önceki plan (maskeleme, arama, okuma kaydı) + ekip hafızası (mcp-memory-service kurulumu, etiket şeması, maskelenmiş yazma, ekip arası brief) |
| Y6 | Merkezi geçit | Merkez | LiteLLM, şirket API anahtarları, kişi başı sanal anahtar ve bütçe |
| M6 | Kurulum paketi | Merkez | Docker, yedekleme, pilot ekip |

Önceki Y1-Y8 bu tabloya eridi: Y1-Y3 -> D2, Y4 -> D1 (brief) + M5, Y5 -> D5, Y6 -> Y6, Y7 -> M5, Y8 -> M4 (artık eklenti değil, çekirdek).

## Açık kaynak seçimleri (GitHub API ile 4 Kasım 2026'da doğrulandı)

| Proje | Lisans | Durum | Karar |
|---|---|---|---|
| claude-code-router (musistudio) | MIT | aktif, son push Ekim 2026 | Kullan: kişi başı yerel yönlendirici, 127.0.0.1:3456, kimlik havuzu yalnız API anahtarı ve yerel modeller için |
| LiteLLM (BerriAI) | MIT (enterprise/ klasörü ayrı lisans) | aktif | Kullan (Y6): şirket API anahtarlarını kişi başı sanal anahtar ve bütçeyle dağıtan merkezi geçit |
| Ollama / LM Studio / mlx-lm | MIT / kapalı istemci, açık SDK / MIT | aktif | Kullan: yerel model (Ollama kurulu, `qwen3.6:latest` hazır); Mac Studio sunucularda Ollama veya LM Studio ya da `mlx_lm.server`. vLLM Mac'te yalnız CPU, kullanılmaz (inceleme notu sonrası) |
| claude-mem (thedotmack) | Apache-2.0 | aktif, kurulu | Kullan yerelde (SQLite + yerel HTTP API); TeamBrain kullanılmaz (cmem.ai bulutu) |
| mcp-memory-service (doobidoo) | Apache-2.0 | aktif, ~2.1k yıldız, tek bakımcı | Kullan (M5): ekip hafızası; REST + MCP + OAuth + panel, yerel ONNX embedding, SQLite. Bulut backend'leri kapalı |
| Hermes Agent (NousResearch) | MIT | aktif | Kullan: havuz makinesinde yürütücü ajan, CLI üzerinden (Codex gibi); A2A sunucusu yok, kendi mesaj geçidi var |
| A2A (a2aproject) | Apache-2.0 | aktif | İlk sürümde değil; iş isteği durum adları A2A ile uyumlu tutulur, köprü sonra |
| RouteLLM (lm-sys) | Apache-2.0 | son push Ağustos 2024, durağan | Bağımlılık değil; eşik fikirleri için kaynak |
| Langfuse | MIT çekirdek, ee/ ayrı lisans | aktif | Gerekmez: ccr kayıtları + kokpit hook verisi istek izini zaten verir |
| mem0 | Apache-2.0 | aktif | Gerekmez: kişisel hafıza claude-mem, ekip hafızası mcp-memory-service |
| Vibe Kanban (BloopAI) | Apache-2.0 | aktif | Kullanılmaz: tek makine odaklı orkestratör, kokpitin Ajan Çalıştır'ı ile çakışır; "görev başına worktree" deseni alınır |
| Beads (gastownhall) | MIT | aktif | Kullanılmaz (v1): Dolt tabanlı dağıtık issue grafı, `bd ready`/`--claim` modeli iyi ama GitHub Issues kaynağıyla çakışır ve Dolt bağımlılığı getirir; yalnız yerel repolar için ileride seçenek |
| Backlog.md (MrLesk) | MIT | aktif | Kullanılmaz: repo içi Markdown görevler; plan.js aynı işi görüyor, biçimi ileride uyumlu hale getirilebilir |
| Claude Task Master | GitHub "Other" (MIT metinli özel başlık), son push Nisan 2026 | yavaşlamış | Kullanılmaz: PRD'den görev üretimi hedef değil, lisans metni belirsiz |
| OpenHands | MIT | aktif | Kullanılmaz: merkezde konteyner ajan çalıştırma hedef dışı |
| Claude Squad | AGPL-3.0 | son push Ağustos 2026 | Kullanılmaz: tmux tabanlı tek makine aracı, AGPL ile GPL-3.0 uyumu ayrı inceleme ister |

## Riskler

- Sağlayıcı koşulları değişir; abonelik kilidi arayüzde sert kuraldır, metin yönetici tarafından güncellenir.
- Issue API hız sınırları (çok görevli planlar); toplu açma kuyruklanır, önbellek kullanılır.
- Alan çakışma kontrolü desen tabanlıdır, kesin değildir; birleştirme çakışmaları yine PR'da çıkar.
- Uzaktan başlatılan ajanın yerel makinede kaynak tüketmesi; süre ve bütçe tavanı zorunlu, varsayılanlar builder kararı.
- Gözden geçiren ajanın yerel modelle zayıf kalması; insan kapısı bu yüzden zorunlu.
- Merkez kapalıyken iş isteği yalnız issue ataması yoluyla gider; bildirim gecikir ama kaybolmaz.
- mcp-memory-service tek bakımcılı ve Python bağımlılığı getirir; merkez ona yalnız REST ile konuşur (tek modül), Docker imajı sürüm sabitlenir. Proje durursa içerik dışa aktarılıp PostgreSQL tablosuna (pgvector) taşınabilir; brief biçimi değişmez.
- Ekip hafızasında repo sızıntısı: süzgeç etiketle yapılır, etiketsiz okuma merkez kodunda reddedilir.
- claude-mem iç API'sinin sürümle değişmesi; okuma tek modülde toplanır, kırılırsa brief claude-mem'siz üretilir.
- İstem enjeksiyonu: issue yazabilen herkes görev metnine gizli talimat koyabilir; brief ve PR açıklaması da öyle. Karşılık: metin veridir kuralı sistem isteminde, onaysız iş konteynerde, gözden geçiren ajan "ajana talimat" bulgusu çıkarır. Sıfır risk değildir; insan kapısı bu yüzden kalır.
- Lisans: GPL-3.0 şirket içi kullanım için uygundur. Kokpit ileride ürün veya servis olarak satılırsa lisans seçimi yeniden gözden geçirilir (inceleme notu). LiteLLM `enterprise/` ve AGPL projeler dışarıda kalır.
- Konteyner zorunluluğu onaysız işi yavaşlatır (imaj indirme, bağımlılık kurulumu); reponun devcontainer'ı yoksa ilk çalıştırma uzun sürer. Kabul edilen bedel.

## Builder'a bırakılanlar

- Issue gövdesi alan sözdiziminin tam biçimi ve geriye uyumlu ayrıştırma.
- Yalnız yerel repo tahta dosya biçimi (`.ai-cockpit/board/*.md`).
- ccr config üretim şablonu ve kayıt dosyası ayrıştırıcısı.
- claude-mem yerel HTTP API uç noktaları ve brief boyut sınırı.
- mcp-memory-service sürümü, kullanıcılar arası yetki ayrımının ayrıntısı (OAuth kapsamları yetmezse yetki merkezde, servis yalnız merkezin servis hesabıyla çağrılır), MCP araç listesi ve konsolidasyon/unutma ayarları; kurulmadan önce dokümandan doğrulanır.
- Worktree konumu, temizleme süresi, kalp atışı eşiği varsayılanı (4 saat önerilir).
- İş isteği kanalının mesaj şeması (A2A durum adlarıyla), bütçe/süre tavanı varsayılanları.
- Gözden geçiren ajan istemi ve hangi CLI ile çalışacağı (claude -p, codex exec, ollama).
- Öneri kurallarının eşik sayıları.
- Onaysız iş konteynerinin varsayılan imajı, izinli sunucu listesinin biçimi, worktree'nin konteynere bağlanma yolu, abonelikli CLI'ların konteyner içinde kimlik doğrulama durumu.
- Repo veri etiketinin saklandığı yer (`.ai-cockpit/repo.json` önerilir) ve ccr/LiteLLM'de reddetme kuralının yazımı.
- İş isteği imzası (M1): anahtar üretimi, saklama, doğrulama.

## İnceleme notu kararları (4 Kasım 2026)

Nevo'nun notundaki maddeler ve verilen karar:

1. İş isteği = başkasının bilgisayarında komut: kabul, değişiklikle. Liderin onaysız başlatması sürer (kullanıcının kararı); konteyner, izinli sunucu listesi, "metin veridir" kuralı ve imzalı istek eklendi (karar 13). Kullanıcı kararı: onaysız başlama izni işi alan kişidedir.
2. Repo başına veri etiketi: kabul (karar 14). Abonelikli CLI ccr'den geçmediği için uygulama yalnız yönlendiricide değil, kokpitin ajan seçiminde de yapılır.
3. Otomatik birleştirme ilk aylarda kapalı: kabul, değişiklikle. Not, gözden geçiren ajanın yerel Qwen olduğu eski sayfaya yazılmıştı; varsayılan artık abonelikli CLI. Yine de "yalnız yerel model" repolarda kapalı, yerel Qwen incelemesiyle kapalı, "diff'te talimat" bulgusu keser (karar 6). Kullanıcı kararı: otomatik birleştirmeye görev başına lider karar verir.
4. Mac'te vLLM yerine Ollama/LM Studio/MLX, her makinede ayrı model: kabul, doğrulandı.
5. Lisans notu: kabul, risklere yazıldı.
6. Doğrulama: Qwen 3.6 adı Ollama etiketi olarak doğrulandı; Anthropic kaynağı resmi uyum sayfasıyla değiştirildi (karar 4).
7. Havuz ajanı = Hermes pilotu: kabul, değişiklikle (karar 10). Kullanıcı kararı: Nevo'nun Hermes pilot makinesi ilk havuz ajanı, Mattermost bildirim kanalı.

## Açık sorular (yalnız kullanıcının cevaplayabileceği, önem sırasıyla)

Yok. Kullanıcı 4 Kasım 2026'da inceleme notundan çıkan üç soruyu da cevapladı.
