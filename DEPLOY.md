# Деплой Агарва на VPS (Timeweb / Reg.ru)

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

Создайте `/opt/agarwa/.env` на VPS и не добавляйте его в git:

```bash
cd /opt/agarwa
nano .env
```

Минимально нужны `PORT=3001`, `TELEGRAM_BOT_ENABLED=1`, `TELEGRAM_BOT_TOKEN=...`
и `GAME_API_SECRET=...`. `GAME_API_SECRET` должен быть одним и тем же для сервера
и встроенного бота; `GAME_API_URL` обычно не задавайте — будет использован
`http://127.0.0.1:PORT`.

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

### Исправление HTTP 405 при загрузке скина

`nginx -t` и reload проверяют только синтаксис. Ошибка 405 обычно означает, что
активный HTTPS-сайт отдаёт `/api/skins` как статику, а не проксирует запрос в
Node. Проверьте именно активную конфигурацию:

```bash
ls -la /etc/nginx/sites-enabled/
sudo nginx -T | less
```

Откройте файл, на который указывает нужная ссылка из `sites-enabled` (а также
его HTTPS-блок `server { listen 443 ssl ... }`). Внутри этого `server` должен
быть блок ниже. Порт берите из `PORT=` в `/opt/agarwa/.env`; если переменная не
задана, в проекте `DEFAULT_SERVER_PORT` равен **3001**.

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:3001; # замените 3001, только если PORT в .env другой
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 12m;
    proxy_request_buffering off;
}
```

Сохраните конфигурацию, затем проверьте и примените её:

```bash
cd /opt/agarwa
grep '^PORT=' .env || echo 'PORT не задан: используется 3001'
sudo nginx -t && sudo systemctl reload nginx
curl -i -X POST http://127.0.0.1:3001/api/skins
curl -i -X POST https://YOUR_DOMAIN/api/skins
```

Без файла скина Node вернёт **400**, это нормальный признак, что POST дошёл до
API. **405** на домене после этого означает, что редактируется не тот активный
`server`-блок или в HTTPS-блоке отсутствует `location /api/`. Там же должен
оставаться блок `location /ws` из `deploy/nginx.conf`.

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

Если `git pull` сообщает, что локальный `dist/index.html` будет перезаписан,
он **ничего не обновил**. Сначала уберите только сгенерированную статику из
рабочего дерева, затем повторите обновление:

```bash
cd /opt/agarwa
# Нужно только при переходе с версии, где .env ошибочно был в git:
cp .env /opt/agarwa.env.backup
git checkout -- dist/index.html
git pull
# Верните локальные секреты: новый коммит больше не хранит .env в репозитории.
cp /opt/agarwa.env.backup .env
chmod 600 .env
ls bot
npm ci
npm run build
sudo rsync -a --delete dist/ /var/www/agarwa/
pm2 restart agarwa-server --update-env
pm2 logs agarwa-server --lines 100
```

`ls bot` должен показать `index.ts`. После изменения переменных в `.env`
всегда используйте `pm2 restart agarwa-server --update-env`.

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
