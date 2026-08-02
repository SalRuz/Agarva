# Агарва — agar.io clone (agar.su-like physics + multiplayer)

React + Vite клиент и authoritative Node.js WebSocket сервер. Общая физика в `shared/`.

**Прод на VPS (Timeweb / Reg.ru):** пошагово в [DEPLOY.md](./DEPLOY.md).

## Timeweb: сайт и Telegram-бот одним приложением

В панели Node.js укажите одну команду запуска: `npm start`. Она запускает игровой сервер, а тот
автоматически запускает встроенный Telegram-бот в том же процессе. В переменных окружения задайте
`PORT` (если требует Timeweb), `GAME_API_SECRET`, `TELEGRAM_BOT_ENABLED=1`,
`TELEGRAM_BOT_TOKEN` и при необходимости `TELEGRAM_DEV_ID`. `GAME_API_URL` обычно оставляют
пустым: бот сам обращается к `http://127.0.0.1:PORT`, без публичного loopback.

Ошибки бота выводятся в обычный журнал Node.js в панели хостинга и сохраняются в последних строках
`data/bot-logs.txt`. Администратор также может открыть их в игре: «Админские настройки» →
«Логи Telegram-бота».

## Быстрый старт

```bash
cd "ОБНОВЛЕННАЯ ВЕРСИЯ QWEN"
npm install
```

### Solo (локально с ботами)

```bash
npm run dev
```

Откройте http://localhost:5173 → **Solo** → ник → Играть.

### Мультиплеер

Терминал 1 — сервер:

```bash
npm run server
```

Сервер слушает `0.0.0.0:3001` (переменная `PORT` меняет порт).

Терминал 2 — клиент:

```bash
npm run dev
```

На стартовом экране: **Мультиплеер** → ник → Войти.  
В dev клиент по умолчанию подключается к `ws://127.0.0.1:3001`.

Переопределение URL (консоль браузера):

```js
localStorage.setItem('agarServerUrl', 'ws://localhost:3001')
// или через Vite-прокси:
localStorage.setItem('agarServerUrl', 'ws://localhost:5173/ws')
```

В production (сайт за nginx + HTTPS) клиент сам использует `wss://текущий-хост/ws`.  
Опционально при сборке: `VITE_WS_URL=wss://game.example.com/ws npm run build`.

### Порт занят (EADDRINUSE)

Сервер слушает **один раз**. При старте пытается аккуратно убить старый `node` на этом порту.
Если порт всё ещё занят:

```bash
netstat -ano | findstr :3001
taskkill /PID <pid> /F
```

Или другой порт:

```bash
set PORT=3002
npm run server
```

## Игра с друзьями через Radmin VPN

1. Все ставят [Radmin VPN](https://www.radmin-vpn.com/) и заходят в одну сеть.
2. **Хост** запускает сервер (`npm run server`) на машине с Radmin-IP.
3. Друзья задают URL хоста один раз в консоли:

```js
localStorage.setItem('agarServerUrl', 'ws://ВАШ_RADMIN_IP:3001')
```

4. Firewall Windows: разрешите входящие TCP на порт **3001** для Node.

## Админ (хост)

Токен по умолчанию: **`salruz`**  
Сервер: `ADMIN_TOKEN` (env) или константа `ADMIN_TOKEN` в `shared/constants.ts`.  
Клиент автоматически шлёт `{type:'adminAuth', token}` (из `localStorage.agarAdminToken` или дефолт `salruz`).

| Клавиша | Действие |
|--------|----------|
| **Q** | +100 массы (Solo всегда; Online — только после adminAuth) |
| **1** | Цикл размера карты: **3000 → 5000 → 8000 → 12000** |

Смена токена на клиенте:

```js
localStorage.setItem('agarAdminToken', 'salruz')
```

## Управление

| Клавиша | Действие |
|--------|----------|
| Мышь | Движение (скорость от дистанции курсора до центра клетки) |
| Пробел | Split (min 40 → две по 20) |
| W | Выброс массы |
| Enter | Чат (онлайн): открыть / отправить / закрыть |
| Q | +100 массы (админ / Solo) |
| 1 | Размер карты (админ) |
| ESC | Пауза / смена ника (Solo + Online → `rename`) |
| Колёсико | Зум (над чатом — скролл истории) |

## Физика (актуальные числа)

- Старт: **15 mass**, радиус `√(15×100) ≈ 38.7`
- Колючка: **130 mass**, радиус `√(130×100) ≈ 114` (= клетка с массой 130)
- Еда: **+5 mass**; W-кусок **15 mass**
- Поедание / merge: масса ≥ 1.25× и покрытие жертвы **>60%**
- W в вирус: поглощение при покрытии **≥70%** (кусок сначала визуально заходит внутрь)
- Скорость: `180 / radius^1.15` (малые сильно быстрее крупных)
- Split: min **40**, импульс + короткий soft-slide
- Soft-body: разделение по **обратной массе** (лёгкая клетка уезжает, тяжёлая почти стоит)
- Decay: ~0.2%/сек при массе > 50
- Max 16 клеток, лимит клетки ~22500

## Производительность

- Solo: `GameCanvas` владеет update+draw через refs (без React `setState` каждый кадр)
- HUD / leaderboard / minimap — ~8 Hz
- Spatial hash для еды, cull отрисовки, дешёвый bot AI (~250 ms)

## Структура

```
shared/     — типы, константы, физика, GameEngine (клиент + сервер)
server/     — WebSocket authoritative сервер
src/        — React клиент (Solo + Online)
deploy/     — nginx-примеры для VPS
```

## Протокол JSON

Клиент → сервер: `join`, `input`, `split`, `eject`, `ping`, `adminAuth`, `adminAddMass`, `adminCycleMap`, `rename`, `chat`  
Сервер → клиент: `welcome`, `state`, `died`, `error`, `pong`, `world`, `adminStatus`, `chat`

Тик сервера: **30 Hz**. Еда в snapshot — в радиусе вокруг игрока.  
После `died` соединение живёт — повторный `join` = респавн.
