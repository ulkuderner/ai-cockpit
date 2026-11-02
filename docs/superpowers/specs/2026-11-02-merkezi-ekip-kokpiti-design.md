# Merkezi Ekip Kokpiti - Tasarım

Tarih: 2026-11-02. Durum: taslak, onay bekliyor.

## Amaç ve neden

AI Cockpit bugün tek kişilik: her geliştirici kendi bilgisayarında kendi ajanlarını izliyor. Hedef, 50+ kişilik bir şirkette tüm ekiplerin yapay zeka ajanı kullanımını tek bir merkezden izlemek. Yöneticinin ve ekip liderinin sabah açıp şu sorulara cevap alabilmesi gerekiyor:

- Kim hangi ajanlarla (Claude Code, Codex, Cursor, Gemini) çalışıyor, şu an ne yapıyor?
- İş paketleri neler, her birinde ne kadar ilerlendi, planlı işlerden ne kaldı?
- Kim, hangi ekip, hangi proje, hangi iş paketi ne kadar harcadı?
- Kimin hangi abonelikte ne kadar limiti kaldı?

Ek olarak (öneri, kabul edildi):

- Onay bekleyip takılı kalan ajanlar.
- Hata veren oturumlar.
- Kişi bazında önbellek isabeti ve tasarruf.
- Atıl abonelikler (parası ödenip neredeyse kullanılmayanlar).
- İş paketi başına maliyet.

## Kararlar (kullanıcının)

- Ölçek: 50+ kişi, birden çok ekip.
- Görünürlük: herkes kendi ekibini görür, yönetici tüm şirketi görür.
- İçerik: prompt ve konuşma içerikleri tam olarak merkeze gider ve aranabilir olur.
- Barındırma: karar verilmedi. Aynı paket hem şirket içi sunucuda (Docker) hem kullanıcının kendi bulut hesabında çalışabilmeli.
- Giriş: kullanıcı adı + parola, passkey zorunlu olarak desteklenir, Google Workspace ile giriş desteklenir.
- İş paketleri: repodaki plan dosyalarından okunur; repo GitHub, GitLab ya da yalnız yerel olabilir.
- Proje eşleşmesi: aynı repoyu kullanan farklı kişiler merkezde aynı projede buluşmalı.
- İçerik okuma: konuşma içeriğini yalnız ekip lideri ve yönetici açabilir. Üye, ekip arkadaşının özetini (ajan, durum, süre, maliyet, limit) görür, içeriğini göremez. Kişi kendi içeriğini her zaman görür.
- Gönderim kapsamı: makinedeki tüm oturumlar gönderilir; kişi istemediği repoları/klasörleri dışlar.
- Maliyet: ikisi birden. Gerçek koltuk ücreti (yönetici girer, kişiye atar) ve bugünkü API eşdeğeri tahmini yan yana gösterilir.
- Maskeleme düzeyi: bilinen kalıplar + dışlama listesi kabul edilen çıtadır. Maskeleme çalışamazsa içerik gönderilmez, bekletilir. Kalıba uymayan müşteri verisinin kaçabileceği bilinen ve kabul edilen risktir.
- Lisans ve isim kuralları sürer: GPL-3.0, "Developed by Caglar Ulkuderner", HugVet adı geçmez, iletişim yalnız HTTPS.

## Hedef olmayanlar (ilk sürüm)

- GitHub/GitLab issue ve milestone entegrasyonu (sonradan eklenebilir bağlayıcı).
- Ajanları merkezden çalıştırma veya durdurma; merkez yalnız izler.
- Faturalandırma, çok şirketli (multi-tenant SaaS) yapı. Bir kurulum = bir şirket.
- Mobil uygulama.

## Kaçınılacaklar (çalışsa bile başarısızlık sayılır)

- Bir geliştiricinin gizli anahtarının, parolasının veya müşteri verisinin maskelenmeden merkeze ulaşması.
- Bir ekip üyesinin başka ekibin konuşma içeriğini görebilmesi.
- Merkez erişilemezken geliştiricinin bilgisayarında ajanların yavaşlaması veya veri kaybı.
- Kişinin kendi kokpitinin bugünkü tek kişilik kullanımının bozulması.
- Kimin hangi konuşmayı okuduğunun izlenememesi.

## Mimari

### Genel yapı (benim kararım)

İki rol, tek kod tabanı:

1. **Yerel toplayıcı**: her geliştiricinin bilgisayarında çalışan bugünkü kokpit. Claude Code hook'ları, Codex rollout'ları, Cursor ve Gemini oturumları, limitler, plan dosyaları zaten burada okunuyor ve normalize ediliyor. Yeni bir "merkeze gönder" katmanı eklenir. Kişi kendi yerel panelini istediği gibi kullanmaya devam eder.
2. **Merkez sunucu**: aynı uygulamanın "merkez modu". Toplayıcılardan gelen normalize veriyi kabul eder, kullanıcı/ekip/rol yönetir, ekip görünümlerini sunar.

Neden: Toplama mantığı (Codex segment dosyaları, Cursor/Gemini okuyucuları, limit kaynakları, maliyet hesabı) büyük ve olgun; Go ajanında yeniden yazmak yıllarca sürecek bir çift bakım yükü getirir. Bedeli: geliştirici bilgisayarında Node gerekir.

Go ajanı (benim kararım): Node kurulamayan makineler için kalır, cihaz eşleştirmesiyle doğrudan merkeze bağlanır ve yalnız özet gönderir (oturum, ajan, durum, süre, token). Hook içindeki prompt ve araç içeriğini göndermez; böylece maskeleme ikinci kez Go'da yazılmaz ve maskelenmemiş içerik yolu oluşmaz.

### Toplayıcı -> merkez akışı

- Toplayıcı, kendi veritabanına yazdığı her oturum, olay, token/maliyet satırı, limit anlık görüntüsü ve plan ilerlemesini bir giden kuyruğa da koyar.
- Kuyruk diskte durur. Merkez erişilemezken veri birikir ve bağlantı gelince sırayla gönderilir. Hiçbir ajan işlemi merkezi beklemez.
- Gönderim toplu (batch), sıkıştırılmış ve HTTPS üzerinden yapılır. Her kayıt toplayıcıda üretilen sabit kimlik taşır, merkez tekrarları yok sayar (idempotent).
- İçerik gönderilmeden önce toplayıcıda maskeleme filtresinden geçer (aşağıda).
- Geçmiş (benim kararım): cihaz bağlandığında yalnız bağlantı anından sonraki veri gönderilir. Yönetici geçmiş aktarımını açarsa, kişi KVKK metnini onayladıktan sonra son N günün geçmişi (varsayılan 30) düşük hızda gönderilir. 840 MB'lık tek kişilik veritabanlarının merkezi ilk gün boğmaması için.
- Canlılık (benim kararım): "şu an ne yapıyor" ve "onay bekliyor" bilgisi saniyeler içinde görünmeli. Toplayıcı durum değişikliklerini ayrı, küçük ve hemen gönderilen bir kanaldan iletir; geri kalan veri toplu kuyruktan dakikalar içinde gelir.

### Cihaz kimliği

- Ajan bağlantısı kişi parolasıyla yapılmaz. Kullanıcı panele girip "Cihaz ekle" der, tek kullanımlık eşleştirme kodu alır, toplayıcıda `ai-cockpit connect` ile girer.
- Her cihazın ayrı, iptal edilebilir anahtarı olur. Bilgisayar kaybolursa yalnız o cihaz kapatılır.
- Bir cihaz tek bir kullanıcıya bağlıdır; gelen her kayıt o kullanıcıya yazılır.

### Proje kimliği

- Projeler repo kimliğiyle eşleşir, klasör adıyla değil.
- Uzak adres varsa sadeleştirilir: `git@github.com:org/repo.git`, `https://github.com/org/repo`, `ssh://...` hepsi `github.com/org/repo` olur. GitLab ve kendi sunucusundaki GitLab için aynı kural.
- Uzak adres yoksa reponun ilk commit SHA'sı kimlik olur; repoyu kopyalayan herkes aynı projede buluşur.
- Repo dışında açılan oturumlar "projesiz" olarak kişiye yazılır.
- Yönetici, bir projeyi ekibe atar. Atanmamış yeni projeler, ilk kullanan kişinin ekibine geçici atanır.

### İş paketleri

- Kaynak: repodaki plan dosyaları (`docs/superpowers/plans/*.md` ve kurulumda ayarlanabilir başka desenler). Toplayıcı bugünkü plan okuyucusunu (`server/lib/plan.js`) kullanır.
- Her plan dosyası bir iş paketi. Adımlar `- [ ]` / `- [x]` satırları. İlerleme = biten / toplam.
- Doğruluk kaynağı (benim kararım): dosyadaki onay kutuları. Bugünkü makineye özel elle durum (`~/.ai-cockpit/plans.json` içindeki todo/done/blocked) merkeze gönderilmez, yalnız yerel panelde kalır. "Blocked" bilgisi merkezde gerekirse plan dosyasına yazılması önerilir.
- Kimlik (benim kararım): proje + dosya yolu + dal. Ana ekranda varsayılan dalın durumu gösterilir; diğer dallar paketin altında ayrı satır olarak görünür. Böylece dallar arası "son yazan kazanır" ilerlemeyi zıplatmaz.
- Aynı dalda aynı plan dosyası için farklı kişilerden farklı durum gelirse en son gelen geçerlidir, kimin işaretlediği ve ne zaman görünür.
- Oturumlar iş paketine şu sırayla bağlanır: oturum sırasında düzenlenen plan dosyası, dal adı, son çare olarak aynı projede o saatte aktif plan. Bağlanamayan oturum projeye yazılır.
- İş paketi maliyeti = bağlı oturumların toplamı.

### Kullanıcı, ekip, rol

- Roller: **üye** (kendi içeriği + ekibinin özeti), **ekip lideri** (üye + ekibine ait projelerin içeriğini okuma, projeyi kendi ekibine alma/bırakma), **yönetici** (tüm şirket, kullanıcı/ekip/proje yönetimi, saklama ayarları, koltuk ücretleri).
- Bir kişi birden çok ekipte olabilir.
- İçerik sahipliği (benim kararım): bir oturumun içeriği, projesinin atandığı ekibe aittir; o ekibin lideri okur. Projesiz oturumlar kişinin birincil ekibine aittir. Örnek: A ve B ekiplerinde olan kişi A'ya atanmış projede çalışırsa içeriği A'nın lideri okur, B'nin lideri yalnız özeti görür.
- "Ekip kendi ekibini görür" kuralı içerik dahil her sorguda sunucu tarafında uygulanır; istemci filtresine güvenilmez.

### Giriş

- Kullanıcı adı + parola (güçlü hash, hız sınırı, kilitleme).
- Passkey (WebAuthn) kayıt ve giriş; kullanıcı birden çok passkey ekleyebilir. Yönetici passkey'i zorunlu kılabilir.
- Google Workspace (OpenID Connect), izin verilen alan adı kısıtıyla. İlk girişte kullanıcı otomatik oluşturulur ya da yönetici onayına düşer (kurulum ayarı).
- Oturumlar sunucu tarafında, iptal edilebilir.

### İçerik güvenliği

- **Maskeleme**: içerik toplayıcıdan çıkmadan önce bilinen gizli bilgi kalıpları (API anahtarları, tokenlar, özel anahtarlar, parola atamaları, bağlantı dizgeleri, TC kimlik ve kart numarası) maskelenir. Kalıp listesi merkezden güncellenebilir. Maskeleme sayısı raporlanır.
- **Kişi bazında dışlama**: varsayılan olarak her şey gönderilir. Geliştirici belirli bir repoyu veya klasörü "hiç gönderme" ya da "içerik gönderme, yalnız özet gönder" olarak işaretleyebilir. Yönetici bunu proje bazında da zorunlu kılabilir.
- **Maskeleme zamanı (benim kararım)**: içerik kuyruğa girerken maskelenir, kuyrukta maskelenmemiş içerik durmaz. Kalıp listesi güncellenince kuyrukta bekleyen içerik yeni listeyle yeniden taranır. Maskeleme hata verirse ya da kalıp listesi yüklenemezse içerik kuyruğa alınmaz, yerelde bekletilir; özet gönderimi sürer.
- **Okuma kaydı**: bir konuşmanın içeriği her açıldığında kim, ne zaman, hangi oturum kaydedilir; yönetici görür, uygulama içinden silinemez.
- **Saklama süresi**: içerik ve özet için ayrı süreler; süre dolunca içerik silinir, özet (token, maliyet, süre) kalır. Varsayılan değerler builder kararı, yönetici değiştirir.
- **Silme (benim kararım)**: kullanıcı silinince veya KVKK silme talebinde içeriği silinir, özeti anonimleştirilir (maliyet toplamları bozulmasın). Okuma kayıtları kendi saklama süresince tutulur; silinen kişinin adı kayıtta anonimleştirilir.
- **KVKK**: çalışanlara aydınlatma metni gösterilir ve ilk girişte onaylatılır; metin kurulumda düzenlenebilir.
- Şifreleme: aktarım HTTPS, depoda veritabanı/disk şifrelemesi kurulum belgesinde zorunlu adım olarak yer alır.

### Abonelikler ve maliyet

- Yönetici abonelik koltuklarını girer: araç, plan, aylık ücret, atanan kişi. Paylaşılan şirket hesabı birden çok kişiye atanabilir; ücret eşit bölünür (benim kararım).
- Toplayıcının yerelde algıladığı abonelikler (bugünkü `subscriptions.js`) koltuklarla hesap e-postası üzerinden eşleşir; eşleşmeyen algılamalar yöneticiye "tanımsız abonelik" olarak gösterilir. Aynı hesabın birden çok cihazı tek koltuk sayılır.
- Her ekranda iki rakam: gerçek koltuk ücreti ve API eşdeğeri tahmin.
- Atıl abonelik (benim kararım): son 30 günün API eşdeğeri kullanımı koltuk ücretinin %20'sinin altında kalan koltuk. Eşik yönetici ayarıdır.

### Veritabanı

- Merkez PostgreSQL kullanır. Gerekçe: tek kişinin yerel veritabanı bugün 840 MB; 50+ kişi tam içerikle onlarca GB eder, eşzamanlı yazım ve tam metin arama gerekir.
- İçerik araması PostgreSQL tam metin aramasıyla (Türkçe dahil) yapılır; ayrı arama motoru ilk sürümde yok.
- Yerel toplayıcı SQLite'ta kalır.

### Barındırma

- Tek Docker imajı + docker-compose (uygulama, PostgreSQL, ters vekil). Şirket içi sunucuda ve bulut sanal makinesinde aynı şekilde çalışır.
- TLS: kurumun kendi sertifikası ya da otomatik sertifika; kendinden imzalı sertifika yalnız deneme için.
- Yedekleme ve geri yükleme betiği pakete dahil.

## Ekranlar

- **Şirket özeti** (yönetici): bugünkü harcama, aktif kişi/ajan sayısı, limiti azalanlar, bekleyen onaylar, hatalar, atıl abonelikler.
- **Ekip görünümü**: kişi kartları (şu an hangi ajanla neyi yapıyor, bugünkü maliyet, kalan limitler), ekibin iş paketleri.
- **Kişi görünümü**: oturumlar, maliyet ve önbellek tasarrufu, abonelikler ve limitler.
- **Proje / iş paketi görünümü**: plan adımları, kalanlar, katkı verenler, maliyet.
- **Arama**: yetkili olunan içerikte tam metin arama; sonuç açılınca okuma kaydı düşer.
- **Yönetim**: kullanıcılar, ekipler, projeler, cihazlar, maskeleme kalıpları, saklama süreleri, okuma kayıtları.

Görsel dil bugünkü kokpitle aynı; tasarım taslakları kodlamadan önce onaya sunulur.

## Aşamalar (önerilen sıra)

1. **Merkez çekirdeği**: merkez modu, PostgreSQL, kullanıcı/ekip/rol, parola + passkey + Google Workspace girişi, cihaz eşleştirme.
2. **Gönderim**: toplayıcıda giden kuyruk, özet verinin (oturum, maliyet, limit) gönderimi, proje kimliği. İçerik henüz yok.
3. **Ekip ekranları**: şirket/ekip/kişi görünümleri, limitler, bekleyen onaylar, hatalar, atıl abonelikler.
4. **İş paketleri**: plan ilerlemesi, oturum-iş paketi bağlama, iş paketi maliyeti.
5. **İçerik**: maskeleme, dışlama, içerik gönderimi, arama, okuma kaydı, saklama süreleri, KVKK metni.
6. **Kurulum paketi**: Docker imajı, kurulum/yedekleme belgeleri, pilot ekiple deneme.

İçerik bilerek 5. aşamada: güvenlik önlemleri hazır olmadan konuşma içeriği merkeze gitmez.

## Builder'a bırakılanlar

- Gönderim protokolünün ayrıntısı (uç nokta yapısı, batch boyutu, sıkıştırma).
- PostgreSQL şeması ve SQLite ile ortak sorgu katmanının nasıl kurulacağı.
- Maskeleme kalıplarının ilk listesi.
- Saklama süresi varsayılanları.
- Passkey ve OIDC için kullanılacak kütüphaneler (bakımı süren, yaygın kütüphaneler tercih edilir).

## Açık sorular

- Yok. Kurucu kontrolünden çıkan sorular cevaplandı; "benim kararım" diye işaretli maddeler kullanıcının gözden geçirmesi içindir.
