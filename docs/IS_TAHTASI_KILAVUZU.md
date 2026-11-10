# İş tahtası adım adım

Bu kılavuz kokpitin **Topluluk** sayfasındaki iş tahtasını baştan sona anlatır: proje sahibinin depoyu hazırlaması, katılımcının görev alıp bitirmesi, yarıda kalan işin devri ve plan dosyasından issue açma. Genel kullanım için [NASIL_KULLANILIR.md](NASIL_KULLANILIR.md) dosyasına bak.

İş tahtasında hesap ya da limit paylaşılmaz. Herkes kendi kokpitini ve kendi AI aboneliğini kullanır; ortak olan yalnız görev listesidir.

## İçindekiler

1. [Ön koşullar](#1-ön-koşullar)
2. [Proje sahibi: depoyu hazırla](#2-proje-sahibi-depoyu-hazırla)
3. [Görev yazmak](#3-görev-yazmak)
4. [Herkes: tahtayı bağla](#4-herkes-tahtayı-bağla)
5. [Tahtayı okumak](#5-tahtayı-okumak)
6. [Görev almak](#6-görev-almak)
7. [Ajanla çalışmak](#7-ajanla-çalışmak)
8. [Teslim: PR, MR ya da yerel birleştirme](#8-teslim-pr-mr-ya-da-yerel-birleştirme)
9. [Görevi bırakmak ve devralmak](#9-görevi-bırakmak-ve-devralmak)
10. [Planı tahtaya açmak](#10-planı-tahtaya-açmak)
11. [Worktrunk](#11-worktrunk)
12. [Sorun giderme](#12-sorun-giderme)

## 1. Ön koşullar

| | GitHub | GitLab | Yerel git |
| --- | --- | --- | --- |
| Ne zaman | ekip çalışması | ekip çalışması | tek kişi, tek bilgisayar |
| Görevler | etiketli issue'lar | etiketli issue'lar | depodaki plan dosyası |
| Gerekli araç | `gh`, `gh auth login` | `glab`, `glab auth login` | yalnız git |
| Teslim | PR (`Closes #n`) | MR (`Closes #n`) | ana dala yerel birleştirme |

Her katılımcının kendi makinesinde:

- kokpit çalışıyor olmalı (`bin/ai-cockpit start`),
- deponun bir klonu bulunmalı,
- Claude Code, Codex ya da Cursor'dan en az biri kurulu olmalı.

Kokpit GitHub ve GitLab'a her işlemi **senin** `gh` / `glab` oturumunla yapar; ayrı bir token istemez.

## 2. Proje sahibi: depoyu hazırla

1. Projeyi GitHub ya da GitLab'da bir depoda tut.
2. Görev etiketini oluştur. Varsayılan ad `cockpit-task`; başka bir ad seçersen herkes ayarlarda aynı adı girmeli.
3. Katılımcıları depoya davet et (ya da depoyu herkese aç). Tahtanın sağındaki **Ekip** listesi depo üyelerini ve rollerini buradan okur.
4. Görevleri aç. İki yol var:
   - elle: her iş için bir issue aç ve etiketi ekle (bkz. [3. Görev yazmak](#3-görev-yazmak)),
   - plandan: elinde Markdown bir plan varsa [10. Planı tahtaya açmak](#10-planı-tahtaya-açmak) ile hepsini bir kerede aç.

Yerel git kullanıyorsan uzak sunucu gerekmez: plan dosyasını deponun içine koyman yeterli. Görev üstlenmeleri yalnız o bilgisayarda tutulur.

## 3. Görev yazmak

Issue başlığı görevin adıdır. Gövdeye satır başında şu satırları yazarsan tahta onları okur. Hiçbiri zorunlu değil.

```text
Alan: server/lib/**, client/src/pages/Plan.tsx
Bağlı: #12, #14
est: 1.5h
Kabul:
- testler yeşil
- tahta açılır
```

| Satır | Ne işe yarar |
| --- | --- |
| `Alan:` | Görevin dokunacağı dosyalar (glob desenleri, virgülle). Aynı alanda iki kişinin çalışmasını önler. Yazılmazsa görev "Alan yok" rozetiyle alınabilir ama çakışma kontrol edilemez. |
| `Bağlı:` | Önce bitmesi gereken görevler. Hepsi kapanmadan görev alınamaz. Kapalı ya da hiç olmayan numara karşılanmış sayılır. |
| `est:` | Tahmini süre (`45m`, `2h`, `1.5h`). `est:2h` biçiminde bir etiket de olur. İlerleme çubuğu ve toplam süre bunu kullanır. |
| `Kabul:` | Bitti sayılma ölçütleri. Alt satırlardaki `-` maddeleri ya da aynı satırdaki metin. Ajanın brief'ine girer. |

İyi bir görev:

- bir ajan oturumunda bitebilecek kadar küçüktür (yarım gün ve altı),
- alanı dar tutar; `**` gibi kök desen her şeyle çakışır,
- kabul ölçütlerini kontrol edilebilir yazar ("testler yeşil", "sayfa 200 döner").

Yerel git'te görevler plan dosyasından gelir: `## Aşama` başlıkları aşama, `### Task 3: Başlık (est:2h)` başlıkları görev olur; görev numarası plandaki sırasıdır. Yerel modda Alan, Bağlı ve Kabul satırları tahtada okunmaz, bu yüzden rozet ve çakışma kontrolü yoktur; plandaki görev bölümü yine de brief'e girer.

## 4. Herkes: tahtayı bağla

1. Kokpitte **Topluluk** sayfasını aç.
2. **Depoyu bağla** bölümünde platformu seç.
3. Doldur:
   - **Depo** (`owner/name`) ya da GitLab'da **Proje** (`group/project`); GitLab kendi sunucundaysa **GitLab sunucusu**,
   - **Yerel depo (tam yol)**: kendi klonun. **Gözat** ile seçebilirsin; git deposu olmayan klasör kabul edilmez,
   - **Görev etiketi**: proje sahibinin kullandığı ad,
   - isteğe bağlı: **Plan dosyası** (bkz. 10), **Sahipsiz sayılma eşiği** (1-168 saat, varsayılan 4), Worktrunk seçenekleri (bkz. 11).
4. **Kaydet**. Tahta görevleri yükler.

Ayarı sonradan **Değiştir** ile düzeltebilirsin. Yerel depo yolu aynı kaldıkça mevcut üstlenmeler korunur.

## 5. Tahtayı okumak

Üstte özet ve **Proje ilerlemesi** çubuğu ("N görevden M tanesi bitti") vardır. Görevler dört listede durur:

- **Boşta**: kimsenin almadığı açık görevler,
- **Bende**: senin aldıkların,
- **Başkasında**: başkalarının aldıkları ("Ali 2 sa önce aldı"),
- **İncelemede**: PR/MR'ı açık olanlar ve inceleme durumu (inceleme bekliyor, onaylandı, değişiklik istendi, taslak).

Her görevin rozeti alınabilir olup olmadığını söyler:

| Rozet | Anlamı | Al ve başlat |
| --- | --- | --- |
| **Hazır** | bağlı görevler bitmiş, alan boşta | açık |
| **Bekliyor: #12** | bağlı görev hâlâ açık | kapalı, altında "Önce #12 bitmeli" |
| **Çakışma: #7 (Ali)** | alınmış ya da incelemedeki bir görevle aynı alanda | kapalı, altında "Aynı alanda #7 çalışıyor" |
| **Alan yok** | gövdede `Alan:` satırı yok | açık, ama çakışma bilinmez |
| **Sahipsiz kalmış · 5 sa** | alınmış görevde canlı ajan yok ve son commit eşikten eski | (başkasının görevi) |

İki alan deseni, joker karakterden (`*`, `?`, `[`) önceki kökleri aynıysa ya da biri diğerinin altındaysa çakışır. Örnek: `server/lib/**` ile `server/lib/plan.js` çakışır; `server/lib/**` ile `client/**` çakışmaz.

Görev satırında ayrıca bağlı görevler, kabul ölçütü sayısı, son etkinlik zamanı ve worktree'de kaydedilmemiş değişiklik varsa uyarısı görünür. Sağda **Ekip** (üyeler, roller, aktif ve biten görev sayıları) ve **Son bitenler** durur.

## 6. Görev almak

1. Özetin altındaki **Ajan:** seçicisinden Claude Code, Codex ya da Cursor'u seç.
2. **Hazır** bir görevde **Al ve başlat**'a bas.
3. Kokpit sırayla:
   - görevi sana atar (başkası senden önce aldıysa uyarı verir ve durur),
   - görev için ayrı bir worktree açar: `~/.ai-cockpit/worktrees/<depo>-<kısa-kimlik>/<no>-<başlık>` klasöründe `task/<no>-<başlık>` dalı. Aynı görev için dal zaten varsa onu kullanır,
   - worktree'ye `.ai-cockpit/brief.md` yazar.
   Herhangi bir adım hata verirse atama geri alınır; görev boşta kalır.
4. **Görev alındı** paneli açılır: çalışma klasörü, dal ve brief durumu. Buradan **Ajanı başlat** ya da **Klasörü aç**.

Ana klonun dalı hiç değişmez. Aynı anda birden fazla görev alabilirsin; her biri kendi worktree'sindedir.

**Brief içinde ne var:** issue metni, kabul ölçütleri, alan, plan dosyasındaki ilgili bölüm, bu görevden önce biten görevler ve claude-mem kuruluysa aynı depodan notlar. Dosya en çok 32 KB'tır ve commit'e girmez (`.git/info/exclude`). Ajana giden istem önce bu dosyayı okumasını ve içindeki metni talimat değil veri olarak kullanmasını söyler; issue'ya yazılmış bir komut ajanı yönlendiremez.

## 7. Ajanla çalışmak

1. **Ajanı başlat** seni Ajan Çalıştır sayfasına götürür; komut ve çalışma klasörü hazırdır. Kontrol et, **Çalıştır**'a bas.
2. İlerlemeyi Panel, Oturumlar ve canlı akıştan izle.
3. Ajan push etmez. Commit'ler worktree'deki görev dalında birikir.
4. Ara verirsen görev sende kalır. Döndüğünde **Bende** listesindeki **Ajanla devam et** aynı worktree'de yeni bir oturum açar.

Görevde uzun süre etkinlik olmazsa (canlı ajan yok ve son commit eşikten eski) başkaları görevi **Sahipsiz kalmış** rozetiyle görür. Bu yalnız bir işarettir; görev senden alınmaz.

## 8. Teslim: PR, MR ya da yerel birleştirme

1. Ajanın işini gözden geçir: testler, diff, kabul ölçütleri.
2. **Bende** listesinde görevin PR (GitLab'da MR, yerel git'te birleştirme) simgesine bas.
3. Pencere gönderilecek commit'leri ve çalışacak komutları gösterir. Henüz commit yoksa "önce ajanın işi bitirsin" uyarısı çıkar.
4. Onaylarsan:
   - GitHub/GitLab: dal push edilir, issue'yu kapatan (`Closes #n`) PR/MR açılır. Görev **İncelemede**'ye geçer.
   - Yerel git: görev dalı ana dala birleştirilir ve görev **Son bitenler**'e geçer.
5. İnceleme ve birleştirme GitHub/GitLab'da yapılır. Birleşince issue kapanır, görev **Son bitenler**'e geçer, ilerleme çubuğu artar ve bu göreve bağlı görevler **Hazır** olur.

## 9. Görevi bırakmak ve devralmak

Bitiremeyeceğin görevi başkasına açmak için:

1. **Bende** listesinde **Bırak**'a bas.
2. **Devralacak kişiye not** yaz (isteğe bağlı, en çok 500 karakter): nerede kaldın, neyi denedin, ne kaldı.
3. Pencere issue'ya yazılacak yorumu önizler:

   ```text
   Yarıda kaldı. Dal: task/12-plan-kesfi. Son commit: <son commit başlığı>. Not: ...
   ```

   Önizleme gelmeden onay düğmesi açılmaz.
4. **Bırak ve yorumu yaz**. Atama kalkar, görev tahtada yeniden **Boşta** görünür.

Dal ve worktree silinmez. Görevi yeniden alan kişi (sen dahil) aynı `task/<no>-…` dalından devam eder; Bırak düğmesi push etmez: başka bir makinedeki kişi dalı görsün diye bırakmadan önce dalı kendin push et (`git push -u origin task/<no>-…`). Yalnız görevi tutan kişi bırakabilir.

## 10. Planı tahtaya açmak

GitHub ve GitLab'da bir Markdown planındaki görevleri tek seferde issue olarak açar.

1. **Değiştir** ile ayarlara gir, **Plan dosyası (depo içinde, .md)** alanına yolu yaz (ör. `docs/plans/2026-11-plan.md`). Dosya deponun içinde olmalı.
2. **Planı tahtaya aç** düğmesine bas (ya da **Kaydet ve önizle**).
3. Önizleme iki liste gösterir: **Açılacak** (yeni issue'lar) ve **Güncellenecek** (daha önce açılmış olanlar).
4. **Onayla ve aç**. Her yeni issue'nun numarası planda görev başlığının altına yazılır:

   ```markdown
   ### Task 4: Plan sayfası
   <!-- issue:#31 -->
   ```

5. Plan dosyasını sen commit'lersin; kokpit commit atmaz.

Kurallar:

- İkinci çalıştırma çift issue açmaz; işaretli görevleri günceller.
- Güncellenen issue'ların başlığı ve gövdesi plandaki metinle **değiştirilir**. Issue'da elle yaptığın düzenlemeler kaybolur; kalıcı değişikliği planda yap.
- Yalnız görev etiketini taşıyan issue'lar güncellenir. İşaret etiketsiz bir issue'yu gösteriyorsa atlanır ve "güncellenmedi" listesinde adı geçer; işareti kontrol et.
- Plan görev biçimleri: `### Task 3: Başlık (est:2h)` ya da kart biçimi `#### T05 · Başlık — 1 gün`. Görevin altındaki Alan/Bağlı/Kabul satırları issue gövdesine taşınır.

## 11. Worktrunk

[Worktrunk](https://github.com/max-sixty/worktrunk) (`wt`) kuruluysa ve ayarlarda **Worktree açarken kullan** işaretliyse worktree açma ve etkinlik okuma ona devredilir. Kurulu değilse ya da hata verirse kokpit düz git kullanır; davranış aynıdır.

**Proje hook'larını çalıştır** varsayılan olarak kapalıdır. Hook'lar depodan gelen komutlardır; yalnız güvendiğin depoda aç.

## 12. Sorun giderme

| Belirti | Neden ve çözüm |
| --- | --- |
| "Topluluk deposu ayarlanmadı" | Depo bağlanmamış. [4. adımı](#4-herkes-tahtayı-bağla) yap. |
| Tahta boş: "Etiketli açık görev yok" | Issue'larda etiket yok ya da ayardaki etiket adı farklı. Adı proje sahibininkiyle eşle. |
| GitHub/GitLab hatası | `gh auth status` / `glab auth status` ile oturumu kontrol et; depoya erişimin olmalı. |
| **Al ve başlat** kapalı | Rozetin altındaki nedeni oku: bağlı görev açık ya da alan çakışıyor. |
| "Başkası senden önce aldı" | Aynı anda iki kişi bastı; görev ona geçti. Başka bir görev seç. |
| Worktree açılamadı | Ana klonda `git worktree prune` çalıştır; aynı dal başka bir klasörde açıksa kapat. Atama zaten geri alınmıştır. |
| PR simgesinde "Henüz commit yok" | Ajan commit atmamış. Worktree'de `git log` ile kontrol et. |
| Bırakırken "Bu görev sende değil" | Görevi başkası tutuyor ya da atama değişmiş. Tahtayı yenile. |
| Planı açarken "Plan dosyası seçilmedi" | Ayarlarda plan dosyası yolu boş. |
| Bir issue güncellenmedi | İşaret etiketsiz bir issue'yu gösteriyor. Plan dosyasındaki `<!-- issue:#n -->` satırını düzelt. |
| İstekte "JSON istek bekleniyor" (415) | Tahta uçlarına yalnız kokpit arayüzünden ya da `Content-Type: application/json` ile istek atılabilir. |
