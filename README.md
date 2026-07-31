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
   - **Yapay zeka artık her adımda ZORUNLU bir ikinci görüş olarak çalışıyor (ANTHROPIC_API_KEY
     tanımlıysa).** Eskiden AI sadece heuristik (kelime eşleştirme) belirsiz kaldığında devreye
     giriyordu; bu, heuristiğin YANLIŞLIKLA "eşleşti" dediği durumlarda (ör. iki farklı aday
     domain de marka adının bir kısmını içeriyorsa, ama sadece biri gerçek resmi site) hiç
     kontrol edilmemesine yol açıyordu. Artık iki noktada AI'ın onayı isteniyor:
     1) **Aday seçimi**: bir arama ifadesi için Serper/SerpAPI/DuckDuckGo'dan gelen TÜM adaylar
        birleştirilip AI'a birlikte gösteriliyor (eskiden her sağlayıcı ayrı ayrı sorulurdu);
        AI, heuristiğin hangi adayı önerdiğine bakmaksızın kendi bağımsız değerlendirmesini
        yapıyor ve gerekirse sırayı değiştiriyor.
     2) **Ana sayfa doğrulaması**: seçilen domain'in ana sayfası, heuristik "marka adı geçiyor"
        dese bile AI'a tekrar soruluyor — benzer isimli ama farklı bir şirket, parked/expired
        domain ya da jenerik bir şablon mağaza olup olmadığını AI ayırt etmeye çalışıyor.
     Bu, doğruluğu belirgin şekilde artırır ama her marka için birden fazla ek AI çağrısı
     anlamına gelir — yani arama biraz daha yavaş çalışır ve (Anthropic API kullanım ücreti
     üzerinden) biraz daha maliyetli olur. ANTHROPIC_API_KEY tanımlı değilse sistem eskisi gibi
     sadece heuristikle çalışmaya devam eder, hiçbir şey bozulmaz — ama bu durumda AI'ın
     sağladığı ekstra doğruluk artışından yararlanamazsın. **Hata oranını gerçekten en aza
     indirmek istiyorsan bir Anthropic API anahtarı edinip Render'da ANTHROPIC_API_KEY olarak
     tanımlamanı öneririm** (https://console.anthropic.com — ayrı, kullandıkça öder bir hesap;
     Haiku modeli ucuzdur).
   - **Excel'deki Amazon verisi (kategori + mağaza sayfası) artık doğrulamaya dahil ediliyor.**
     Excel'inde "Main Category" / "Primary Subcategory" ve "Storefront Url" sütunları varsa
     (SmartScout-tarzı dosyalarda genelde olur), sistem bunları şöyle kullanıyor:
     1) **Kategori bağlamı**: "Bu marka Amazon'da Mutfak Aletleri kategorisinde satıyor" gibi
        bir bilgi, hem aday site seçiminde hem de ana sayfa doğrulamasında AI'a ek bir ipucu
        olarak veriliyor — bulunan site tamamen alakasız bir kategoride ürün satıyorsa (ör.
        yazılım, emlak) AI bunu şüpheli bulup reddedebiliyor. Bu adımda hiçbir ek ağ isteği
        yapılmıyor, sadece Excel'deki veriyi daha akıllıca kullanıyoruz.
     2) **Amazon mağaza sayfası (Storefront Url) taraması**: sistem bu linki bir kez taramayı
        dener; başarılı olursa marka açıklamasını da AI'a bağlam olarak verir, ve eğer sayfada
        (nadiren de olsa) markanın kendi web sitesine bir dış link bulursa, önce onu doğrulayıp
        (körü körüne güvenmeden, aynı merkezi kontrolden geçirerek) geçerse DİREKT kullanır —
        bu durumda internet araması tamamen atlanır, hem daha hızlı hem daha isabetli olur.
        **Dürüst bir uyarı**: Amazon Store sayfaları politika gereği genelde dışarıya link
        vermeye izin vermez, bu yüzden bir dış link bulma ihtimali düşüktür — bu özellik
        bulunduğunda bonus bir kazanç sağlar, bulunmadığında (çoğu durumda) sistem sessizce
        normal arama akışına devam eder. Ayrıca Amazon, veri merkezi IP'lerinden (Render
        dahil) gelen istekleri sık sık engeller/CAPTCHA gösterir — bu da taramanın bazen hiç
        sonuç vermemesinin normal bir sebebidir, hata değildir.
   - **Marka adının "genel" bir kelimeye dayandığı durumlarda yanlış eşleşme riski azaltıldı.**
     "Shop", "Home", "Life", "Care", "Plus" gibi çok yaygın kelimeler tek başına artık güvenilir
     bir eşleşme sinyali sayılmıyor (ör. "Modern Life" markası için "modernguitars.com" gibi
     alakasız bir site, sadece "modern" kelimesini içerdiği için eskiden yanlışlıkla eşleşebilirdi)
     — böyle durumlarda en az iki kelimenin (ya da tam marka adının) domain'de geçmesi aranıyor.
   - **Hunter.io'nun kendi e-mail güven skoru artık kullanılıyor.** Hunter.io her bulduğu
     e-mail için kendi içinde 0-100 arası bir güven puanı veriyor (bu adres gerçekten
     çalışıyor mu, doğrulanmış mı gibi sinyallerden hesaplıyor); eskiden bu puan hiç
     kullanılmıyor, sadece e-mail adresinin kendisi alınıyordu. Artık bu puan hem "hangi
     e-mail önce denensin" sıralamasında hem de nihai güven etiketinde (yüksek/orta/düşük)
     hesaba katılıyor — Hunter'ın 50'nin altında puan verdiği bir e-mail otomatik olarak
     "düşük güven" işaretleniyor, domain doğrulaması ne kadar iyi geçmiş olursa olsun.
   - **Düşük güvenli markalar artık toplu ve otomatik gönderimden hariç tutuluyor.**
     "Bulunan tüm e-maillere gönder" butonuna bastığında sistem "⚠️ Düşük Güven"
     etiketli markaları listeye hiç dahil etmiyor; eğer hariç tutulan marka varsa
     kaç tanesinin atlandığını söyleyip geri kalanlara devam edip etmeyeceğini soruyor.
     Aynı şekilde günlük otomatik gönderim (5️⃣ bölümündeki limit) de düşük güvenli
     markaları otomatik olarak seçmiyor. Bu markalara göndermek istersen "⚠️ Düşük
     Güven" sekmesinden bulup önce "Ara" ile tekrar arattırabilir ya da elle kontrol
     edip tek tek "Gönder" ile gönderebilirsin — amaç yanlış markaya mail gitme
     riskini, elindeki kontrolü kaybetmeden en aza indirmek.
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
  markaları ayrı ve öne çıkan bir kartta, artık **gerçek hata mesajıyla birlikte**
  gösterir ("Hata Mesajı" sütunu — neden geri döndüğünü açıkça görürsün, örn. "geçersiz
  adres olabilir" ya da AI'ın tespit ettiği asıl sebep). Her satırda **"Tekrar E-mail
  Ara"** butonu var; bastığında sistem o marka için yeniden internetten arama yapar.
  Yeni bir e-mail bulunursa artık **Panel sayfasına gitmene gerek kalmadan**, aynı
  satırda beliren **"Şimdi Gönder"** butonuyla direkt gönderebilirsin (ana mail
  şablonunu kullanır). Bulunamazsa Panel sayfasından e-maili elle de düzeltebilirsin.
  - **Bounce tespiti güçlendirildi**: sistem artık gelen kutusunda çok daha geniş bir
    gönderen/konu başlığı listesi tarıyor (mailer-daemon, postmaster, "Mail Delivery
    Subsystem", "Undeliverable", "Delivery Status Notification", "Message blocked" ve
    benzeri 20'den fazla varyasyon) — eskiden sadece 4 kalıp aranıyordu, bu yüzden
    birçok gerçek bounce bildirimi hiç yakalanamıyordu. Ayrıca bir markadan gelen
    "yanıt" gibi görünen ama aslında otomatik bir teslim-edilemedi bildirimi olan
    mailler de artık ayırt edilip (yapay zeka tanımlıysa AI ile, değilse geniş bir
    anahtar kelime listesiyle) doğru şekilde "Ulaşmayanlar"a düşüyor; eskiden bunlar
    yanlışlıkla normal bir yanıt gibi sayılabiliyordu.
  - **"Farklı adresten gelen yanıt" tespiti**: markanın kendi adresine gönderdik ama
    şirketteki başka biri (satış temsilcisi, farklı bir departman vb.) FARKLI bir
    adresten yanıtlamış olabilir — B2B outreach'te çok sık rastlanan bir durum, eskiden
    sistem bunu hiç yakalayamıyordu (sadece tam eşleşen adresi arıyordu). Artık tam
    eşleşme bulunamazsa aynı domain'den gelen mailler de denenir; bu şekilde bulunan
    yanıtların özetine otomatik olarak "[Not: bu yanıt marka adresinin kendisinden
    değil, aynı domain'deki farklı bir adresten geldi — kontrol et]" notu eklenir.
  - **Kritik hata düzeltmesi — "0 bulundu" sorunu**: eskiden gelen kutusu taramasında
    (bağlantı, kimlik doğrulama, tek bir mesajı okuyamama gibi) oluşan hatalar sessizce
    yutuluyor, hiçbir yerde gösterilmiyordu — bu yüzden gerçekte yanıt/bounce olsa bile
    ekranda "0 bulundu" görünebiliyordu ve neden olduğunu anlamak mümkün değildi. Artık
    bu hatalar toplanıp **"Yanıtları Kontrol Et"** sonucunun altında kırmızı bir kutuda
    açıkça listeleniyor. Ayrıca yanında yeni bir **"IMAP Bağlantısını Test Et"** butonu
    var — sonuçlar hep 0 çıkıyorsa önce bunu dene: saniyeler içinde bağlantının gerçekten
    kurulup kurulmadığını ve gelen kutusunda kaç mesaj/okunmamış mesaj olduğunu gösterir,
    böylece sorunun bağlantıda mı yoksa arama kriterlerinde mi olduğunu ayırt edebilirsin.
  - Not: hiçbir yöntem teslim edilemedi bildirimlerinin veya yanıtların %100'ünü
    yakalayamaz (her mail sunucusu farklı formatta bildirim gönderebilir, bazı bounce
    mesajları sadece HTML gövde içerebilir — bu durum da artık ayrıca ele alınıyor) —
    kapsam önemli ölçüde genişledi ama garanti değil.
- **Takip Listesi filtre sekmeleri**: "Tümü / ⏳ Yanıt Bekleniyor / 👍 Olumlu / 👎 Olumsuz /
  ❓ Belirsiz / 📎 Belge Bekleyen" sekmeleriyle, her kategoriyi tek tıkla filtreleyip o
  gruptaki markalara tek tek işlem yapabilirsin (yanıt tonunu düzelt, anlaşma aşamasını
  ilerlet, belge gönderildi olarak işaretle vb.) — her sekmenin yanında kaç marka
  olduğu yazar.
- **📎 Belge/Onay İsteyen Markalar**: bir marka yanıtında iş lisansı, yeniden satış/bayilik
  sertifikası, vergi kimlik no (EIN/Tax ID), W9 formu, ticaret sicil belgesi, vergi levhası
  gibi bir belge/evrak istediğinde bu ayrı kartta listelenir (aynı zamanda ana takip
  listesinde de "📎 Belge isteniyor" etiketiyle görünür). Anahtar kelime taraması ve,
  ANTHROPIC_API_KEY tanımlıysa, yapay zeka analiziyle tespit edilir. İlgili belgeyi
  gönderdikten sonra **"Belge Gönderildi, İşaretle"** ile listeden kaldırabilirsin.
- Gönderdiğin tüm mailleri, ne zaman gönderildiğini ("3 gün önce" gibi) listeler
- **"Yanıtları Kontrol Et"** butonuna bastığında Gmail gelen kutunu tarar, hangi markalardan
  yanıt geldiğini ve hangi maillerin **geri döndüğünü (bounce)** bulur, olumlu/olumsuz/belirsiz
  tahmini yapar. **ANTHROPIC_API_KEY tanımlıysa artık bu sınıflandırmayı yapay zeka (Claude
  Haiku) yapıyor** — sadece olumlu/olumsuz/belirsiz değil, gerçek bir insan yanıtı mı yoksa
  otomatik bir bounce/ofis-dışı yanıtı mı olduğunu ve bir belge talebi içerip içermediğini de
  anlıyor; bu, sadece anahtar kelime eşleştirmesinden çok daha isabetli sonuç verir. API
  anahtarı tanımlı değilse sistem eskisi gibi anahtar kelime listesiyle çalışmaya devam eder
  (hiçbir şey bozulmaz, sadece daha kaba bir tahmin olur) — bu durumda özellikle "belirsiz"
  çıkanları elle okuyup dropdown'dan düzeltmen önerilir. Geri dönen mailler otomatik olarak
  yukarıdaki "Ulaşmayanlar" kartına, belge isteyenler "Belge/Onay İsteyen Markalar" kartına düşer.
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

## Aynı e-postaya farklı marka adıyla tekrar mail koruması (v34)

Bazı distribütörlerin/şirketlerin birden fazla alt markası hep aynı `info@` adresine
düşer. Sistem artık bunu otomatik tespit ediyor: bir marka için bulunan e-posta zaten
başka bir markaya ait/gönderilmiş görünüyorsa (ya da beklemede) o kayıt otomatik olarak
**"Tekrar (Engellendi)"** durumuna alınır — aynı kutuya farklı marka adıyla iki ayrı iş
teklifi maili gitmez. Panelde ayrı bir filtre sekmesinden bu markaları görebilirsin;
gerçekten farklı bir e-posta bulmak istersen "Ara" ile tekrar arattırabilirsin.

## Kalıcı "Bir Daha Yazma" Listesi (v34)

Bir marka yanıtında açıkça "unsubscribe", "remove me", "bir daha yazma" gibi net bir
çıkış talebinde bulunursa (yanıt kontrolü sırasında hem anahtar kelime hem de, tanımlıysa,
yapay zeka ile tespit edilir), o e-posta adresi **kalıcı** bir "bir daha yazma" listesine
eklenir. Bu liste marka bazlı değil **e-posta bazlıdır**: marka kaydı silinse, Excel'den
yeniden yüklense, farklı bir marka adıyla aynı adres tekrar karşına çıksa bile sistem o
adrese bir daha ASLA mail göndermez (tekli gönderim, toplu gönderim, otomatik günlük
gönderim ve otomatik follow-up'ların hepsinde kontrol edilir). Panel ana sayfasında
("Bilgilerin" kartının altında) bu listeyi görebilir, elle adres ekleyip çıkarabilirsin.
Ayrıca her mailde giden **List-Unsubscribe** başlığı sayesinde alıcı mail istemcisindeki
tek tık "abonelikten çık" seçeneğini kullanırsa bu da otomatik olarak listeye eklenir.

## Bounce Oranı Güvenlik Freni (v34)

Son 24 saatte gönderilen maillerin çok yüksek bir oranı (varsayılan eşik: en az 5
gönderim örnekleminde %30 ve üzeri) geri dönerse (bounce), sistem **otomatik günlük
gönderimi kendiliğinden durdurur** — kötü/eski bir e-posta listesiyle göndericinin
itibarının (sender reputation) daha da zedelenmesini önlemek için. Bu tetiklendiğinde
sana bir bildirim maili gider ve panelde kırmızı bir uyarı banner'ı görünür. Sorunu
inceledikten sonra ("Ulaşmayanlar" listesine bakıp muhtemelen bozuk adresleri
temizledikten sonra) banner'daki "Sorunu inceledim, devam et" butonuyla elle
sıfırlayabilirsin — freni otomatik olarak biz açmıyoruz, çünkü asıl sorunu çözmeden
tekrar göndermeye devam etmek aynı hataya düşmek olur.

## Haftalık Özet Maili (v34)

Her Pazartesi (UTC 08:05) son 7 günün özeti otomatik olarak sana mail atılır: kaç mail
gönderildi, kaç yanıt geldi (kaçı olumlu), kaç mail geri döndü, kaç marka belge istedi,
kaç yeni adres "bir daha yazma" listesine eklendi, ve bu haftaki olumlu yanıtların kısa
bir listesi. Test etmek ya da hemen bir özet almak istersen "Gönderim Takibi" sayfasındaki
**"📊 Haftalık Özeti Şimdi Gönder"** butonunu kullanabilirsin (aynı hafta içinde ikinci
bir tane gitmesin diye otomatik olarak korunur).

## CAN-SPAM Fiziksel Adres (v34)

ABD'ye ticari mail gönderirken geçerli olan CAN-SPAM Act, gönderenin gerçek bir fiziksel
posta adresini içermesini zorunlu kılıyor. "Bilgilerin" kartına şirket adresini bir kez
girdiğinde, bu adres her mailin altına (hem HTML hem düz metin sürümüne) otomatik olarak
küçük bir footer olarak ekleniyor — hem yasal gereklilik hem de spam filtrelerinin
"gerçek bir şirket" sinyali olarak baktığı bir unsur.

## LinkedIn Doğrulama Sinyali (v34)

Yapay zeka doğrulaması (ANTHROPIC_API_KEY tanımlıysa) artık ek bir ipucu olarak markanın
LinkedIn şirket sayfasını da arıyor. LinkedIn'in kendisi oturum açmamış isteklere neredeyse
her zaman bir "giriş yap" duvarı gösterdiği için sayfayı doğrudan açıp okumuyoruz —
bunun yerine arama motorunun zaten indekslediği başlık/özet metnini kullanıyoruz, bu da
LinkedIn'e hiç istek atmadan çalışabiliyor. Bulunursa bu bilgi, doğru siteyi/markayı
seçerken AI'ya ek bir bağlam olarak veriliyor; bulunamazsa (LinkedIn araması çoğu zaman
sonuçsuz kalabilir) hiçbir şeyi etkilemeden sessizce atlanır.

## Marka Notları (v34)

Her markanın e-mail alanının hemen altında küçük bir "Not ekle" kutusu var — "tekrar ara",
"fiyat teklifi bekliyor", "telefonla arandı" gibi kişisel hatırlatmalar için kullanabilirsin.
Yazdığın not otomatik kaydedilir ve Excel'e aktarımda da bir sütun olarak çıkar.

## Değer Bazlı Gönderim Sırası (v35)

Hem otomatik günlük gönderim hem de "Bulunan tüm e-maillere gönder" / "Seçilenleri
Gönder" artık markaları rastgele/ID sırasıyla değil, Excel'den gelen **Brand Score**
ve **Est. Monthly Revenue** değerlerine göre en değerliden başlayarak gönderiyor —
en iyi fırsatlara ilk elden ulaşmış olursun. Bu veriler yoksa (sade bir marka listesi
yüklediysen) sıralama hiçbir şeyi değiştirmez.

## Telefon Numarası (v35)

Hunter.io bazen bir e-mail kaydına eşlik eden bir telefon numarası da döndürüyor
(nadiren dolu oluyor). Bulunursa marka satırında e-mail alanının altında küçük bir
📞 etiketiyle görünür ve Excel'e aktarımda da bir sütun olarak çıkar — doğrudan
aramak için ekstra bir kanal.

## Ülke Bazlı Gönderim Saati (v35)

Excel'de bir "Country" sütunu varsa, otomatik günlük gönderim artık markanın kendi
ülkesindeki yaklaşık iş saatlerini (09:00-18:00 yerel saat) gözetiyor — en değerli
aday şu an markanın ülkesinde gece yarısıysa, sırayla bir sonraki en değerli, o an
iş saatlerinde olan adaya geçiyor. Ülke bilinmiyorsa/desteklenmiyorsa (yaklaşık 40
yaygın ülke için bir eşleme var) gönderim engellenmez, eskisi gibi UTC 08:00-20:00
penceresinde devam eder.

## Domain Yaşı (WHOIS) Sinyali (v35)

Yapay zeka doğrulaması artık (ANTHROPIC_API_KEY tanımlıysa) adayın WHOIS kaydına da
bakıyor — herhangi bir yeni paket kurulmadan, Node'un yerleşik ağ modülüyle en yaygın
uzantılar (.com, .net, .org, .io, .co, .info, .biz, .us, .shop, .store) için doğrudan
sorgu atılıyor. Domain çok yeni kaydedilmişse (180 günden az) bu, AI'ya "dikkatli ol,
bu köklü bir marka sitesi olmayabilir" diye ek bir uyarı sinyali olarak veriliyor;
uzun süredir kayıtlıysa bu olumlu bir sinyal sayılıyor. WHOIS sunucuları bazı bulut
IP'lerini kısıtlayabildiği için bu tamamen best-effort — sorgu başarısız olursa (ya da
desteklenmeyen bir uzantıysa) sessizce atlanır, hiçbir şeyi bozmaz.

## Otomatik Haftalık Yedekleme (v35)

Her Pazartesi (UTC 08:10, haftalık özet mailinden hemen sonra) veritabanının kendisi
(`data/app.sqlite`) sana mail eki olarak gönderiliyor — Render'da disk sorunu çıkması
ya da yanlışlıkla bir şeyin silinmesi ihtimaline karşı basit ama etkili bir sigorta.
Bir sorun çıkarsa bu eki indirip `data/` klasörüne `app.sqlite` adıyla koyman yeterli.
Panelde "Bilgilerin" kartındaki **"💾 Şimdi Yedekle"** butonuyla istediğin an elle de
tetikleyebilirsin.

## Soğuk Marka Yeniden Isıtma (v35, opsiyonel/varsayılan kapalı)

Bazen bir marka hiç yanıt vermez ya da "şu an ilgilenmiyoruz" der, ama zaman içinde
koşullar değişebilir. "Bilgilerin" kartındaki ilgili kutucuğu işaretlersen: 3 aşamalı
takibi tamamlayıp hiç yanıt vermeyen markalara 120 gün sonra, olumsuz yanıt verenlere
ise 180 gün sonra (daha temkinli bir süre) otomatik olarak bir şans daha veriliyor —
marka tekrar gönderim kuyruğuna alınıyor, notlar alanına ne zaman/neden yeniden
ısıtıldığı otomatik not düşülüyor. Her markaya en fazla 2 kez uygulanıyor (sonsuz
döngü olmasın diye) ve kalıcı "bir daha yazma" listesindeki adresler bu özellikten
her koşulda muaf. Bu özellik varsayılan **kapalı** — bilinçli bir tercih, çünkü bazı
kullanıcılar için "hayır" diyen birine tekrar yazmak agresif görünebilir; sen açmayı
seçersen devreye girer.

## MX Kaydı Kontrolü (v36)

Bir domain'in gerçekten mail alabildiğini (MX kaydı var mı) e-mail bulma sırasında artık
otomatik kontrol ediyoruz. MX kaydı kesin olarak yoksa (domain hiç mail sunucusu belirtmemiş)
bulunan e-mailin güven seviyesi otomatik olarak "düşük"e düşürülüyor — o adrese giden her
mail kesin olarak geri döner, göndermeden önce fark etmen için. Geçici bir DNS sorunu
(zaman aşımı, sunucu erişilemedi vb.) olursa **cezalandırmıyoruz** — sadece kesin bir "MX
yok" sonucunda güven düşürülür, belirsiz durumlarda hiçbir şey değişmez.

## SPF/DKIM/DMARC Canlı Doğrulama (v36)

Yukarıdaki "Mailin Spam'e Düşmemesi" bölümü SPF/DKIM/DMARC kaydını nasıl kuracağını
anlatıyordu ama gerçekten kurulu olup olmadığını sana bırakıyordu. Artık sistem bunu
kendisi doğrulayabiliyor: **"🔍 SPF / DKIM / DMARC Kontrolü"** kartındaki **"Şimdi Kontrol
Et"** butonuna basınca, gönderici adresinin (`EMAIL_USER`) domain'i için üç kaydı da canlı
olarak sorgulayıp SPF var mı, DMARC var mı (ve politikası ne — none/quarantine/reject),
DKIM'in en yaygın selector'larından biri kurulu mu olduğunu gösterir. DKIM için kesin bir
"yok" tespiti yapılamaz (domain sahibi özel bir selector adı seçmiş olabilir) — sadece en
yaygın birkaçı denenir, hiçbiri bulunamazsa bu bir uyarı olarak gösterilir, kesin bir hata
değildir.

## Kota Tükenmesi Proaktif Uyarısı (v36)

Serper.dev, SerpAPI ya da Hunter.io hesaplarından birinin aylık kotası bittiğinde, e-mail
bulma sonuçlarının "trace" (detay) kayıtlarında bu genelde bir iz bırakır ama eskiden
kimse fark etmeden yüzlerce marka için boşuna arama denemesi devam edebiliyordu. Artık bu
kalıplar (HTTP 429, "kotası bitmiş görünüyor" vb.) tespit edilir edilmez sana **günde en
fazla bir kez** bir uyarı maili gider — hangi sağlayıcının muhtemelen bittiğini ve panelin
sağ üstündeki "API Kredileri" kutusundan nasıl kontrol edebileceğini söyler.

## Kademeli Isınma (Warm-up) Otomasyonu (v36, opsiyonel/varsayılan kapalı)

Yeni ya da uzun süre az kullanılmış bir Gmail hesabından birden yüksek hacimde mail atmak
(ör. günde 60) spam filtrelerinde şüphe uyandırabilir. "Bilgilerin" kartındaki ilgili
kutucuğu işaretlersen, günlük otomatik gönderim hedefe (**Günlük Gönderim Limiti**'ne) tek
seferde değil, **kademeli olarak** ulaşır: başlangıç limitinden (varsayılan 10) başlar,
her hafta belirlediğin miktar kadar (varsayılan +10) artar, ta ki hedefe ulaşana kadar.
Özelliği kapatıp tekrar açarsan ısınma sıfırdan başlar (yarım kalmış bir ısınmayı
sürdürmez) — bu bilinçli bir tercih, çünkü uzun süre kapalı kaldıysan hesabın "ısınmışlık"
durumu da muhtemelen eskisi gibi değildir.

## Doğrulama Çağrılarında Sonnet Kullanımı (v36)

Yapay zeka doğrulaması (ANTHROPIC_API_KEY tanımlıysa) iki kritik karar noktasında —
"adaylardan hangisi doğru domain" ve "seçilen ana sayfa gerçekten bu markaya mı ait" —
artık ucuz/hızlı Haiku yerine daha güçlü **Sonnet** modelini kullanıyor. Bu iki çağrı
zaten düşük hacimli (sadece heuristiğin emin olamadığı durumlarda tetiklenir) olduğu için
ek maliyet ihmal edilebilir düzeyde kalırken, yanlış siteye/kişiye mail gitme riskini
daha da azaltır. Yanıt sınıflandırma (bir cevabın olumlu/olumsuz olduğunu anlama) gibi
daha düşük riskli çağrılar hâlâ Haiku ile çalışmaya devam ediyor — hız ve maliyet dengesi
için.

## Kalıcı Otomatik Test Seti (v36)

Projeye artık `tests/` klasöründe, harici bir test framework'üne (jest/mocha vb.) ihtiyaç
duymadan çalışan bir test seti eklendi. Kapsadığı kritik mantık: çapraz marka aynı e-posta
koruması, kalıcı "bir daha yazma" listesi, bounce oranı güvenlik freni, soğuk marka yeniden
ısıtma, MX kaydı sınıflandırması, SPF/DKIM/DMARC doğrulaması, kademeli ısınma hesaplaması
ve ülke bazlı gönderim saati. Her test dosyası kendi izole geçici SQLite veritabanını
kullanır, gerçek üretim koduna dokunur (kopya/simülasyon değil) ve gerçek bir ağ isteği
atmaz (DNS sorguları sahte/mock yanıtlarla test edilir). Çalıştırmak için:
```
npm test
```
(Önce `npm install` ile paketlerin kurulu olması gerekir — bkz. kurulum adımları.) Bir
şey bozulursa hangi test dosyasının/kontrolün başarısız olduğunu ekranda görürsün.

## Kategori Ağacı (v37)

Excel'inde "Main Category" sütunu varsa (SmartScout tarzı dosyalarda genelde olur),
marka tablosunun üstünde artık bir **"🗂️ Kategori Ağacı"** bölümü var. Açtığında her
kategori için kaç marka olduğunu, toplam tahmini aylık ciroyu ve kaç tanesinin "fırsat"
(e-maili bulunmuş, henüz gönderilmemiş) olduğunu görürsün — kategoriler ciroya göre
büyükten küçüğe sıralanır. Bir kategoriye tıklayınca tablo o kategoriyle filtrelenir;
bu filtre üstteki durum sekmeleriyle (Bulunanlar/Gönderilmiş vb.) birlikte, ikisi de
aynı anda uygulanarak çalışır — ör. hem "Electronics" kategorisine hem "Bulunanlar"
sekmesine tıklarsan sadece o kategorideki bulunmuş markaları görürsün. Tekrar aynı
kategoriye tıklayınca filtre kalkar. Excel'inde kategori sütunu hiç yoksa bu bölüm
otomatik olarak gizlenir.

Ayrıca her marka satırının isim hücresinin altında, varsa küçük bir **"🏷️ Kategori ·
$X/ay"** etiketi görünür — hangi markanın hangi kategoride olduğunu tabloya bakarken
de tek bakışta ayırt edebilirsin.

## Yeni Yüklenen Sekmesi (v38)

Her Excel/CSV yüklemesi artık okunabilir bir isim ve zaman damgasıyla kaydediliyor.
Marka tablosunun üstünde **"🆕 Yeni Yüklenen"** sekmesi, SADECE en son yüklediğin
dosyadaki markaları gösterir — hangi Excel üzerinde çalıştığını (dosya adı, kaç
marka, ne zaman yüklendiği) hemen altındaki notta görürsün. Bir sonraki Excel'i
yüklediğinde bu sekme otomatik olarak yeni dosyaya geçer; önceki dosyanın markaları
ayrı bir işlem yapmana gerek kalmadan genel listenin (ve diğer durum sekmelerinin)
arasına karışmış olur — çünkü hepsi zaten aynı birleşik tabloda tutuluyor, sadece
"en son hangisiydi" bilgisini takip ediyoruz.

## İletişim Formu Olan Markalar Artık "Bulunamayanlar"da Görünmüyor (v38)

E-maili bulunamayıp sitesinde bir iletişim formu tespit edilen markalar eskiden hem
"Bulunamayanlar" hem "📩 İletişim Formu Olanlar" sekmesinde birden görünüyordu. Artık
sadece "İletişim Formu Olanlar" sekmesinde görünüyorlar — "Bulunamayanlar" gerçekten
hiçbir çözüm yolu (ne e-mail ne form) bulunamayan markalara ayrıldı.

## Seçilenler İçin Toplu Email Arama (v38)

Tek tek "Ara" butonuna basmak yerine, tablodan birden fazla markayı checkbox'la
işaretleyip **"Seçilenler için Email Ara"** butonuna basarak hepsi için sırayla
(art arda çok hızlı istek atmadan, aralarına kısa bir bekleme koyarak) email arama
başlatabilirsin — ilerleme durumu ("3/12" gibi) butonun yanında görünür. Özellikle
"Bulunamayanlar" ya da "🆕 Yeni Yüklenen" sekmesinden birkaçını seçip sadece onları
tekrar aratmak istediğinde kullanışlı.

## Sayfalandırma ve Satır Numarası (v38)

Marka tablosu artık tüm listeyi tek seferde basmak yerine sayfalara bölünüyor —
tablonun üstünden **sayfa başına 20/50/100 ya da Tümü** seçebilir, "‹ Önceki" /
"Sonraki ›" ile gezinebilir, "X-Y / Z marka" göstergesinden nerede olduğunu
görebilirsin. Her satırın en solunda, o an uygulanan filtre/kategoriye göre
sıralı bir **# numarası** var (sayfalar arasında devam eder — ör. sayfa 2'nin ilk
satırı sayfa boyutu 20 ise 21 numaralıdır). Bir durum sekmesine ya da kategoriye
tıkladığında sayfa otomatik olarak 1'e döner.

## Yeniden Tasarlanan Sol Menü (v39)

Sol menü artık her sayfa için ikon + kalın başlık + kısa açıklama satırı gösteriyor
("OPERASYON" başlığı altında): **Dashboard** (Günün özeti & odağı, eski "Özet"),
**Marka Keşif** (Liste yükle & e-posta bul, eski "Panel"), **Mail Merkezi** (Gelen &
olumlu dönüşler, eski "Gönderim Takibi" — yanında toplam yanıt sayısını gösteren bir
rozet var). Sayfaların kendisi ve işlevleri değişmedi, sadece isimlendirme ve menü
görünümü daha açıklayıcı hale geldi. Menü hâlâ fare üzerine gelince açılan dar bir
şerit — küçük ekranlarda (mobil) üstte yatay bir çubuğa dönüşüyor.

## Sağ Üstte Gönderim/Arama İlerleme Kartı (v40)

Toplu gönderim ("Seçilenleri Gönder" / "Bulunan tüm e-maillere gönder") ya da toplu
email arama ("Seçilenler için Email Ara") başlattığında, ekranın sağ üstünde sabit
kalan küçük bir kart beliriyor — hangi markanın işlendiğini, ilerleme çubuğunu ve
"X/Y" sayacını gösteriyor. Sayfada aşağı kaydırsan bile bu kart yerinde kalır,
işlem bitince "✓ Tamamlandı" yazıp birkaç saniye sonra kendiliğinden kayboluyor.

## Amazon Mağaza Linki Butonu (v41)

Excel'inde "Storefront Url" sütunu varsa, o marka için Amazon mağaza sayfası
linki dolu demektir. Bu markaların satırında artık **"🛒 Amazon"** butonu görünür
— tıklayınca markanın Amazon'daki mağaza sayfasını yeni sekmede açar, linki elle
arayıp bulmana gerek kalmaz.

## Toplu Gönderim/Arama Artık Sayfa Değiştirince Durmuyor (v42)

Önceden "Seçilenleri Gönder", "Bulunan tüm e-maillere gönder" ve "Seçilenler
için Email Ara" tarayıcıda çalışan bir döngüyle yürütülüyordu — bu yüzden
gönderim ya da arama devam ederken Dashboard, Gönderim Takibi gibi başka bir
sayfaya geçtiğinde işlem yarıda kesiliyordu. Artık bu üç işlem de "Tüm markalar
için email ara" özelliğiyle aynı mantıkla **sunucuda arka planda** çalışıyor:
istek gönderilir gönderilmez kuyruk sunucuda başlıyor ve tarayıcıdan tamamen
bağımsız devam ediyor; panel sadece durumu birkaç saniyede bir sorup sağ üstteki
ilerleme kartını ve durum metnini güncelliyor. Başka bir sayfaya geçip geri
döndüğünde de devam eden işlemin ilerlemesi otomatik olarak tekrar görünür.
Ayrıca toplu gönderim için de arama özelliğindekine benzer bir **"Gönderimi
Durdur"** butonu eklendi (o anda gönderilmekte olan mail bitirilir, kalanlar
iptal edilir).

## "Yeni Yüklenen" İçinde Durum Alt-Sekmeleri (v43)

"🆕 Yeni Yüklenen" sekmesinin yanına, aynı en son Excel yüklemesindeki
markaları durumlarına göre ayıran 3 alt-sekme eklendi: **"🆕📤 Yeni
Gönderildi"** (bu yüklemeden mail gönderilmiş markalar), **"🆕📧 Yeni
Bulundu"** (e-maili bulunmuş ama henüz gönderilmemiş olanlar) ve **"🆕⏳ Yeni
Bekliyor"** (henüz hiç aranmamış olanlar). Böylece yeni yüklediğin bir Excel
üzerinde çalışırken hangi markalara zaten ulaştığını, hangilerinin gönderime
hazır olduğunu ve hangilerinin arama beklediğini tek bakışta ayırt
edebiliyorsun. İlgili durumda hiç marka yoksa o alt-sekme otomatik olarak
gizlenir.

## İlerleme Kartı Artık Her Sayfada Görünüyor + Seçilenler İçin Ayrı Durdur (v44)

Sağ üstteki ilerleme kartı (toplu gönderim/email arama) önceden sadece "Marka
Keşif" sayfasında görünüyordu — Dashboard ya da Gönderim Takibi'ne geçince
kaybolduğu için işlemin durup durmadığını anlamak zordu. Artık bu kart
**her üç sayfada da** (Marka Keşif, Dashboard, Gönderim Takibi) görünüyor ve
birkaç saniyede bir güncelleniyor; işlem sunucuda zaten arka planda çalıştığı
için, hangi sayfada olursan ol ilerlemeyi görebiliyorsun ve sayfa değiştirip
geri döndüğünde de kaldığı yerden devam ediyor (sıfırlanmıyor). Ayrıca
"Seçilenler için Email Ara" butonunun yanına ayrı bir **"Aramayı Durdur"**
butonu eklendi — artık toplu gönderimde olduğu gibi seçilen markalar için
başlattığın aramayı da istediğin an durdurabilirsin.

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
- **Spam tetikleyici kelime kontrolü genişletildi ve iki noktada çalışıyor**: hem şablonu
  kaydederken hem de **gerçekten göndermeye basarken** (böylece şablonu kaydettikten sonra
  elle değiştirip tekrar kaydetmeden gönderirsen de uyarı alırsın). Artık "free"/"ücretsiz"/
  "act now" gibi kelimelerin yanı sıra tek maildeki **link sayısını** (4+ link şüpheli
  sayılır) ve **link kısaltıcı** (bit.ly, tinyurl.com vb. — spam filtreleri bunlara özellikle
  dikkat eder) kullanımını da kontrol ediyor.
- **Gönderim ritmi artık rastgele (insan eliyle gönderiliyormuş gibi)**: hem toplu gönderimde
  ("Seçilenleri Gönder" / "Bulunan tüm e-maillere gönder") hem de otomatik takip
  maillerinde, art arda sabit/düzenli aralıklarla göndermek yerine mailler arasında
  rastgele 2-5 saniyelik bir bekleme uygulanıyor — tamamen düzenli aralıklarla giden
  mailler otomasyon gibi göründüğü için bazı spam filtrelerinde şüphe uyandırabiliyordu.

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
    routes/tracking.js     # Yanıt kontrolü + otomatik follow-up + haftalık özet + güvenlik freni
    routes/suppression.js  # Kalıcı "bir daha yazma" listesi API'si
    services/mailer.js     # Gmail App Password ile mail gönderme (nodemailer) + CAN-SPAM footer + ek dosya desteği
    services/emailFinder.js # Marka -> e-mail bulma mantığı (Amazon storefront + LinkedIn + WHOIS sinyalleri dahil)
    services/inboxChecker.js # Gmail IMAP ile yanıt kontrolü + basit sentiment tahmini
    services/suppression.js  # Kalıcı "bir daha yazma" listesi mantığı
    services/backup.js       # Haftalık veritabanı yedeği mail eki olarak gönderme
    services/dnsCheck.js     # SPF/DKIM/DMARC canlı DNS doğrulaması
    services/ai.js           # Anthropic Claude API çağrıları (model seçimi dahil)
  public/                 # Panel (index.html) + Gönderim Takibi (tracking.html)
  tests/                  # Kalıcı otomatik test seti (npm test ile çalışır)
  sample_brands.csv       # Test için örnek marka listesi
  .env.example
```
