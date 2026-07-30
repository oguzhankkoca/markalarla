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

## Kullanım

1. **Bilgilerin**: adın, şirketin, teklifin ve imzanı gir, "Kaydet"e bas (mail şablonu
   otomatik bunları kullanır).
2. **Marka listesi yükle**: Excel/CSV dosyanı seç, "Yükle"ye bas. Dosyada marka adlarının
   olduğu bir sütun olmalı (örn. "Marka" ya da "Brand"), istersen bir de website sütunu
   ekleyebilirsin — varsa arama adımını hızlandırır ve daha isabetli olur.
3. **E-mail bulma**: "Tüm markalar için email ara" butonuna bas. Bu işlem internetten
   arama yapıp markanın resmi sitesini bulmaya, sonra o sitedeki iletişim sayfalarını
   tarayıp e-mail çıkarmaya çalışır. Süre marka sayısına göre birkaç dakika sürebilir.
4. **Mail şablonu**: konu ve içerik yaz, `{{marka}}` yazdığın her yer gönderim sırasında
   otomatik marka adıyla değişir.
5. **Gönderim**: tabloda her marka satırında e-maili kontrol et/düzelt (otomatik bulma
   %100 garanti değildir), sonra tek tek "Gönder" ya da toplu "Bulunan tüm e-maillere
   gönder" butonunu kullan.

## Önemli sınırlamalar

- **E-mail bulma doğruluğu**: ücretsiz yöntem (arama + site tarama) her marka için sonuç
  bulamayabilir, bazen yanlış/genel bir e-mail bulabilir. Göndermeden önce mutlaka kontrol
  et. Daha isabetli sonuç için `.env`'e `SERPAPI_KEY` (serpapi.com) ya da `HUNTER_API_KEY`
  (hunter.io) eklenebilir — ikisinin de ücretsiz/deneme planı var.
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
    services/mailer.js     # Gmail App Password ile mail gönderme (nodemailer)
    services/emailFinder.js # Marka -> e-mail bulma mantığı
  public/                 # Tek sayfalık panel (HTML/CSS/JS)
  sample_brands.csv       # Test için örnek marka listesi
  .env.example
```
