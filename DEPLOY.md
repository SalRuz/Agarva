# Деплой Агарва на VPS (Timeweb / Reg.ru)
JK>hg<26
jYBg3C77Hw^R6d
y-6^b+G**YdQr7
Клиент: статика из `dist/` (один `index.html` после `npm run build`).  
Сервер: Node WebSocket на порту **3001** (только localhost за nginx).  
Клиенты ходят на **`wss://ВАШ_ДОМЕН/ws`** (same-origin; руками URL задавать не нужно).

---

## 0. Что нужно заранее

1. VPS Ubuntu 22.04/24.04 (или Debian).
2. Домен, A-запись → IP сервера (DNS у регистратора / панели Timeweb/Reg.ru).
3. Доступ по SSH (`root` или sudo-пользователь).
4. Открыты порты **80** и **443** в firewall панели и `ufw` (порт **3001 наружу не открывать**).

---

## 1. Установка Node.js 22 и утилит

```bash
sudo apt update
sudo apt install -y nginx git curl rsync ufw
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # v22.x
npm -v
sudo npm i -g pm2
```

Firewall (если используете ufw):

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

---

## 2. Код проекта на сервер

Вариант A — git clone:

```bash
cd /opt
sudo git clone <URL_ВАШЕГО_РЕПО> agarwa
sudo chown -R "$USER":"$USER" /opt/agarwa
cd /opt/agarwa
```

Вариант B — залить архив / `scp` с ПК и распаковать в `/opt/agarwa`.

```bash
cd /opt/agarwa
npm ci
npm run build
```

Опционально зафиксировать WS URL на этапе сборки (обычно **не нужно** — клиент сам берёт `wss://текущий-хост/ws`):

```bash
# VITE_WS_URL=wss://game.example.com/ws npm run build
```

---

## 3. Запуск WebSocket-сервера (PM2)

```bash
cd /opt/agarwa
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup    # выполнить команду, которую выведет pm2
pm2 status
pm2 logs agarwa-server --lines 50
```

Проверка локально на VPS:

```bash
curl -i -N \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  http://127.0.0.1:3001/
```

Ожидается ответ **101 Switching Protocols** (или отказ handshake без полного WS-клиента — главное, что порт слушает Node).

Перезапуск / смена порта:

```bash
PORT=3001 pm2 restart agarwa-server --update-env
# или править PORT в ecosystem.config.cjs
```

Альтернатива Docker только для WS:

```bash
docker compose up -d --build game-server
# слушает 127.0.0.1:3001
```

---

## 4. Раздача статики

```bash
sudo mkdir -p /var/www/agarwa
sudo rsync -a --delete /opt/agarwa/dist/ /var/www/agarwa/
# или: bash scripts/start-prod.sh serve-static
```

---

## 5. Nginx + WebSocket + HTTPS

```bash
sudo cp /opt/agarwa/deploy/nginx.conf /etc/nginx/sites-available/agarwa
sudo nano /etc/nginx/sites-available/agarwa
# замените YOUR_DOMAIN на ваш домен, например game.example.com
sudo ln -sf /etc/nginx/sites-available/agarwa /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

Сертификат Let's Encrypt:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d YOUR_DOMAIN
```

Certbot спросит email и согласие с ToS — это ручной шаг. После успеха откройте сайт по **https://**.

Убедитесь, что в HTTPS-сервере есть блок `location /ws` (certbot обычно копирует locations; если пропал — скопируйте из `deploy/nginx.conf`).

---

## 6. Что открывать игрокам

| Что | URL |
|-----|-----|
| Игра в браузере | `https://YOUR_DOMAIN/` |
| WebSocket (автоматически) | `wss://YOUR_DOMAIN/ws` |

В норме **ничего в localStorage писать не нужно**: production-сборка сама подключается к same-origin `/ws`.

Переопределение (отладка / другой сервер):

```js
localStorage.setItem('agarServerUrl', 'wss://YOUR_DOMAIN/ws')
// сброс:
localStorage.removeItem('agarServerUrl')
```

---

## 7. Обновление версии

```bash
cd /opt/agarwa
git pull          # или залить новые файлы
npm ci
npm run build
sudo rsync -a --delete dist/ /var/www/agarwa/
pm2 restart agarwa-server
```

---

## 8. Локальная разработка (не ломается)

```bash
npm run server    # ws://127.0.0.1:3001
npm run dev       # http://localhost:5173
```

В dev клиент по умолчанию идёт на `ws://127.0.0.1:3001`.  
Vite также проксирует `/ws` → `:3001` (можно `localStorage.setItem('agarServerUrl','ws://localhost:5173/ws')`).

Radmin VPN по-прежнему через override:

```js
localStorage.setItem('agarServerUrl', 'ws://26.235.224.147:3001')
```

---

## 9. Типичные проблемы

| Симптом | Что проверить |
|---------|----------------|
| Страница открывается, Online не коннектится | `pm2 logs`, nginx `location /ws`, `wss://` при HTTPS |
| Mixed content | Сайт по HTTPS, а в localStorage остался `ws://...` |
| 502 на /ws | Node не запущен или слушает не `127.0.0.1:3001` |
| Certbot ошибка | DNS A-запись ещё не указывает на VPS; порты 80/443 закрыты |

---

## Файлы деплоя в репозитории

- `Dockerfile` / `docker-compose.yml` — WS-сервер в контейнере
- `deploy/nginx.conf` — пример для хостового nginx + certbot
- `deploy/nginx.docker.conf` — nginx в compose profile `full`
- `ecosystem.config.cjs` — PM2
- `scripts/start-prod.sh` — короткие хелперы
- `.env.example` — `PORT`, опциональный `VITE_WS_URL`
