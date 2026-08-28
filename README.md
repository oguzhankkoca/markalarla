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

## Bug Fix: Follow-up Aşamaları Doğru Gösterilmiyordu (v79)

Kullanıcı geri bildirimi: "2. 3. follow-up'ları doğru düzgün göstermiyor,
bazen ilkini de" — sistem follow-up'ları ne zaman/kime attığını net takip
edemiyordu.

**Kök neden (doğrulandı):** Veritabanında her follow-up aşaması için AYRI bir
tarih YOKTU — sadece TEK bir ortak `last_follow_up_at`/`follow_up_sent_at`
kolonu vardı. 2. follow-up gönderilince bu kolon o tarihle ÜZERİNE YAZILIYOR,
yani 1. follow-up'ın ne zaman gittiği bilgisi SİLİNMİŞ oluyordu — sayaç
(`follow_up_stage`) doğru ilerlese de "hangi tarihte" bilgisi kayboluyordu.
Panelde de bu veriden hiç yararlanılmıyordu; sadece belirsiz bir "2/3
gönderildi" sayacı vardı, hiçbir tarih gösterilmiyordu.

**Çözüm:**
- Her aşama için ayrı, ASLA üzerine yazılmayan kalıcı tarih kolonu:
  `followup1_sent_at`, `followup2_sent_at`, `followup3_sent_at`. Otomatik
  cron, tekli manuel gönderim ve toplu follow-up — üçü de AYNI kolonlara,
  sadece kendi aşamalarınınkine yazıyor.
- Takip Listesi'ndeki "Takip Aşaması" hücresi artık belirsiz bir sayaç değil,
  tam bir zaman çizelgesi: **📧 İlk Mail -> ✅ 1. Follow-up -> ✅ 2. Follow-up
  -> ⬜ 3. Follow-up**, her biri tarihi ve "X gün önce" bilgisiyle.
- Bir marka yeniden gönderildiğinde (resend/soğuk marka yeniden ısıtma),
  önceki döngüden kalma follow-up tarihleri de artık DOĞRU şekilde
  temizleniyor — eskiden sadece sayaç sıfırlanıyor, eski tarihler yeni
  döngüye "hayalet" olarak taşınabiliyordu.
- Geriye dönük uyumluluk: bu özellik eklenmeden ÖNCE gönderilmiş follow-up'lar
  için kesin tarih yok (kolonlar o zaman yoktu) — panel bu durumda "✅ N.
  Follow-up: gönderildi (eski kayıt — tarih bilgisi yok)" gösteriyor, ASLA
  "henüz atılmadı" gibi YANLIŞ bir bilgi vermiyor.
- Excel dışa aktarmaya (`/api/tracking/export`) da 3 yeni sütun eklendi: "1./2./3.
  Follow-up Tarihi".

25 senaryoluk testle doğrulandı (gerçek route kodu çalıştırılarak): sıralı
1->2->3 follow-up gönderiminde her aşamanın tarihinin BAĞIMSIZ kaydedildiği
ve sonraki aşamaların ÖNCEKİNİ SİLMEDİĞİ, takvim tamamlandıktan sonra 4.
denemenin reddedildiği, ilk maili yeniden gönderince follow-up tarihlerinin
doğru temizlendiği, toplu follow-up kuyruğunun da aynı doğru kolonlara
yazdığı, ve panel tarafında hem yeni-kayıt hem eski-kayıt (geriye dönük
uyumluluk) senaryolarının doğru metinle gösterildiği. Tam regresyon paketi
(12/12) değişmeden geçmeye devam ediyor.

## Bug Fix: Tek Markada Saatlerce Takılı Kalma (v78)

Kullanıcı geri bildirimi: sistem bazen (nadir bir ağ/DNS/AI API takılmasıyla)
tek bir markada saatlerce asılı kalıp, toplu e-mail arama ya da toplu Brand
Intelligence araştırması kuyruğundaki DİĞER markalara hiç geçemiyordu.

**Kök neden:** Her HTTP isteğinin kendi timeout'u olsa bile (10-20 saniye
aralığında), bir markanın araştırması ZİNCİRLEME birden fazla istekten
oluşuyor (aday domain dene -> AI ile doğrula -> wholesale sayfası dene ->
...) ve bunlar TEK bir `await` içinde art arda çalışıyordu. Kuyruk
döngüsü (`processFindAllQueue` / `processIntelQueue`) bu tek `await`i
bekleyip kalıyordu — üst sınır YOKTU.

**Çözüm:** Yeni `src/services/timeoutGuard.js` — `withResearchTimeout()`
fonksiyonu, bir markanın araştırma/arama işlemini 10 dakikalık bir üst
sınırla sarmalıyor (`Promise.race`). Bu sınıra şurada uygulandı:
- `processFindAllQueue` (toplu e-mail arama kuyruğu) — `findBrandEmail()`
- Tekli e-mail arama route'u (`POST /api/brands/:id/find-email`)
- `processIntelQueue` (toplu Brand Intelligence araştırma kuyruğu, Level 2/3/4)

10 dakika dolduğunda o marka **"bulunamadı/araştırılamadı" olarak
işaretlenip kuyruk otomatik olarak bir sonraki markaya geçiyor** — panel
artık saatlerce hiçbir ilerleme göstermeyen bir duruma düşmüyor. Zaman
aşımına uğrayan markanın hata mesajı (`last_error` / Brand
Intelligence'ta `research_error`) panelde görülebiliyor, böylece hangi
markanın atlandığı ve neden atlandığı belli oluyor.

**Bilinen sınırlama (bilerek kabul edildi):** JavaScript'te bir Promise'i
"gerçekten" iptal edip altındaki HTTP isteğini anında kesmenin garantili
bir yolu yok — zaman aşımına uğrayan iş arka planda teslim olmadan
çalışmaya devam edebilir ve daha sonra kendi kendine bitip sonucu
kaydedebilir (bu ZARARSIZ, hatta faydalı). Garanti edilen tek şey:
kuyruk döngüsü artık ASLA bir markada 10 dakikadan fazla tıkanıp kalmaz.

İki ayrı entegrasyon testiyle doğrulandı (gerçek route kodu çalıştırılarak,
`emailFinder`/`brandIntelligence` servisleri "sonsuza kadar cevap vermeyen"
bir marka simüle edecek şekilde stub'landı, timeout süresi teste özel
kısaltıldı): her iki senaryoda da (1) takılan marka doğru şekilde
hata/zaman-aşımı olarak işaretlendi, (2) kuyruk saniyeler içinde bir
sonraki markaya geçip onu da başarıyla işledi — TAKILMADI. `timeoutGuard.js`
ayrıca 7 birim testiyle (hızlı iş etkilenmiyor, yavaş iş doğru sürede zaman
aşımına uğruyor, normal hatalar timeout değilmiş gibi aynen fırlıyor) ayrı
doğrulandı. Tam regresyon paketi (12/12) değişmeden geçmeye devam ediyor.

## Manuel Marka Ekle Sayfası + Marka Silme (v77)

İki ayrı istek üzerine eklendi:

**1. Manuel Marka Ekle.** Sidebar'da yeni bir "✍️ Manuel Marka Ekle" menüsü
(`/manual.html`) — Excel yükleme/otomatik e-mail arama akışından TAMAMEN
BAĞIMSIZ, marka adını ve e-postasını doğrudan elle girip ekleyebildiğin bir
sistem. Marka adı+e-posta girip "Ekle ve Şablon Oluştur"a bastığında:
- Marka, ayrı bir listede (`source = 'manual'`) kaydedilir — Marka Listesi'nde
  (Excel'den gelenler) HİÇ görünmez, sadece bu sayfada tutulur.
- Ayarlar'daki ANA mail şablonu (Marka Listesi'nde kullanılan aynı
  `main_subject`/`main_body`) otomatik olarak `{{marka}}` yerine girdiğin
  marka adı konularak dolduruluyor ve düzenlenebilir bir önizleme penceresinde
  açılıyor — istersen orada değiştirip hemen gönderebilirsin, istersen
  "İptal" deyip tablodan sonra "Gönder" butonuyla yollarsın.
- Gönderim, sistemde ZATEN VAR OLAN `/api/brands/:id/send` route'unu kullanır
  — yani suppression listesi, DO_NOT_CONTACT, aynı e-postaya tekrar yazmama
  gibi TÜM güvenlik kontrolleri manuel eklenen markalara da AYNEN uygulanır,
  ayrı/daha zayıf bir "manuel gönderim" yolu icat edilmedi.

**2. Marka Silme.** Eskiden sistemde hiçbir silme yolu yoktu — yanlış eklenen
ya da artık ilgilenilmeyen bir marka sonsuza dek listede kalıyordu. Artık:
- Marka Listesi'nde her satırda ve Manuel Marka Ekle sayfasında her satırda
  "🗑 Sil" butonu var (güçlü bir onay penceresiyle).
- Marka Listesi'nin araç çubuğuna toplu "🗑 Seçilenleri Sil" butonu eklendi —
  işaretlediğin markaları tek seferde siler.
- Silme KALICIDIR: marka satırıyla birlikte gönderim geçmişi (send_log),
  görevler, Timeline olayları, evrak kayıtları (ve diskteki evrak dosyaları),
  Brand Intelligence araştırması da temizlenir — hiçbir yerde "hayalet" veri
  kalmaz.
- BİLEREK SİLİNMEYEN tek şey: kalıcı "bir daha yazma" (suppression) listesi.
  Bir marka silinip aynı e-posta ileride tekrar eklenirse (elle ya da yeni
  bir Excel'de), o adrese yine de mail gitmemesi gerekiyor — suppression bu
  yüzden marka silmeden tamamen bağımsız, kalıcı bir koruma katmanı.

26 senaryoluk bir testle doğrulandı: manuel ekleme validasyonu (boş isim/
e-posta, geçersiz e-posta formatı), manuel markanın Marka Listesi'nde
GÖRÜNMEMESİ, kendi sayfasında görünmesi, silme sonrası ilişkili TÜM
tabloların (send_log/tasks/brand_events/brand_documents/brand_intelligence)
temizlenmesi, suppression_list'in silme sırasında DOKUNULMADAN kalması, ve
en kritik olarak — manuel eklenen bir markaya gönderim yapılırken
DO_NOT_CONTACT/suppression gibi güvenlik kontrollerinin normal markalardaki
gibi ÇALIŞTIĞININ doğrulanması (uçtan uca: ekle -> gönder -> sil akışı).
Tam regresyon paketi (12/12) değişmeden geçmeye devam ediyor.

## AI Outreach Intelligence Entegrasyonu (v71)

Mevcut Brand Intelligence araştırmasının (Wholesale Research, Marketplace Policy,
Red Flag Engine, Amazon Listing Audit, Visual AI Analysis, Contact Intelligence)
sonuçları artık AI Personalization/Email Generation sistemine BAĞLANDI. AI artık
sadece "kişiselleştirilmiş bir email" yazmıyor — her marka için şu zinciri kuruyor:

```
MARKA PROBLEMİ -> BUSINESS OPPORTUNITY -> NEOFA'NIN GERÇEK DEĞERİ -> OUTREACH ANGLE -> PERSONALIZED EMAIL
```

**Yeni dosya: `src/services/outreachIntelligence.js`** — bu zinciri AI ÇAĞRISI
YAPMADAN (ücretsiz, deterministik), zaten araştırılmış/doğrulanmış verilerden
kurar. Hiçbir alan UNKNOWN/UNCLEAR ise bir bulgu/problem ÜRETMEZ. 5 angle'dan
(Wholesale Partnership, Amazon Growth Opportunity, Listing/Content Opportunity,
Controlled Reseller, Long-Term Retail Partnership) kanıta dayalı olanı/olanları
önerir — email üretme adımındaki AI SADECE bu önerilen adaylar arasından seçim
yapabilir, yeni bir angle uyduramaz.

**`src/routes/aiFeatures.js` — `personalizeBrand()` yeniden yazıldı:**
- Marka `DO_NOT_CONTACT` durumundaysa (marketplace politikası/red flag Amazon
  satışını yasaklıyorsa) email HİÇ ÜRETİLMEZ, AI çağrısı bile yapılmaz.
- Email artık 5 parçalı yapıda (gerçek bir iletişime geçme sebebi, TEK doğrulanmış
  gözlem, fırsat, Neofa'nın sağlayabileceği şey, düşük sürtünmeli CTA) ve amacı
  "hemen satış" değil "yanıt almak/wholesale konuşması başlatmak".
- En fazla 1-2 doğrulanmış bulgu kullanılır (10 maddelik problem listesi YOK).
- Mini-audit teklifi SADECE doğrulanmış güçlü bulgu + yüksek accessibility notu
  varsa yapılır.
- Amazon'dan bahsetme politikası marketplace policy'ye göre otomatik ayarlanır:
  ALLOWED->açık konuşulabilir, UNCLEAR->wholesale/online-retail çerçevesi
  (Amazon öne çıkarılmaz), PROHIBITED->zaten DO_NOT_CONTACT ile hiç email
  üretilmez.
- Neofa'nın SADECE gerçekten sunduğu yeteneklerden (Level 3 prompt'uyla AYNI,
  tek kaynak liste) bahsedilir; garanti/abartılı büyüme vaadi YASAK.
- **Deterministik guardrail** (`runEmailGuardrails`): AI'nın kendi öz-
  değerlendirmesine güvenilmiyor — kod seviyesinde yasaklı ifade (guarantee,
  dramatically increase, double your sales, doğrudan aşağılama vb.), >2 bulgu,
  Amazon mention politikası ihlali, marka adı eksikliği, yanlış kontak ismi gibi
  hard-fail kontrolleri yapılır. FAIL olursa 1 kez düzeltici prompt ile yeniden
  denenir; yine FAIL olursa email SESSİZCE gönderilmez, açık bir hata döner.
- Aynı `/api/brands/ai-personalize` uç noktası ve aynı `ai_personalized_intro`
  kolonu kullanılıyor (geriye dönük UYUMLU) — mevcut gönderim/CRM/follow-up
  akışları bu değişiklikten ETKİLENMEDİ (bu kolon zaten sadece manuel kopyala-
  yapıştır amaçlıydı, otomatik gönderime hiç karışmıyordu).

**Yeni: `GET /api/brands/:id/outreach-intelligence`** — AI çağrısı yapmayan,
ücretsiz bir uç nokta; UI'da "AI OUTREACH INTELLIGENCE" panelini besler (Marka
Detay -> AI sekmesi, mevcut email üretme butonunun ÜSTÜNDE): Primary Problem,
Business Opportunity, Neofa Value, Recommended Angle, Recommended CTA.

**`src/routes/tracking.js` — `buildFollowUpExtras()` güncellendi:** Day 15
follow-up'ı artık ilk email'de kullanılan AYNI zincire (aynı doğrulanmış bulgu,
aynı mini-audit uygunluk mantığı) referans veriyor — tutarsız bir iddia
üretmiyor. Mevcut 7/15/30 günlük cadence, şablonlar ve fallback davranışı
DEĞİŞMEDİ; hiçbir araştırma yapılmamış markalarda eskisi gibi jenerik kalıyor.

**Test (API anahtarı olmadan mümkün olan her şey gerçek kodla test edildi):**
44 otomatik test (12 mevcut regresyon test dosyası + 19 angle-seçimi testi + 15
guardrail testi + 5 route/entegrasyon testi + follow-up entegrasyon testleri),
hepsi PASS. Ayrıca önceki QA turunda araştırılan 9 gerçek markanın (Dr. Bronner's,
Liquid I.V., Native, Blueland, Owala, Drizzle Honey, Scented Designs, Mud Pie,
YETI) gerçek verileriyle zincir çıktıları doğrulandı: Liquid I.V. (Amazon
PROHIBITED) doğru şekilde DO_NOT_CONTACT ile email üretimini tamamen engelledi;
wholesale programı olan markalar doğru şekilde Wholesale Partnership angle'ına
yönlendirildi; hiçbir marka için uydurma bir bulgu/angle üretilmedi. Gerçek bir
ANTHROPIC_API_KEY ile canlı email üretimi test edilmedi (bu ortamda anahtar yok)
— rol-yapma yöntemiyle (gerçek prompt kurallarına harfiyen uyularak elle yazılan
örnek emailler) guardrail'den geçirildi, hepsi PASS etti.

## Follow-up "Vadesi Gelen" Filtreleri + Sayfalandırma (v76)

Takip Listesi'ne, hangi markaların hangi follow-up aşamasını beklediğini tek
tıkla gösteren üç yeni filtre sekmesi eklendi, artı 20 markalık numaralı
sayfalandırma:

**Üç yeni "vadesi gelen" sekmesi:**
- **⏰ 1. Follow-up Bekleyen (7+ gün):** ilk mail gönderileli 7+ gün olmuş,
  henüz hiç follow-up atılmamış markalar.
- **⏰ 2. Follow-up Bekleyen (14+ gün):** 1. follow-up ZATEN gönderilmiş ve
  üzerinden 14+ gün geçmiş markalar.
- **⏰ 3. Follow-up Bekleyen (30+ gün):** 2. follow-up ZATEN gönderilmiş ve
  üzerinden 30+ gün geçmiş markalar.

Bu üç kategori **sıra atlamaya karşı kilitli**: bir marka 2. sekmede
görünebilmesi için önce 1. follow-up'ının GERÇEKTEN gönderilmiş olması
gerekir — 1. follow-up'ı hiç atılmamış bir marka, ne kadar gün geçmiş olursa
olsun, 2. veya 3. sekmede ASLA görünmez (istenen davranış tam olarak buydu:
"ilk follow-up atılmayanlar bu kısıma geçemesin"). Eşikler mevcut 7/14/30
günlük follow-up takvimiyle (`FOLLOW_UP_SCHEDULE`) birebir aynı, panelde
zaten kullanılan "7. gün / 14. gün / 30. gün" etiketleriyle tutarlı.

**Sayfalandırma:** Takip Listesi tablosu artık tek seferde tüm markaları
render etmiyor — her sayfada 20 marka, altta numaralı sayfa butonları
(‹ Önceki, 1, 2, 3, 4... Sonraki). Çok sayfa varsa aradaki numaralar "..."
ile kısaltılır, ilk/son sayfa ve aktif sayfanın komşuları her zaman görünür.
Bir filtre sekmesine tıklandığında sayfa otomatik 1'e döner; checkbox işaretleme,
not/aşama güncelleme gibi küçük işlemler ise mevcut sayfa numarasını değiştirmez.

16 senaryoluk saf-mantık testiyle doğrulandı: aşama-kilitleme (stage 0 bir
markanın 2./3. sekmede hiç görünmemesi), gün eşiği sınırları, bounce/DNC/
olumlu-yanıt dışlama, olumsuz-yanıtta dahil etme davranışı — hepsi PASS.
Sayfalandırma matematiği (dilimleme, sınır aşımı, tek/tam sayfa, "..." mantığı)
9 ayrı senaryoda ayrıca doğrulandı. Tam regresyon paketi (12/12) değişmeden
geçmeye devam ediyor.

## Toplu Follow-up Gönderimi + Bounce Ayrımı (v75)

İki istek üzerine v73'teki tekli manuel follow-up özelliği genişletildi:

**1. Toplu follow-up gönderimi.** Artık Takip Listesi'nde birden fazla markayı
seçip (checkbox) tek seferde follow-up gönderebilirsin. Backend'de
`POST /api/tracking/send-followup-batch` — tıpkı ana Marka Listesi'ndeki toplu
gönderim (`/api/brands/send-batch`) gibi arka planda bir kuyrukla çalışır,
istek hemen döner, gerçek gönderim gönderimler arası rastgele 2-5 saniye
bekleyerek (spam görünümünü azaltmak için) arka planda devam eder. İlerleme,
sayfanın neresinde olursan ol görünen aynı ilerleme kartıyla (`jobStatusToast.js`)
takip edilir. `POST /api/tracking/send-followup-batch/stop` ile yarıda
durdurulabilir, `GET .../status` ile durumu (kaç gönderildi/atlandı, hangi
marka işleniyor, atlananların nedeni) sorgulanabilir.

Hem tekli hem toplu route artık AYNI paylaşılan fonksiyonu (`sendFollowUpForBrand`)
kullanıyor — iki yerde farklı/tutarsız bir kural riski yok.

**2. "İlk mail ulaşmadıysa ikincisi nasıl ulaşsın" ayrımı.** Kullanıcı haklı
olarak, ilk maili geri dönen (bounce) markalara follow-up göndermenin anlamsız
olduğunu belirtti. Bu KOD SEVİYESİNDE zaten engelliydi (`brand.bounced` kontrolü),
ama bunu UI'da da AÇIKÇA ayırmak için:
- Yeni bir filtre sekmesi: **"✉️ Follow-up'a Uygun"** — SADECE ilk maili gerçekten
  almış (bounce olmamış), DO_NOT_CONTACT olmayan, olumlu/nötr yanıt vermemiş ve
  3 aşaması tamamlanmamış markaları gösterir. Bounce olan markalar bu sekmede
  HİÇ görünmez (zaten ayrı "Ulaşmayanlar" kartında listeleniyorlar).
- Takip Aşaması hücresinde, bounce olan markalar için follow-up butonu yerine
  açıkça **"📪 İlk mail ulaşmadı"** yazısı gösteriliyor.
- Checkbox'lar sadece gerçekten uygun markalarda aktif — bounce/DNC/tamamlanmış/
  olumlu-yanıt-almış markalarda checkbox devre dışı, toplu seçime hiç girmiyor.

**Bug fix (test sırasında bulundu):** `status='bounced'` olan markalar eskiden
"henüz ilk email gönderilmemiş" gibi yanlış/yanıltıcı bir hata mesajı alıyordu
(kontrol sırası yanlıştı — sadece `status==='sent'` aranıyordu). Artık `bounced`
durumu doğru, kendi mesajıyla ayrı olarak tanınıyor.

27 senaryoluk bir test setiyle doğrulandı (tekli: 13, toplu: 14) — gerçek route
kodu çalıştırılarak: normal aşama ilerlemesi, DNC/suppressed/bounce/olumlu-yanıt
engelleme, olumsuz-yanıtta izin verme, aynı anda ikinci bir toplu gönderimin
engellenmesi, durdur, boş seçim hatası, ve DB güncellemelerinin doğruluğu.
Tam regresyon paketi (12/12) değişmeden geçmeye devam ediyor.

## Bug Fix: İletişim Formu'na Kopyalanan Mail Metni Birbirine Giriyordu (v74)

Email adresi bulunamayıp "İletişim Formu" linkine yönlendirilen markalarda, "Form
Aç" butonu mail metnini panoya (clipboard) da kopyalıyordu — ama kopyalanan metin
gerçekte gönderilen mail gibi görünmüyordu, paragraflar/liste maddeleri birbirine
girmiş, tek bir satırda karışık şekilde geliyordu.

**Kök neden:** Panoya kopyalama, zengin metin editöründeki HTML'i düz metne
çevirirken (`richTextToPlain`, `public/js/app.js` + `public/js/tracking.js`)
`tmp.textContent`/`innerText` kullanıyordu — bu, `<p>`, `<div>`, `<br>`, `<li>`
gibi blok etiketleri arasına HİÇBİR satır sonu eklemez, bu yüzden `<p>A</p><p>B</p>`
gibi bir HTML "AB" olarak birleşiyordu. Bu arada GERÇEK mail gönderiminde
(`src/services/mailer.js` -> `htmlToPlainText`) tamamen farklı, doğru satır sonu
üreten bir dönüştürücü kullanılıyordu — yani iki yerde tutarsız iki farklı
dönüşüm vardı.

**Düzeltme:** `richTextToPlain`, mail gönderiminde zaten kullanılan AYNI
etiket-bazlı dönüşüm mantığıyla (`<br>`→satır sonu, `</p>`→çift satır sonu,
`<li>`→"- " madde işareti vb.) değiştirildi — artık panoya kopyalanan metin,
gerçekte gönderilecek mailin göründüğü gibi, doğru paragraf/madde ayrımıyla
geliyor. Test edildi: paragraf+liste+satır-sonu içeren örnek bir HTML ile
girdi/çıktı karşılaştırıldı, çıktı beklenen düz metinle birebir eşleşti.

## Manuel Follow-up Gönderimi (v73)

Şimdiye kadar 7/15/30 günlük follow-up dizisi SADECE otomatik cron ile (her gün
08:00'de `runFullCheck`) çalışıyordu — geri dönmeyen bir markaya "hemen şimdi"
follow-up atmak için hiçbir buton/uç nokta yoktu. Eklendi:

- **Backend:** `POST /api/tracking/:id/send-followup` (`src/routes/tracking.js`).
  Markanın `follow_up_stage`'ine bakıp bir SONRAKİ aşamayı (1/2/3) hemen gönderir
  — otomatik cron'un kullandığı AYNI şablonları (`getFollowUpTemplate`), AYNI
  Brand Intelligence bulgu enjeksiyonunu (`buildFollowUpExtras`, sadece 2.
  aşamada) ve AYNI güvenlik kontrollerini kullanır: DO_NOT_CONTACT ise engellenir,
  kalıcı "bir daha yazma" listesindeyse engellenir, mail daha önce geri döndüyse
  (bounce) engellenir, marka olumlu/nötr yanıt verdiyse engellenir (olumsuz yanıt
  verenlere otomatik sistem de follow-up'a devam ettiği için o durumda İZİN
  VERİLİR), ilk mail hiç gönderilmediyse ya da 3 aşama zaten tamamlandıysa
  engellenir. Her gönderim `send_log`'a "ELLE gönderildi" notuyla düşer — otomatik
  gönderimlerden ayırt edilebilir.
- **Frontend:** Takip Listesi tablosunda ("Gönderim Takibi" sayfası) her satırın
  "Takip Aşaması" hücresine, uygunsa `✉️ N. Aşama Follow-up Gönder` butonu
  eklendi; DO_NOT_CONTACT ise "🚫 Follow-up Engelli" (devre dışı, nedeni tooltip'te),
  3 aşama tamamlandıysa "3 aşama tamamlandı" yazısı gösterilir. Tıklanınca hangi
  aşamanın (kısa hatırlatma / değer odaklı takip / kapanış) gönderileceğini
  onay penceresinde gösterir.

19 senaryoluk bir test setiyle doğrulandı (gerçek route kodu çalıştırılarak):
normal aşama ilerlemesi (1→2→3, 4.'te engellenir), DO_NOT_CONTACT/suppressed/
bounce/olumlu-yanıt engelleme, olumsuz-yanıtta yine de izin verme, email yok/ilk
mail gönderilmemiş/marka bulunamadı hata durumları, ve `send_log` kaydı — 19/19
geçti. Tam regresyon paketi (12/12) değişmeden geçmeye devam ediyor.

## Outreach Quality Test ve Halüsinasyon Guardrail Fix'i (v72)

v71'in Brand Intelligence → Outreach Intelligence → AI Email zincirinin
gerçekten kaliteli/güvenli email ürettiğini doğrulamak için ayrı bir "Outreach
Quality Test" turu yapıldı: 22 marka (9 gerçek marka + açıkça "TestCo ..."
etiketli 13 sentetik test fixture'ı, 4 angle kategorisinden 5'er örnek + bonus
DO_NOT_CONTACT/distributor-route örneği) için `outreachIntelligence.js`'in
GERÇEK kodu çalıştırıldı, `buildEmailPrompt`'un GERÇEK kurallarına harfiyen
uyularak 21 email yazıldı, ve hepsi `runEmailGuardrails`'in GERÇEK kodundan
geçirildi (hiçbiri elle "geçti" olarak işaretlenmedi).

**Bulunan ve düzeltilen tek kritik açık:** Guardrail'in "no unsupported claim"
kontrolü sadece dar bir overselling kelime listesine bakıyordu — 8 kategorilik
bir halüsinasyon stres testinde (uydurma rakam, uydurma Amazon performansı,
uydurma satış rakamı, chain'in önermediği bir "bulgu", NEOFA_CAPABILITIES dışı
hizmet vaadi, mutlak "we always comply" güvencesi, uydurma "zaten yetkili
satıcıyız" iddiası, uydurma "geçen görüşmemizde" referansı) **8 senaryonun 8'i
de guardrail'den sızdı**. Yeni özellik eklenmedi — mevcut `runEmailGuardrails`
fonksiyonu (`src/routes/aiFeatures.js`) genişletildi:

- Uydurma rakam/yüzde tespiti (chain hiçbir zaman satış/performans rakamı
  üretmez → metinde `$` tutarı ya da performansla ilişkili `%` görülmesi KESİN
  uydurmadır)
- `findings_used` artık SADECE SAYI değil, İÇERİK olarak da doğrulanıyor — AI,
  chain'in önermediği bir "bulgu" yazıp bunu kullanırsa artık FAIL olur (en
  kritik açık buydu)
- Uydurma yetkilendirme/önceki temas/mutlak uyum güvencesi/kapsam dışı hizmet
  vaadi için yeni banned-phrase kalıpları

Fix sonrası: **8/8 halüsinasyon senaryosu doğru şekilde bloklanıyor**, 21
meşru/gerçek email'in **hiçbirinde yanlış pozitif oluşmadı**, ve 12/12'lik tam
regresyon paketi değişmeden geçmeye devam ediyor. CASE A/B testi (güçlü
opportunity var vs. hiç sinyal yok) de doğrulandı: sinyal yokken AI uydurma bir
problem üretmiyor, "Would you be open to a wholesale relationship?" tarzı basit
bir fallback'e düşüyor. Detaylı, madde madde rapor (email quality score,
best/worst 5 email, Amazon mention policy testi, follow-up 7/15/30 farklılık
testi dahil) `V71_OUTREACH_QA_REPORT.md` dosyasında.

## QA / Gerçek Dünya Test Turu ve Bug Fix'leri (v70)

v69'un 33 maddelik özelliğin %100 tamamlandığı iddiasını doğrulamak için ayrı bir
QA/test oturumu yapıldı: gerçek markalar (Dr. Bronner's, Liquid I.V., Native,
Blueland, Owala, Drizzle Honey, Scented Designs Candle Co., Mud Pie, YETI) için
gerçek web araştırması yapıldı, bu gerçek içerik brandIntelligence.js'teki GERÇEK
prompt metnine elle uygulandı (AI rol-yapma, "kanıt yoksa UNKNOWN" kuralına
harfiyen uyularak), ve sonuç JSON'lar brandAccessibilityScore.js/
computeActionBadge/buildContactList'in GERÇEK, değiştirilmemiş kodundan geçirildi.
Bu süreçte code review ile 6 gerçek bug bulundu ve düzeltildi (yeni özellik
EKLENMEDİ, sadece mevcut kod düzeltildi):

1. **Score reasoning yoktu** — Brand Accessibility Score'un 9 bileşeni sadece çıplak
   sayı döndürüyordu, "neden bu puan" görünmüyordu. Artık her bileşen
   `{score, reason}` döndürüyor (`brandAccessibilityScore.js`).
2. **computeActionBadge'in DO_NOT_CONTACT regex'i kırıktı** — v69'un kendi Red Flag
   Engine'i flag isimlerini `UPPERCASE_SNAKE_CASE` (örn. `AMAZON_PROHIBITED`) olarak
   üretiyordu ama badge regex'i boşluklu metin bekliyordu, hiç eşleşmiyordu. Düzeltildi.
3. **PHONE_FIRST rozeti hiç üretilmiyordu** — 5 rozetten biri (sadece telefon var,
   e-mail yoksa) kodda hiç yoktu. Eklendi (mantık + UI).
4. **Level 4, Level 2/3'ü zorunlu kılmıyordu** — kodun kendi yorumu "assumes level3
   was done previously but doesn't enforce it" diyordu; bu tam olarak "seviyeler
   doğru sırada mı çalışıyor" testinin yakalaması gereken bir hataydı. Düzeltildi
   (Level 3'ün yaptığı gibi otomatik cascade eklendi).
5. **Listing Audit "yok" ile "görülemedi"yi ayıramıyordu** — düz metin çıkarma
   (cheerio) görsel/video/A+ Content gibi öğeleri hiç görmüyor, ama prompt bunu
   AI'a açıklamıyordu. Artık prompt'a açık uyarı eklendi + UI'da `presenceLabel()`
   ile "X bulunamadı" / "X doğrulanamadı" ayrımı net.
6. **API timeout/429/5xx'te hiç retry yoktu** — tek seferde pes ediliyordu. 800ms
   bekleme sonrası TEK bir yeniden deneme eklendi (sadece geçici hata sınıflarında).

Bu QA turunda AYRICA doğrulandı (gerçek kod çalıştırılarak): research cache/staleness,
Level 2→3→4 sırası, bulk research durdur/devam et, bir markadaki hatanın batch'in
kalanını durdurmadığı, SmartScout verisinin (avg_sellers/dominant_seller/
opportunity_score/est_monthly_revenue) brandIntelligence.js tarafından SADECE
okunduğu (hiçbir zaman yazılmadığı — sadece `brand_intelligence` tablosuna yazılıyor),
ve kontak listesinin (Hunter.io + şirket kanalları + founder) UNKNOWN alanları asla
listeye eklemediği, 11 kademeli unvan sıralamasının doğru çalıştığı. Detaylı QA
raporu ayrı bir dosyada teslim edildi (bkz. teslim edilen QA raporu).

## Brand Intelligence — Tam Kapsamlı Genişletme (v69)

v68'de kurulan Brand Intelligence mimarisi (şema, research pipeline, skorlama,
UI) bu sürümde tüm alt sistemleriyle eksiksiz hale getirildi — hiçbir yeni
sayfa/mimari değişikliği yok, sadece mevcut katmanların içi dolduruldu:

- **Wholesale Research** artık MOQ, açılış/yeniden sipariş minimumu, ödeme
  koşulları (Net 30 vb.), wholesale başvuru/portal URL'si, dealer/reseller/
  retailer program bayraklarını da (bulunabildiğinde, kaynağıyla birlikte)
  yakalıyor.
- **Marketplace Policy** artık online/3. parti pazaryeri izinleri, MAP
  politikası, reseller/dealer/marketplace anlaşmaları ve marketplace
  kısıtlamalarını da kapsıyor — hepsi kanıtsızsa `UNKNOWN`.
- **Red Flag Engine** artık iki kaynaktan besleniyor: (1) AI'ın sayfa
  içeriğinden sistematik olarak kontrol ettiği isimli bir checklist (Amazon/
  marketplace yasağı, münhasır distribütör, MAP riski, kapalı marka vb.), (2)
  SmartScout'un KENDİ sayısal alanlarından (yeniden tahmin YOK) kural bazlı,
  AI'sız türetilen flag'ler (çok fazla satıcı, Amazon Retail baskınlığı, çok
  yüksek MOQ, wholesale programı yok, doğrulanamamış distribütör).
- **Amazon Listing Audit** tam granüler hale geldi: title uzunluğu, bullet
  point tamlığı, açıklama kalitesi, anahtar kelime optimizasyonu, varyasyon
  varlığı, Brand Store KALİTESİ (sadece varlığı değil), yorum temaları, mobil
  okunabilirlik — hepsi kanıt yoksa `UNKNOWN`.
- **Visual AI Analysis** genişletildi: arka plan temizliği, ürün görünürlüğü,
  ambalaj sunumu, görsel üzeri metin okunabilirliği, rekabete göre görsel
  kalite. Sistem sadece TEK bir ana görsele erişebildiği için, "kaç görsel var/
  lifestyle görseli var mı" gibi sorular açıkça "UNKNOWN (sadece ana görsel
  erişilebilir)" olarak işaretleniyor — asla görmediği görseller hakkında
  tahmin yürütmüyor.
- **Contact Intelligence**: Hunter.io'nun döndürdüğü isim/unvan/departman
  bilgisi artık yakalanıp `brands.hunter_raw_contacts`'a kaydediliyor ve Marka
  Detay panelindeki kontak listesi tam olarak madde 16'daki 11 kademeli
  önceliğe göre sıralanıyor: Wholesale Manager → Sales Manager → National
  Accounts → E-commerce Manager → Marketplace Manager → Business Development →
  Founder/Owner → Sales (kişi) → wholesale@ → sales@ → info@. Mevcut e-mail
  bulma/seçim mantığına (`cleanEmails`, Hunter güven skoru sıralaması) hiç
  dokunulmadı — bu sadece ek bir okuma katmanı.
- **Toplu (kademeli) araştırma artık panelden tek tık uzakta**: Marka Listesi
  sayfasına yeni bir "🧠 Brand Intelligence — Toplu Araştırma" kartı eklendi
  (Level 2/3/4 seçimi, seçilenler ya da "en değerli N marka" için başlatma,
  Durdur/Devam Et, ilerleme çubuğu). Tıpkı "Tüm markalar için email ara" gibi
  sunucu tarafında arka planda çalışır — sayfa değiştirsen/tarayıcıyı kapatsan
  bile iş durmaz.
- **Araştırma önbelleği artık ayarlanabilir**: Ayarlar sayfasında yeni bir
  "Brand Intelligence — Araştırma Önbelleği" kartı ile 30-60 gün aralığında
  (varsayılan 45) STALE eşiği değiştirilebiliyor.

**Mevcut sistemlere etkisi:** Sıfır. Tüm değişiklikler additive (yeni DB
kolonları `ensureColumn` ile, yeni JSON alanları mevcut objelere spread ile
eklendi) — email bulma, gönderim, follow-up cadence'i (7/14/30 gün), CRM
Pipeline, Timeline, Görevler, Evraklar, warm-up, günlük limit, SPF/DKIM/DMARC,
kara liste, wholesale form otomasyonu davranışları birebir aynı kaldı. Bunu
doğrulamak için mevcut 12 otomatik test dosyası + yeni bir uçtan uca simülasyon
(Level 2 → 3 → 4 zinciri, red flag birleştirme, kontak önceliklendirme) çalıştırıldı,
hepsi geçti.

## Brand Intelligence + Growth Audit (v68)

SmartScout'tan gelen veriler ("Bu marka Amazon'da iyi bir fırsat mı?") hâlâ tek
source-of-truth — hiçbir SmartScout kolonu AI ile yeniden tahmin edilmiyor. Bunun
üzerine, "Bu marka Neofa ile çalışır mı, markaya nasıl yaklaşmalıyız?" sorusunu
cevaplayan yepyeni bir araştırma katmanı eklendi. Marka Detay panelinde yeni bir
**🧠 Brand Intelligence** sekmesi var:

- **Company / Wholesale / Marketplace Policy / Distributor** araştırması —
  markanın kendi web sitesi ve public kaynaklarından (arama motorları), her bulgu
  kaynak linkiyle birlikte. Kanıt yoksa her zaman `UNKNOWN` yazar, asla tahmin
  yürütmez (ör. Amazon izni kanıtsızsa "ALLOWED" değil "UNCLEAR" yazar).
- **Brand Accessibility Score** (0-100, A+ ila D) — SmartScout Opportunity
  Score'dan tamamen ayrı, 9 bileşenli (Wholesale, Marketplace İzni, Contactability,
  Direct Brand, Distributor, Brand Fit, MOQ, Openness, Red Flag Risk) bir skor.
  **Neofa Priority** ikisinin (SmartScout + Accessibility) ortalamasıdır.
- **Red Flag Engine**, **Top 3 Growth Opportunity** (Amazon listing/görsel
  denetimi dahil — erişilemeyen görseller için "IMAGE AUDIT UNAVAILABLE" yazar,
  uydurmaz), **What Neofa Can Offer**, **Outreach Strategy** ve **Next Best
  Action** önerileri.
- Panelin en üstünde tek bakışta: 🟢 CONTACT NOW / 🟡 RESEARCH MORE / 🔵
  DISTRIBUTOR ROUTE / 🔴 DO NOT CONTACT.
- **Amazon Authorization Tracking**: Wholesale onayı, LOA, Authorized Reseller,
  Amazon Approval/Gating — bunlar AI tahmini DEĞİL, senin elle işaretlediğin
  gerçek durumlar (biri diğeri anlamına gelmez, kasıtlı olarak ayrı tutulur).

**Kademeli araştırma (maliyet kontrolü):** Level 2 (hızlı tarama, ucuz) → Level 3
(derin araştırma, sadece yüksek potansiyelli markalar) → Level 4 (Amazon listing/
görsel denetimi, en pahalı seviye — sadece en yüksek potansiyellilerde). Marka
Detay panelinden tek tek, ya da Marka Listesi sayfasındaki "🧠 Brand Intelligence
— Toplu Araştırma" kartından (v69) toplu olarak tetiklenebilir. Aynı marka
Ayarlar'dan belirlenen süreden (varsayılan 45, 30-60 gün aralığında ayarlanabilir,
v69) daha yeni araştırıldıysa tekrar araştırılmaz (STALE olmadıkça) — gereksiz
AI/arama maliyetinden kaçınmak için.

**Mevcut sistemlere etkisi:** Excel/CSV yükleme, e-mail bulma, gönderim, follow-up
(7/14/30 gün — cadence değişmedi), CRM Pipeline, Timeline, Görevler, Evraklar,
warm-up, günlük limit, SPF/DKIM/DMARC, kara liste, wholesale form otomasyonu
AYNEN çalışmaya devam ediyor. Sadece iki küçük ek: (1) AI kişiselleştirme artık
varsa 1-2 doğrulanmış Brand Intelligence bulgusunu doğal şekilde kullanabiliyor,
(2) 14. gün follow-up'ı artık (varsa) gerçek bir değer önerisi/mini-audit teklifi
içerebiliyor — hiçbir bulgu yoksa mesaj eskisi gibi jenerik kalıyor.

Dashboard'a yeni bir **🎯 Growth Metrics** kartı eklendi (gönderilen mail, yanıt,
olumlu yanıt, wholesale başvurusu, onaylanan marka, ilk sipariş sayısı/toplam
değeri) — karmaşık bir tahmin sistemi değil, sadece ham sayaçlar.

## Panel Sayfaları (v67)

Eskiden "Marka Keşif" tek sayfada 8 farklı kartı (profil, DNS, kara liste, Excel
yükleme, e-mail bulma, mail şablonu, günlük limit/warmup, dev marka tablosu) üst
üste barındırıyordu. Artık sidebar'da 7 ayrı, odaklı sayfa var:

- **📊 Dashboard** — günün özeti (analytics.html)
- **📋 Marka Listesi** — ana çalışma alanı: filtreler, kategori ağacı, marka tablosu, gönderim
- **📤 Yeni Marka Ekle** — Excel/CSV yükleme + toplu e-mail bulma
- **✉️ Mail Şablonu** — konu/içerik editörü
- **🧭 CRM Pipeline** — aşama bazlı görünüm + aşama düzenleme, kendi sayfasında
- **📬 Mail Merkezi** — yanıt takibi (tracking.html)
- **⚙️ Ayarlar** — profil, DNS kontrolü, günlük limit/warmup, kara liste (sidebar'da ayrı "Yönetim" grubunda)

Marka Listesi, Yeni Marka Ekle, Mail Şablonu, CRM Pipeline ve Ayarlar aynı
`index.html` dosyası içinde URL'nin sonundaki `#marka-listesi`, `#marka-ekle` gibi
bir "hash" ile birbirinden ayrılıyor — sidebar'daki linke tıklayınca sayfa yeniden
yüklenmeden ilgili bölüm açılıyor. Tüm butonlar/alanlar tam olarak eskisiyle aynı
şekilde çalışmaya devam ediyor, sadece hangi kartın nerede göründüğü değişti.

## Kullanım

Soldaki menü artık ince, ikon-only bir şerit — üzerine fare götürünce genişleyip
etiketleri gösteriyor, ayrılınca tekrar daralıyor. Amaç sayfada markalar tablosuna
daha fazla yer açmak. Tablo da artık sabit sütun genişlikleriyle sayfaya sığacak
şekilde tasarlandı; "Seçilenleri Gönder" butonunun yanında kaç markanın checkbox'la
işaretlendiğini gösteren canlı bir "X marka seçili" sayacı var.

Aşağıdaki adım adım anlatım artık farklı sayfalara (Yeni Marka Ekle, Mail Şablonu,
Ayarlar, Marka Listesi) dağılmış durumda — hangi kartın hangi sayfada olduğunu
yukarıdaki "Panel Sayfaları" bölümünden görebilirsin, adımların kendisi değişmedi.

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

## Yanıt Eşleştirme Doğruluğu — Message-ID Thread Takibi (v66, bug fix)

**Düzeltilen sorun:** Aynı e-posta adresini/domain'i paylaşan birden fazla marka
kaydı olduğunda (ör. aynı gerçek şirketin Amazon'da birkaç farklı marka adıyla
satış yapması), gelen TEK bir yanıt eskiden HER markaya ayrı ayrı "olumlu yanıt
geldi" olarak işleniyor, ikisine de (birebir aynı metinle) bildirim maili
gönderiliyordu. Kullanıcı hangi markadan geldiğini anlayamıyordu.

**Çözüm:**
- Artık her giden mailin **Message-ID**'si kaydediliyor (`brands.sent_message_id`).
  Gelen bir yanıt önce bu Message-ID'ye **In-Reply-To/References** başlığıyla
  thread'lenip thread'lenmediğine bakılarak eşleştiriliyor — bu, aynı adrese/domain'e
  birden fazla mail gitse bile HANGİ spesifik mailin yanıtlandığını kesin olarak
  belirler ve en güvenilir eşleştirme yöntemidir.
- Thread başlığı yoksa (bazı mail istemcileri bunu korumaz) sistem eskisi gibi
  adres/domain eşleşmesine düşer, ama artık aynı çalıştırma içinde **aynı fiziksel
  mesajın** başka bir markaya da "kesin yanıt" olarak atanmasını engelleyen bir
  çakışma kontrolü var. Böyle bir çakışma tespit edilirse o marka için bildirim
  MAİLİ GÖNDERİLMEZ, sentiment/CRM güncellenmez — bunun yerine markanın Notlar
  alanına `[Otomatik uyarı] ...` diye başlayan görünür bir not eklenir ve elle
  kontrol için işaretlenir.
- **Gönderim Takibi** sayfasında bu artık açıkça görünür: paylaşılan e-posta/domain
  şüphesi olan satırlarda sarı bir "⚠️ Paylaşılan e-posta/domain — belirsiz eşleşme,
  kontrol et" etiketi ve gelen yanıtın gerçek "Gönderen" adresi gösterilir.

**Not:** Bu düzeltme, geçmişte (v66'dan önce) gönderilmiş mailler için Message-ID
kaydı tutmuyordu — o mailler için sistem otomatik olarak adres/domain eşleşmesine
(çakışma korumasıyla birlikte) düşer. v66'dan sonra gönderilen yeni mailler için
thread eşleştirmesi tam olarak devreye girer.

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

## Opportunity Score + CRM Pipeline (v45)

Bu, çok daha büyük bir yol haritasının (24 madde) ilk iki adımı — geri kalanı
sırayla, her biri test edilip paketlenerek gelecek versiyonlarda gelecek.

**Opportunity Score (0-100):** Her markanın satırında artık isim hücresinin
yanında 🎯 ile başlayan renkli bir puan görünüyor (yeşil ≥70 güçlü fırsat, sarı
40-69 orta, gri <40 düşük öncelik). Puan; Brand Score, tahmini aylık ciro,
yorum sayısı, kategori verisinin varlığı, web sitesi arama güveni (confidence)
ve Amazon'daki satıcı rekabetini birleştiren saf bir formülle hesaplanıyor —
**yapay zeka kullanmıyor**, bu yüzden tamamen ücretsiz ve otomatik: Excel
yüklendiğinde ve bir markanın e-maili bulunduğunda kendiliğinden hesaplanıp
güncelleniyor. Puanın üzerine gelince (hover) hangi bileşenden kaç puan
geldiğinin dökümünü görebilirsin.

**CRM Pipeline:** Marka satırlarındaki durum rozetinin altına, markayı elle bir
aşamaya taşıyabileceğin küçük bir açılır menü eklendi. Varsayılan 10 aşama:
Yeni Aday → E-mail Bulundu → Mail Gönderildi → Takip Ediliyor → Olumlu Yanıt →
Evrak İstendi → Başvuru Yapıldı → Onaylandı → İlk Sipariş → Tekrar Sipariş.
E-mail bulunduğunda, mail gönderildiğinde, olumlu yanıt geldiğinde ya da evrak
istendiğinde aşama **otomatik olarak ileri** taşınıyor (asla geriye almıyor) —
elle taşımak istersen açılır menüden istediğin aşamayı seçebilirsin. "🧭 CRM
Pipeline" panelinden (kategori ağacının hemen altında) her aşamada kaç marka
olduğunu görebilir, bir aşamaya tıklayarak tabloyu o aşamayla filtreleyebilir,
"✏️ Aşamaları Düzenle" ile aşamaları yeniden adlandırabilir/sıralayabilir/
ekleyip çıkarabilir ya da "Varsayılana Sıfırla" ile 10 aşamaya geri
dönebilirsin.

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

## v46: 20 yeni özellik (tek seferde eklendi)

Bu sürüm, önceden istenen 20 büyük özelliğin TAMAMINI tek seferde ekler. Mevcut sistemi
BOZMADAN, senkronize şekilde çalışacak şekilde tasarlandı — hiçbir özellik varsayılan
olarak zorunlu değildir, hepsi ya opt-in'dir ya da hiçbir şey yapılandırılmadığında eski
davranışı birebir korur.

- **Not/Görev/Hatırlatma sistemi**: her markaya tarihli görevler eklenebilir (Marka
  Detayı > Görevler sekmesi). Dashboard'daki "Bugün Yapılacaklar" paneli, tarihi geçmiş/
  bugüne denk gelen görevleri otomatik listeler.
- **Dashboard "Bugün Yapılacaklar" paneli**: Dashboard sayfasının en üstünde — bekleyen
  görevler, değerlendirilmemiş yanıtlar, belge isteyenler, yüksek öncelikli (AI) markalar,
  olası tekrar (duplicate) grupları ve otomatik gönderim durumunu tek yerde gösterir.
- **Gelişmiş fuzzy duplicate tespiti**: "Nike Inc.", "NIKE LLC", "Nike" gibi farklı
  yazımları (şirket eki, noktalama, küçük yazım farkı) tespit eder ve incelemen için
  ayrı bir grup olarak sunar (`/api/brands/fuzzy-duplicates`) — otomatik SİLMEZ, sen
  hangi kaydı tutacağına karar verirsin.
- **Wholesale/Distributor/Dealer sayfası otomatik tespiti**: e-mail bulma sırasında
  markanın sitesinde "become a dealer", "wholesale", "trade account" gibi sayfalar
  bulunursa link otomatik kaydedilir (Marka Detayı > Wholesale Form sekmesinde görünür).
- **Gelişmiş arama motoru**: Marka Keşif tablosunun üstünde artık marka adı, e-mail,
  website, kategori, ülke, not ve AI etiketleri dahil geniş bir arama kutusu var.
- **Gelişmiş filtreleme**: güven seviyesi, AI önceliği, wholesale sayfası varlığı ve
  minimum Opportunity Score gibi ek filtreler eklendi (mevcut durum/kategori/CRM
  filtreleriyle birlikte çalışır).
- **Gönderim öncesi spam/kalite skoru**: mail şablonu editörünün altında canlı güncellenen
  0-100 arası bir "Kalite Skoru" rozeti (spam kelimeleri, aşırı ünlem, kişiselleştirme
  eksikliği gibi faktörlere göre).
- **Marka bazlı Timeline**: Marka Detayı > Timeline sekmesi, o markayla ilgili TÜM
  geçmişi (gönderimler, aşama değişimleri, evrak yüklemeleri, yanıt/bounce) kronolojik
  sırada gösterir.
- **Evrak yönetim sistemi**: Marka Detayı > Evraklar sekmesinden Resale Certificate,
  W-9, EIN Letter, katalog gibi dosyalar marka bazında yüklenip indirilebilir/silinebilir.
- **AI kişiselleştirme / Lead Priority + etiketleme / yanıt sınıflandırma + taslak yanıt**
  (hepsi isteğe bağlı): Marka Detayı > AI Analiz sekmesinden tek tıkla çalıştırılır.
  Varsayılan olarak KAPALIDIR — sadece Ayarlar'da bir `ANTHROPIC_API_KEY` tanımlıysa ve
  sen butona bastığında çalışır, arka planda otomatik hiçbir şey yapmaz (gereksiz API
  maliyeti oluşturmaz).
- **Subject Rotation + A/B test motoru**: Ayarlar'da birden fazla konu satırı/gövde
  varyantı tanımlanabilir; toplu/otomatik gönderimlerde her seferinde rastgele biri
  seçilir, hangi varyantın kaç yanıt/olumlu yanıt aldığı Dashboard'daki grafikte
  karşılaştırılabilir. Hiç varyant tanımlanmazsa (varsayılan) eski davranış (tek sabit
  şablon) aynen devam eder. Ayrıca otomatik/toplu gönderimlere görünmez bir açılma
  (open) takip pikseli eklenir (sadece `PUBLIC_URL`/Render'ın `RENDER_EXTERNAL_URL`'i
  tanımlıysa).
- **Çoklu gönderici hesabı altyapısı (round robin)**: Ayarlar'da ek Gmail hesapları
  tanımlanabilir; gönderimler hesaplar arasında (o gün en az gönderen öncelikli olacak
  şekilde) dağıtılır. Hiç ek hesap eklenmezse (varsayılan) sistem eskisi gibi TEK
  hesaptan (.env'deki `EMAIL_USER`) göndermeye devam eder.
- **Gelişmiş analiz paneli**: Dashboard'a Chart.js ile çizilen grafikler eklendi — son 30
  günün gönderim/yanıt/olumlu trendi, CRM Pipeline hunisi, A/B test karşılaştırması.
- **Amazon analiz modülü**: Dashboard'da portföy genelinde ortalama ciro/fiyat/yorum/puan,
  rekabet dağılımı (düşük/orta/yüksek) ve en değerli 10 kategori özeti.
- **Excel/PDF raporlama sistemi**: Dashboard'daki "Excel Raporu İndir" / "PDF Raporu
  İndir" butonlarıyla, genel özet + CRM dağılımı + kategoriler + tüm markaların tam
  listesini içeren tek bir dosya indirilebilir.
- **Playwright ile toptan satış formu otomatik doldurma** (isteğe bağlı): Marka Detayı >
  Wholesale Form sekmesinden, tespit edilen wholesale sayfası açılıp form alanları
  (isim/e-mail/şirket/telefon/mesaj) otomatik doldurulur ve bir ekran görüntüsü
  sunulur — **form ASLA otomatik gönderilmez**, sen inceleyip kendin gönderirsin. Bu
  özellik `playwright` paketini GEREKTİRİR ama bilerek `package.json`'a eklenmedi (npm
  install'ı yavaşlatıp Render deploy'unu bozma riski olmasın diye). Kullanmak istersen
  sunucuda: `npm install playwright && npx playwright install chromium`.
- **GitHub Actions CI**: `.github/workflows/test.yml`, her push/PR'da `npm test`'i
  otomatik çalıştırır — deploy etmeden önce bir bozulmayı fark etmeni sağlar.
- **100.000+ marka için performans optimizasyonu**: `brands`/`tasks`/`brand_events`/
  `brand_documents` tablolarına en sık sorgulanan alanlar (status, batch, crm_stage,
  main_category, email, opportunity_score, brand_id) için veritabanı indeksleri eklendi.

### v46 sonrası yeni ortam değişkenleri (hepsi opsiyonel)

- `ANTHROPIC_API_KEY`: AI kişiselleştirme/öncelik/yanıt sınıflandırma özellikleri için.
- `PUBLIC_URL`: A/B test açılma (open) takip pikseli için (Render'da genelde otomatik
  `RENDER_EXTERNAL_URL` kullanılır, ayrıca tanımlamana gerek yoktur).

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
    routes/settings.js     # Profil/imza ayarları + CRM pipeline + A/B test + çoklu hesap ayarları
    routes/brands.js       # Excel yükleme, e-mail bulma, gönderim, CRM, fuzzy dedup, timeline, wholesale form
    routes/tracking.js     # Yanıt kontrolü + otomatik follow-up + haftalık özet + güvenlik freni + açılma pikseli
    routes/suppression.js  # Kalıcı "bir daha yazma" listesi API'si
    routes/tasks.js         # v46: Not/Görev/Hatırlatma sistemi
    routes/documents.js     # v54: Evrak yönetim sistemi
    routes/aiFeatures.js    # v55/56/57: AI kişiselleştirme, öncelik/etiket, yanıt sınıflandırma (opt-in)
    routes/dashboard.js     # v47: "Bugün Yapılacaklar" akıllı paneli
    routes/analytics.js     # Özet istatistikler + zaman serisi + A/B test + Amazon analizi + Excel/PDF rapor
    services/mailer.js     # Gmail App Password ile mail gönderme (nodemailer) + CAN-SPAM footer + çoklu hesap + açılma pikseli
    services/mailerHelpers.js # DB'siz saf mantık (round robin sıralama, A/B varyant seçimi) — test edilebilir
    services/emailFinder.js # Marka -> e-mail bulma mantığı (Amazon storefront + LinkedIn + WHOIS + wholesale sayfası tespiti dahil)
    services/inboxChecker.js # Gmail IMAP ile yanıt kontrolü + basit sentiment tahmini
    services/suppression.js  # Kalıcı "bir daha yazma" listesi mantığı
    services/backup.js       # Haftalık veritabanı yedeği mail eki olarak gönderme
    services/dnsCheck.js     # SPF/DKIM/DMARC canlı DNS doğrulaması
    services/ai.js           # Anthropic Claude API çağrıları (model seçimi dahil)
    services/opportunityScore.js # Opportunity Score (0-100) hesaplama
    services/crmPipeline.js  # CRM Pipeline aşama mantığı (sadece ileri taşır)
    services/fuzzyDedup.js   # Fuzzy duplicate tespiti (şirket eki/yazım farkı)
    services/documents.js    # Evrak dosyalarını diske kaydetme
    services/events.js       # Marka bazlı Timeline olay kaydı
    services/formFiller.js   # Playwright ile wholesale form doldurma (opsiyonel, lazy-load)
    services/reporting.js    # Excel/PDF rapor üretimi
  public/                 # Panel (index.html) + Gönderim Takibi (tracking.html) + Dashboard (analytics.html)
  tests/                  # Kalıcı otomatik test seti (npm test ile çalışır)
  .github/workflows/test.yml # v64: GitHub Actions CI
  sample_brands.csv       # Test için örnek marka listesi
  .env.example
```
