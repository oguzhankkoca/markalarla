#!/bin/bash
cd "$(dirname "$0")"

echo "================================================="
echo "  Marka Outreach uygulaması başlatılıyor..."
echo "================================================="

if [ ! -d node_modules ]; then
  echo ""
  echo "İlk çalıştırma: gerekli paketler kuruluyor, biraz sürebilir..."
  npm install
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo ""
  echo "!!! .env dosyası oluşturuldu. Gmail bilgilerini (EMAIL_USER, EMAIL_APP_PASSWORD)"
  echo "!!! girmeden mail gönderemezsin. Şimdi .env dosyasını Not Defteri ile açıp"
  echo "!!! dolduralım, sonra kaydedip bu pencereye dön."
  echo ""
  open -e .env
  read -p "Bilgileri girip kaydettiysen Enter'a bas..."
fi

npm start
