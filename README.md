# Marka Outreach Uygulaması (Tek Kullanıcılı Sürüm)

Amazon marka listesini (Excel/CSV) yükle, her marka için otomatik e-mail bul, kendi Gmail
hesabından tek tık ile marka anlaşması teklif maili gönder. Sadece sen kullanacağın için
kayıt/giriş sistemi yok — direkt açılır.

## En kolay kurulum (Mac, terminal bilmeden)

1. Bu klasörü (`brand-outreach-single-user`) bilgisayarına indir/aç.
2. `.env.example` dosyasının bir kopyasını oluşturup adını `.env` yap (Finder'da dosyaya
   sağ tık > Kopyala/Yapıştır, kopyanın adını `.env` olarak değiştir).
3. `.env` dosyasını bir metin düzenleyiciyle (TextEdit) aç, şu satırları kendi bilgilerinle
   doldur (aşağıdaki "Gmail Uygulama Şifresi" bölümüne bak):
   ```
   EMAIL_USER=senin.adresin@gmail.com
   EMAIL_APP_PASSWORD=xxxxxxxxxxxxxxxx
   EMAIL_FROM_NAME=Adın Soyadın
   ```
4. `start.command` dosyasına **çift tıkla**.
   - İlk seferde macOS "bilinmeyen geliştirici" uyarısı verebilir: dosyaya sağ tık (ya da
     Control+tık) yap, "Aç" seçeneğini seç, açılan uyarıda tekrar "Aç" de. Bunu sadece ilk
     seferde yapman yeterli.
   - Bir terminal penceresi açılır, gerekli paketleri otomatik kurar (ilk seferde 1-2 dakika
     sürebilir) ve sunucuyu başlatır.
5. Terminalde "Uygulama çalışıyor -> http://localhost:3000" yazısını gördüğünde, tarayıcında
   `http://localhost:3000` adresine git.
6. Uygulamayı kapatmak istediğinde terminal penceresini kapatman yeterli. Bir daha açmak
   için tekrar `start.command`'a çift tıkla.

Terminal kullanmayı hiç bilmiyor olsan bile bu şekilde çalışır — `start.command` senin
yerine terminal komutlarını çalıştırıyor.

## Gmail Uygulama Şifresi nasıl alınır

Normal Gmail şifreni kullanamazsın, Google özel bir "Uygulama Şifresi" ister:

1. https://myaccount.google.com/security adresine git.
2. "2 Adımlı Doğrulama"yı aç (kapalıysa önce bunu açman gerekir).
3. Aynı sayfada arama kutusuna "Uygulama Şifreleri" yaz ya da doğrudan
   https://myaccount.google.com/apppasswords adresine git.
4. Bir isim yaz (örn. "Marka Outreach"), "Oluştur" de.
5. Çıkan 16 haneli şifreyi kopyala, `.env` dosyasındaki `EMAIL_APP_PASSWORD` alanına
   boşluksuz yapıştır.

## ⚠️ Render'da kalıcı veri (Persistent Disk) — ÇOK ÖNEMLİ

Render'ın (ve çoğu bulut hosting'in) web servisleri **varsayılan olarak dosyaları kalıcı
tutmaz**: bir "Persistent Disk" eklemediğin sürece, her yeni deploy'da (GitHub'a yeni bir
zip yükleyip Render'ın otomatik güncellemesinde) sunucudaki dosyalar sıfırlanır. Bu
uygulamanın tüm verisi (marka listen, bulunan e-mailler, gönderim geçmişi, takip durumu)
`data/app.sqlite` dosyasında tutulduğu için, disk eklemeden her güncelleme yaptığında **bu
veriler kayboluyor demektir.**

Bunu kalıcı hale getirmek için (bir kere yapman yeterli):

1. Render'da servisinin sayfasına git, sol menüden **Disks** sekmesine tıkla.
2. **Add Disk** de. İsim istediğin gibi olabilir (örn. `data`), **Mount Path** kısmına
   `/var/data` yaz, boyut için 1 GB yeterli (çok ucuz, aylık birkaç kuruş).
3. **Environment** sekmesine git, yeni bir değişken ekle: Key = `DATA_DIR`, Value = `/var/data`.
4. Kaydet — Render servisi yeniden başlatacak. Bundan sonra veritabanı bu kalıcı diskte
   tutulur ve GitHub'a yeni sürüm yüklesen bile silinmez.

**Not:** Disk eklemek "zero-downtime deploy" özelliğini kapatır (deploy sırasında birkaç
saniyeliğine site erişilemez olur) — tek kullanıcılı bir araç için bu önemli bir dezavantaj
değil.

Eğer şu ana kadar disk eklemeden birden fazla güncelleme yaptıysan, önceki marka listelerin
muhtemelen siliniyor olabilir — disk ekledikten sonra Excel'ini tekrar yükleyip baştan
başlayabilirsin, bundan sonrası kalıcı olacak.

## Kullanım

Soldaki menü artık ince, ikon-only bir şerit — üzerine fare götürünce genişleyip
etiketleri gösteriyor, ayrılınca tekrar daralıyor. Amaç sayfada markalar tablosuna
daha fazla yer açmak. Tablo da artık sabit sütun genişlikleriyle sayfaya sığacak
şekilde tasarlandı; "Seçilenleri Gönder" butonunun yanında kaç markanın checkbox'la
işaretlendiğini gösteren canlı bir "X marka seçili" sayacı var.

1. **Bilgilerin**: adın, şirketin, teklifin ve imzanı gir, "Kaydet"e bas (mail şablonu
   otomatik bunları kullanır).
2. **Marka listesi yükle**: Excel/CSV dosyanı seç, "Yükle"ye bas. Dosyada marka adlarının
   olduğu bir sütun olmalı (örn. "Marka" ya da "Brand"), istersen bir de website sütunu
   ekleyebilirsin — varsa arama adımını hızlandırır ve daha isabetli olur.
3. **E-mail bulma**: "Tüm markalar için email ara" butonuna bas. Bu işlem internetten
   arama yapıp markanın resmi sitesini bulmaya, sonra o sitedeki iletişim sayfalarını
   tarayıp e-mail çıkarmaya çalışır. Süre marka sayısına göre birkaç dakika sürebilir.
   - Artık tek bir arama ifadesiyle yetinmiyor: "{marka} official website" sonuç
     vermezse sırasıyla "{marka} official site" (pazar yerlerini hariç tutarak),
     "{marka}.com" (gerçekten Google/DuckDuckGo'da aratarak, eskisi gibi sadece
     direkt bağlanıp denemek yerine) ve "{marka} brand homepage contact" ifadelerini
     dener. Bir ifade hiç sonuç vermezse bir sonrakine geçer — kolay bulunan
     markalarda tek istekle biter, sadece zor markalarda ekstra deneme yapılır.
   - Excel'deki "website" sütununda bir Amazon ürün linki (amazon.com/dp/...) ya da
     başka bir pazar yeri/sosyal medya linki varsa, sistem artık bunu markanın kendi
     sitesi sanmıyor — bu tür linkleri fark edip görmezden geliyor ve resmi siteyi
     kendisi arıyor. (Eskiden bu linkler yanlışlıkla "marka sitesi" sanılıp hepsine
     aynı — mesela Amazon'a ait — bir e-mail atanabiliyordu, bu düzeltildi.)
   - Arama sonuçları artık marka adıyla domain adını karşılaştırıp en iyi eşleşeni seçiyor
     (ör. "Acme Coffee" için acmecoffee.com gibi bir sonuç, alakasız bir haber/dizin sitesine
     tercih edilir) ve seçilen sitenin ana sayfasında marka adının gerçekten geçip geçmediğini
     kontrol ediyor.
   - **Devlet (.gov), askeriye (.mil) ve eğitim kurumu (.edu) siteleri artık hiç aday
     olarak bile değerlendirilmiyor** — Amazon'da satılan bir markanın resmi sitesi
     neredeyse hiçbir zaman bu tür kurumsal siteler olamaz, bu yüzden baştan tamamen
     hariç tutuluyor. Ayrıca sık karışan haber/ansiklopedi siteleri de (history.com,
     britannica.com, nytimes.com vb.) kara listeye eklendi.
   - **Doğrulamayı geçemeyen bir site artık gerçekten reddediliyor.** Eskiden ana sayfa
     kontrolü "bu site markaya ait değil gibi" dese bile sistem yine de o siteyi
     kullanmaya devam ediyor, sadece bir uyarı notu bırakıyordu. Artık öyle değil: bir
     aday doğrulamayı geçemezse (ek bir arama isteği harcamadan) aynı sonuçlardaki bir
     sonraki adaya geçiliyor; hiçbiri geçemezse bir sonraki arama ifadesi deneniyor.
     Hiçbir aday kesin olarak doğrulanamazsa, en olası aday yine de "düşük güven"
     etiketiyle kullanılıyor (tamamen boş bırakmak yerine) — bu durumda tabloda
     e-mailin altında kırmızı **"⚠️ düşük güven — bu site markaya ait olmayabilir,
     kontrol et"** notu görünür. Bu notu gördüğün markaları göndermeden önce mutlaka
     elle kontrol et; hiç görmediğin markalarda sistem zaten kendinden emin demektir.
   - Arama sırasında **"Durdur"** butonuyla işlemi durdurabilir, sonra **"Devam Et"**
     ile kaldığı markadan itibaren devam ettirebilirsin (baştan başlamaz, sadece henüz
     aranmamış markaları işler). Not: sunucu yeniden başlarsa (örn. Render yeni bir
     deploy yaparsa) bu duraklatma bilgisi kaybolur — böyle bir durumda "Tüm markalar
     için email ara"ya tekrar basman yeterli, zaten bulunmuş markalar tekrar aranmaz.
   - E-mail bulunamayan ama markanın sitesinde bir "bize ulaşın" / iletişim formu tespit
     edilen markalarda, e-mail sütununun altında **"İletişim formu bulundu"** linki ve
     satırda bir **"Form Aç"** butonu belirir. Bu butona basınca hazırladığın mail metni
     panoya kopyalanır ve form yeni sekmede açılır — metni forma yapıştırıp elle gönderirsin.
     (Formu otomatik doldurup göndermiyoruz: her sitenin form yapısı, alan isimleri ve
     doğrulamaları farklı olduğu için körü körüne otomasyon markanın sitesine hatalı/eksik
     veri göndermesine yol açabilir — bu yüzden son adımı bilerek sana bırakıyoruz.)
4. **Mail şablonu**: konu ve içerik yaz, `{{marka}}` yazdığın her yer gönderim sırasında
   otomatik marka adıyla değişir.
   - İçerik kutusu artık zengin metin (rich text) editörü: üstündeki **K / İ / A / Liste /
     Temizle** butonlarıyla kalın, italik, altı çizili ve liste biçimlendirmesi
     ekleyebilirsin. Daha önemlisi, Word, Google Docs ya da başka bir e-mailden
     kopyaladığın bir taslağı doğrudan yapıştırabilirsin — kalın başlıklar, listeler gibi
     biçimlendirme artık kayboldu değil, korunur. Alıcıya da mail bu biçimlendirmeyle
     (HTML olarak) gider; HTML gösteremeyen eski mail istemcileri için otomatik olarak
     düz metin bir alternatif de eklenir. Takip sayfasındaki 3 aşamalı follow-up
     şablonlarında da aynı zengin metin editörü kullanılır.
5. **Gönderim**: tabloda her marka satırında e-maili kontrol et/düzelt (otomatik bulma
   %100 garanti değildir), sonra tek tek "Gönder", checkbox'larla seçtiklerine
   "Seçilenleri Gönder", ya da toplu "Bulunan tüm e-maillere gönder" butonunu kullan.
   - **Büyük listelerde (100+ marka) tek seferde hepsine göndermek riskli** — Gmail'i
     spam gönderen bir hesap gibi gösterebilir. Bunun yerine "5️⃣ Günlük otomatik
     gönderim limiti" bölümünden günde en fazla kaç mail gönderileceğini gir (örn. 60).
     Sistem bu kadarını her gün 08:00-20:00 (UTC) arasına yayarak kendiliğinden
     gönderir, elle bir şey yapmana gerek kalmaz. 0 bırakırsan bu özellik kapalı olur.
   - **Durum filtre sekmeleri**: tablonun üstünde "Tümü / Bulunanlar / Bulunamayanlar /
     Beklemede / 📩 İletişim Formu Olanlar" sekmeleri var, her birinin yanında kaç marka
     olduğu yazıyor. Bir sekmeye tıklayınca tablo o gruba filtrelenir VE o gruptaki tüm
     markalar otomatik seçilir (checkbox işaretlenir) — böylece örn. "Bulunanlar"a
     tıklayıp direkt "Seçilenleri Gönder"e basarak sadece e-maili bulunmuş markalara
     gönderebilirsin. "İletişim Formu Olanlar" sekmesi, e-maili bulunamayıp sitesinde bir
     iletişim formu tespit edilen markaları tek tek aramak yerine hepsini bir arada
     gösterir — "Form Aç" ile elle mail atman gereken markalara kolayca ulaşman için.
     "⚠️ Düşük Güven" sekmesi, sistemin bulduğu domain/e-mail'in markaya gerçekten ait
     olduğundan tam emin olamadığı markaları tek yerde toplar — diğer sekmelerden farklı
     olarak bu sekme tıklandığında **otomatik seçim yapılmaz** (amaç toplu göndermek değil,
     gözden geçirmek), her markanın satırındaki "Ara" butonuyla tekrar arattırabilirsin.
   - **"Tekrarlananları Birleştir"**: aynı marka adını birden fazla Excel'de/kez
     yüklediysen (ya da tekrar önleme özelliği eklenmeden önce yüklediysen) tabloda aynı
     marka birden fazla satır olarak görünebilir — bu butona basınca sistem aynı isimli
     satırları bulur, en gelişmiş durumdaki kaydı (gönderilmiş > bulunmuş > aranmış ama
     bulunamamış > beklemede) tutup diğerlerini siler. Bunu yapmazsan "Seçilenleri
     Gönder" aynı markaya birden fazla mail gönderebilir.

## Gönderim Takibi (yanıt kontrolü + otomatik follow-up)

Panelin sağ üstünden "Gönderim Takibi" sayfasına gidebilirsin. Bu sayfa:

- **📪 Ulaşmayanlar**: sayfanın en üstünde, mail geri dönen (bounce/teslim edilemedi)
  markaları ayrı ve öne çıkan bir kartta gösterir — genel takip listesiyle karışmaz.
  Her satırda **"Tekrar E-mail Ara"** butonu var; bastığında sistem o marka için
  yeniden internetten arama yapıp yeni bir e-mail bulmaya çalışır. Yeni bir e-mail
  bulunursa marka otomatik olarak bu listeden kalkar ve Panel sayfasından tekrar
  gönderilebilir hale gelir (eski "geri döndü" durumu temizlenir). Bulunamazsa Panel
  sayfasından e-maili elle de düzeltebilirsin.
- Gönderdiğin tüm mailleri, ne zaman gönderildiğini ("3 gün önce" gibi) listeler
- **"Yanıtları Kontrol Et"** butonuna bastığında Gmail gelen kutunu tarar, hangi markalardan
  yanıt geldiğini ve hangi maillerin **geri döndüğünü (bounce)** bulur, olumlu/olumsuz/belirsiz
  tahmini yapar (kesin bir yapay zeka analizi değildir — özellikle "belirsiz" çıkanları elle
  okuyup dropdown'dan düzeltmen önerilir). Geri dönen mailler otomatik olarak yukarıdaki
  "Ulaşmayanlar" kartına düşer.
- Olumlu bir yanıt tespit edildiğinde, kendi mail adresine otomatik bir **bildirim maili**
  gönderir (bir markadan sadece bir kez bildirim gelir, tekrar tekrar gelmez)
- **3 aşamalı otomatik takip**: yanıt gelmeyen markalara gönderim tarihinden itibaren
  7. günde 1. aşama, 14. günde 2. aşama, 30. günde (1 ay) 3. (son) aşama maili otomatik
  gider. Her aşamanın metnini ayrı ayrı düzenleyebilirsin.
- **Geçmiş**: her marka satırındaki "Geçmiş" butonuyla o markaya ait tüm gönderim/takip
  kayıtlarını (ilk mail, hangi follow-up aşaması ne zaman gönderildi, hatalar) tarih
  sırasıyla görebilirsin — "kaçıncı takibi ne zaman attık" sorusunun cevabı burada.
- **Anlaşma aşaması (pipeline)**: her marka için Yeni / Görüşme Planlandı / Numune
  Gönderildi / Anlaşma Yapıldı / Reddedildi durumlarından birini elle seçip iş sürecini
  takip edebilirsin.
- **Excel'e Aktar** butonuyla tüm marka + durum verisini tek dosya olarak indirebilirsin.
- **Bounce (geri dönen mail) tespiti**: bir mail geçersiz adrese gittiyse Gmail'in gönderdiği
  "teslim edilemedi" (failure/mailer-daemon) bildirimini fark edip o markayı hem ana panelde
  hem Gönderim Takibi sayfasında **"Ulaşmadı (Geri Döndü)"** olarak açıkça işaretler, follow-up
  döngüsüne almaz — e-maili düzeltip elle tekrar deneyebilirsin.
- **Otomatik günlük kontrol**: sunucu (Render ücretli plan) sürekli açık olduğu için, sistem
  her gün otomatik olarak (UTC 08:00, Türkiye saatiyle ~11:00) kendiliğinden yanıt/bounce
  kontrolü yapar ve zamanı gelen follow-up'ları gönderir. "Yanıtları Kontrol Et" butonuna
  ayrıca istediğin an manuel de basabilirsin.

**Önemli:** Bu özellik Gmail hesabında IMAP'ın açık olmasını gerektirir:
Gmail'de sağ üstten Ayarlar (dişli) > "Tüm ayarları gör" > **"Yönlendirme ve POP/IMAP"**
sekmesine git, **"IMAP'i Etkinleştir"** seçeneğini işaretle, kaydet.

**Not:** Günlük otomatik kontrol, sunucunun sürekli açık kalmasını gerektirir (ücretsiz Render
planında uyuduğu için güvenilir çalışmaz — bu yüzden Starter plana geçmiştin). Ücretsiz planda
kalırsan, "Yanıtları Kontrol Et" butonuna manuel basman gerekir.

## İletişim formu ile gönderimi işaretleme

E-mail bulunamayıp "Form Aç" ile iletişim formu üzerinden elle mail gönderdiysen,
gönderdikten sonra aynı satırdaki **"Gönderildi İşaretle"** butonuna bas. Bu marka
sisteme "Gönderildi" olarak kaydedilir (durumunda "(form ile)" notu görünür), tekrar
gönderim/kara liste korumasına dahil olur ve Gönderim Takibi sayfasında görünür.
(E-mail adresi olmadığı için otomatik follow-up gönderilmez — takibi elle yapman gerekir.)

## Marka istihbarat verisi (SmartScout vb. Excel'ler)

Excel dosyanda "Brand Score", "Est. Monthly Revenue", "Avg. Sellers", "Amazon In-Stock
Rate" gibi SmartScout tarzı sütunlar varsa, sistem yükleme sırasında bunları otomatik
algılayıp kaydeder — ayrıca bir şey yapmana gerek yok. Panelde her marka satırının
yanında kısa bir özet ("Skor: 82 · $45.000/ay · 6 satıcı" gibi) görünür; "Piyasa Verisi"
butonuna basarak tüm alanları (kategori, ortalama fiyat, satıcı sayıları, Amazon'un kendi
satış payı, stok oranı, puan/yorum sayısı, büyüme oranı, storefront linki vb.) görebilirsin.
Bu veriler markaları önceliklendirmen için bir yardımcı sinyaldir, otomatik bir
sıralama yapmaz — hangi markalara öncelik vereceğine sen karar verirsin.

**Tek istisna**: dosyanda "Brand Score" ve/veya "Est. Monthly Revenue" sütunu varsa
(yani bu veriyle önceliklendirme yapmak istediğin belli oluyorsa) ve bir markanın
satırında **ikisi de 0/boş** ise, o marka sisteme hiç eklenmez — SmartScout gibi
araçlarda "veri yok/aktif değil" genelde 0 olarak dışa aktarılır ve bu markalar
işine yaramaz. Dosyanda bu sütunlar hiç yoksa (sade bir marka adı listesiyse) bu
filtre devreye girmez, herkes normal şekilde eklenir. Sütun başlıkları artık daha
esnek eşleştiriliyor (ör. "Brand Score (1-100)" gibi ek metin içeren başlıkları da
yakalar), böylece bu veriler atlanmadan güvenilir şekilde çekilir.

## Tekrar yükleme / kara liste koruması

Panel artık ayrı ayrı "yüklemeler" değil, **tek ve birleşik bir marka listesi** gösterir.
Aynı marka adını (büyük/küçük harf ve boşluk farkı önemli değil) daha önce herhangi bir
Excel'de sisteme girmişsen, sonraki bir yüklemede o marka tekrar karşına çıksa bile
**satır ikinci kez eklenmez** — sistem onu otomatik atlar, böylece örtüşen SmartScout
export'larını art arda yüklesen bile markalar tabloda/metriklerde çift sayılmaz.
Yükleme bittiğinde "X yeni marka eklendi, Y tanesi sistemde zaten kayıtlı olduğu için
tekrar eklenmedi" mesajını görürsün.

Bu markanın durumu ne olursa olsun (bekliyor, bulundu, gönderildi, olumsuz yanıt,
reddedildi) fark etmez — bir kere sisteme girdiyse bir daha eklenmez; zaten var olan
kaydı tabloda görüp elle düzenleyebilir, e-mailini güncelleyebilir ya da durumunu
değiştirebilirsin. "Tüm markalar için email ara" ve gönderim de artık tek bir
yüklemeyle sınırlı değil, sistemdeki tüm uygun markaları (bekleyen/bulunamamış)
kapsar.

## Özet / Analitik

Panelin üstünden "Özet" sayfasına gidip toplam marka sayısı, e-mail bulma oranı, gönderim
sayısı, yanıt oranı, olumlu yanıt oranı ve anlaşma aşamalarının dağılımını tek bakışta
görebilirsin.

## Mailin Spam'e Düşmemesi (Deliverability)

Kod tarafında eklenenler:
- Her mailde **List-Unsubscribe** başlığı gönderiliyor — alıcı "spam" diye işaretlemek yerine
  mail istemcisindeki "abonelikten çık" seçeneğini kullanırsa, gönderici itibarın
  (sender reputation) korunur.
- **Reply-To** başlığı doğru ayarlanıyor, yanıtlar garanti şekilde sana geliyor.
- Şablon kaydederken **spam tetikleyici kelime kontrolü** yapılıyor ("free", "ücretsiz",
  "act now", çok fazla ünlem işareti gibi kalıpları tespit edip uyarıyor).

Ama en etkili adım kod dışında, **domain doğrulama** (SPF/DKIM/DMARC) kurmak — bunlar
olmadan Gmail dahil çoğu servis mailini şüpheli görebilir:

### 1. SPF (genelde zaten var, kontrol et)
Google Workspace domain'i olduğun için muhtemelen otomatik ayarlı, ama domain sağlayıcında
(DNS ayarları neofa.net için nerede yönetiliyorsa orada) şu TXT kaydının olduğunu kontrol et:
```
v=spf1 include:_spf.google.com ~all
```

### 2. DKIM (muhtemelen kurulu değil, bunu mutlaka yap)
1. admin.google.com'a gir (yönetici hesabınla)
2. **Apps > Google Workspace > Gmail > Authenticate email**'e git
3. Domain'ini seç, **"Generate New Record"** de, key length olarak **2048-bit** seç
4. Google sana bir TXT kaydı verir (host adı genelde `google._domainkey`), bunu domain'inin
   DNS ayarlarına ekle
5. DNS'e ekledikten sonra Google Admin'e dönüp **"Start Authentication"** de

### 3. DMARC
Domain'inin DNS ayarlarına şu TXT kaydını `_dmarc.neofa.net` host adıyla ekle:
```
v=DMARC1; p=none; rua=mailto:dmarc@neofa.net
```
(`p=none` sadece izleme yapar, hiçbir maili engellemez — güvenli bir başlangıç. Zamanla
raporlara göre `p=quarantine` ya da `p=reject`'e geçirilebilir.)

Bu üç kayıt da DNS'e yayılmak için 1-48 saat sürebilir. Kurduktan sonra
[mail-tester.com](https://www.mail-tester.com) gibi bir siteye test maili atıp spam
puanını kontrol edebilirsin.

### Diğer öneriler
- İlk günlerde az sayıda mail gönderip yavaş yavaş artır ("warm-up") — birden 50-100 mail
  atmak yeni/az kullanılan bir gönderim düzenini şüpheli gösterebilir.
- Şablonlarda çok fazla link, büyük harfle yazılmış kelimeler, aşırı ünlem işareti kullanma.
- Alıcı "spam" derse ya da olumsuz yanıt verirse (sistem zaten bunu **kara liste** özelliğiyle
  hariç tutuyor) bir daha o markaya yazma — şikayet oranı düşük tutmak en önemli faktör.

## AI destekli doğrulama (opsiyonel, hata payını azaltır)

`.env`'e `ANTHROPIC_API_KEY` eklersen (https://console.anthropic.com üzerinden alınır —
**Claude uygulaması/claude.ai aboneliğinden farklıdır**, ayrı ve kullandıkça ödemeli bir
API anahtarıdır), sistem iki noktada Claude'a "ikinci görüş" sorar:

1. **Doğru siteyi seçerken**: arama sonuçları arasında kelime eşleştirmesi (heuristik)
   emin olamadığında — örneğin marka adı domain'de birebir geçmiyorsa — Claude'a arama
   sonuçlarının başlık/özetini gösterip "bunlardan hangisi gerçekten bu markanın resmi
   sitesi?" diye sorar.
2. **Seçilen siteyi doğrularken**: ana sayfada marka adı birebir geçmiyorsa (ör. "Method"
   markasının sitesi "Method Home" yazıyor olabilir), Claude sayfa başlığı ve içeriğine
   bakıp bu sitenin gerçekten o markaya ait olup olmadığını değerlendirir.

Önemli: **AI sadece heuristiğin emin olamadığı belirsiz durumlarda çağrılır** — kolay/net
eşleşmelerde (ör. "Nike" için nike.com) AI'a hiç gidilmez. Bu hem hızı korur hem de API
maliyetini düşük tutar (Haiku modeli kullanılır, ucuz ve hızlıdır).

**Dürüst olmak gerekirse:** hata payını tam olarak sıfıra indirmek mümkün değil — internet
üzerindeki veriler her zaman %100 net olmayabilir, bazı markaların birden fazla web sitesi
olabilir ya da hiç resmi sitesi yayında olmayabilir. Bu AI katmanı, heuristiğin tek başına
yanlış karar verdiği durumların önemli bir kısmını yakalayıp düzeltir ve şüpheli durumlarda
"göndermeden önce elle kontrol et" uyarısı ekler (bkz. "Detay" butonu) — ama %100 garanti
sağlayan bir sistem yoktur, göndermeden önce kontrol etme alışkanlığını bırakma.

## Önemli sınırlamalar

- **E-mail bulma doğruluğu**: ücretsiz yöntem (arama + site tarama) her marka için sonuç
  bulamayabilir, bazen yanlış/genel bir e-mail bulabilir. Göndermeden önce mutlaka kontrol
  et. Daha isabetli sonuç için `.env`'e `SERPER_API_KEY` (serper.dev) ve/veya `SERPAPI_KEY`
  (serpapi.com), ayrıca `HUNTER_API_KEY` (hunter.io) eklenebilir — hepsinin ücretsiz/deneme
  planı var.
- **Hangi arama sağlayıcısını kullanmalıyım?**: `SERPER_API_KEY` tanımlıysa domain arama
  önce onunla denenir, sonra `SERPAPI_KEY` ile, ikisi de yoksa/kotası bittiyse ücretsiz
  DuckDuckGo'ya düşer. Fiyat/performans açısından **Serper.dev genelde SerpAPI'den dolar
  başına çok daha fazla arama hakkı verir** (SerpAPI'de $25/ay ~1.000 arama, Serper.dev'de
  aynı paraya ~25.000 arama civarı — kesin rakamlar zamanla değişebilir, satın almadan önce
  ilgili sitelerin güncel fiyat sayfasına bak). Yani ek arama hakkı satın alacaksan
  Serper.dev'e yatırım yapmak genelde daha verimli.
- **Not**: SerpAPI/Serper.dev sadece markanın **resmi domain'ini bulmak** için kullanılır;
  gerçek e-mail adresini bulma işini Hunter.io ya da ücretsiz site taraması yapar. Yani bu
  API'lerden birine kota alman, sitesi genelde hiç e-mail yayınlamayan (sadece iletişim
  formu olan) markalarda e-mail bulma oranını artırmaz — sadece doğru siteyi bulma oranını
  artırır.
- **Kota biterse**: hangi sağlayıcının kotası biterse (HTTP 429/402 ya da API'nin kendi
  döndürdüğü "kota bitti" hata mesajı) uygulama o sağlayıcıyı 1 saat boyunca atlayıp bir
  sonrakine geçer, böylece boşa istek harcamaz. Kotalar genelde her ay sıfırlanır.
  (Önceki bir sürümde bu kontrol yanlışlıkla arama sonuçlarının başlık/özet metnindeki
  sıradan kelimelere de bakıyordu — ör. "White House Historical Association" gibi bir
  aramada sonuç metninde geçen alakasız bir "limit" kelimesi yüzünden kota hâlâ doluyken
  bile sağlayıcı 1 saatliğine yanlışlıkla devre dışı bırakılabiliyordu. Bu düzeltildi:
  artık sadece API'nin kendi hata alanına bakılıyor.)
- **Panelin sağ üstündeki "API Kredileri" kutusu**: SerpAPI ve Hunter.io kendi resmi
  "hesap" uç noktalarını sağladığı için kalan arama/istek sayısını gerçek zamanlı ve
  doğru şekilde gösterir. Serper.dev ve Anthropic (Claude) API'lerinin ise kalan
  kredi/bakiyeyi döndüren resmi bir uç noktası yok — bunlar için kutu "ilgili panelden
  bak" der (serper.dev dashboard'u / console.anthropic.com), uydurma bir sayı göstermez.
- **Gönderim limiti**: normal bir Gmail hesabının günlük gönderim limiti var (~500 mail/gün).
  Çok büyük listelerde bunu aşmamaya dikkat et. Uygulama gönderimler arasına 1.5 saniye
  bekleme koyar.
- **Spam / mevzuat**: alıcıların gerçek marka iletişim adresleri olduğundan emin ol,
  gönderdiğin içeriğin ticari elektronik ileti mevzuatına (KVKK/GDPR bölgene göre) uygun
  olmasına dikkat et.
- Bu sürüm tek kullanıcı için tasarlandı; veriler (marka listesi, gönderim geçmişi) sadece
  senin bilgisayarındaki `data/app.sqlite` dosyasında tutulur, başka kimseyle paylaşılmaz.

## Windows kullanıyorsan

`start.command` sadece Mac'te çalışır. Windows'ta:
1. https://nodejs.org üzerinden Node.js (LTS) kur.
2. Klasörde boş bir alana Shift+sağ tık > "PowerShell penceresini burada aç".
3. Sırasıyla: `npm install`, `.env.example` dosyasını `.env` olarak kopyala ve doldur,
   sonra `npm start`.
4. Tarayıcıda `http://localhost:3000` aç.

## Dosya yapısı

```
brand-outreach-single-user/
  start.command          # Mac için çift-tık başlatıcı
  src/
    server.js             # Express sunucusu
    db.js                 # SQLite şeması (settings, brands, send_log)
    routes/settings.js     # Profil/imza ayarları
    routes/brands.js       # Excel yükleme, e-mail bulma, gönderim
    routes/tracking.js     # Yanıt kontrolü + otomatik follow-up
    services/mailer.js     # Gmail App Password ile mail gönderme (nodemailer)
    services/emailFinder.js # Marka -> e-mail bulma mantığı
    services/inboxChecker.js # Gmail IMAP ile yanıt kontrolü + basit sentiment tahmini
  public/                 # Panel (index.html) + Gönderim Takibi (tracking.html)
  sample_brands.csv       # Test için örnek marka listesi
  .env.example
```
