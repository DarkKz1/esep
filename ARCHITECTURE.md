# Esep — Impact Portal (pivot B) — архитектура и контракты

Донор-фейсинг портал импакта. НКО сдают отчёты из сырых заметок → донор (Chevron) видит живой
агрегированный дашборд с **линзой качества данных и рисков**. Один AI-движок питает общий стор.

Всё ниже — ФИКСИРОВАННЫЙ контракт. Имена полей не менять — по ним строятся все части.

---

## 1. Модель данных — объект `report`

```js
{
  id: "string",              // slug: `${orgSlug}-${programSlug}` или uuid
  org: "string",             // название НКО, напр. "Ayala"
  program: "string",         // напр. "Donation of Medical Equipment"
  programArea: "string",     // РОВНО одно из: "Economic Development" | "Health" |
                             //   "Education & STEM" | "Environment" |
                             //   "Disaster Preparedness" | "Community Support"
  donor: "string",           // "Chevron"
  period: "string",          // "апрель–июнь 2026"
  cities: ["string"],        // подмножество: Atyrau|Aktau|Aktobe|Astana|Almaty|Nationwide
  metrics: {
    peopleReached: 0,        // number | null  (null = не сведено)
    events: 0,               // number | null
    budgetSpent: "string"    // свободный текст, может быть "—"
  },
  activities: [              // что реально произошло
    { date: "string", city: "string", desc: "string" }
  ],
  results: "string",         // что изменилось (не выпуск, а результат)
  quotes: [
    { text: "string", source: "string" }
  ],
  risks: [                   // ПУСТО если рисков нет
    { severity: "low"|"medium"|"high", desc: "string" }
  ],
  dataGaps: ["string"],      // ПУСТО если всё сдано; иначе что досчитать
  reportMarkdown: "string",  // человекочитаемый полный отчёт (для раскрытия карточки)
  submittedAt: "string",     // ISO 8601
  status: "submitted"
}
```

**Железное правило AI:** никогда не выдумывать цифры. Чего нет в заметках — в `dataGaps`,
а не в `metrics`. Приблизительное («около 40») → пометка в desc, metric = null если не уверен.

---

## 2. `netlify/functions/extract.mjs` — экстракция (AI)

- **POST** `/api/extract`. Тело: `{ notes, org, program, donor, period, lang }`.
- Anthropic Messages API: `x-api-key: process.env.ANTHROPIC_API_KEY`, `anthropic-version: 2023-06-01`.
  Цепочка моделей-фоллбэков: `['claude-sonnet-5','claude-sonnet-4-5','claude-sonnet-4-20250514']`.
- **Форсим JSON** через `tools:[{name:'emit_report', input_schema:<dataModel>}]` +
  `tool_choice:{type:'tool', name:'emit_report'}`. Парсим `content[].input` из `tool_use`.
- Внутри также заполняем `reportMarkdown` (тот же человекочитаемый формат, что старый generate.mjs:
  резюме / деятельность / охват таблицей / результаты / голоса / проблемы / чего не хватает).
- programArea маппим строго в одну из 6 категорий; cities — в известный набор + Nationwide;
  risks классифицируем по severity.
- Ошибки: notes < 30 симв → 400 friendly. 401 / "credit balance too low" → 502 с понятным
  сообщением «сервис генерации временно недоступен». Всё JSON.
- Возвращает: `{ report: <объект report БЕЗ id/submittedAt — их проставит reports.mjs при сабмите> }`.

---

## 3. `netlify/functions/reports.mjs` — стор (Netlify Blobs)

- `import { getStore } from '@netlify/blobs'`; `const store = getStore('esep-reports')`.
- Один ключ `'all'` хранит JSON-массив всех отчётов (для демо конкурентность не важна).
- **GET** `/api/reports` → `{ reports: [...] }`. Если `store.get('all',{type:'json'})` пуст/нет —
  засеять из `seedReports` (`import { seedReports } from '../../src/seedData.js'`),
  записать `store.setJSON('all', seedReports)`, вернуть их.
- **POST** `/api/reports` → тело = объект `report` (обычно из extract). Валидируем минимально
  (org, program, programArea). Проставляем `id` (slug + короткий суффикс) и `submittedAt`=сейчас,
  `status:'submitted'`, если отсутствуют. Читаем массив, `unshift` (новый сверху), пишем, возвращаем `{ report }`.
- Всё JSON, корректные коды. Добавить `@netlify/blobs` в `package.json` dependencies.

---

## 4. Агрегаты донора (client-side, из `reports[]`)

- `totalReached` = Σ `metrics.peopleReached` (null → 0)
- `programsCount` = уникальные `program`
- `orgsCount` = уникальные `org`
- `citiesReached` = уникальные из flatten `cities` (исключая "Nationwide" при подсчёте «городов»,
  но показывать Nationwide как отдельный бейдж)
- `openRisks` = все `risks`, сгруппировать по severity → `{high, medium, low}`
- `dataGapsCount` = Σ `dataGaps.length`
- `perArea` = кол-во программ по programArea (для распределения)
- `perCity` = кол-во программ по городу
- **Data-quality score** = доля отчётов с пустыми dataGaps и без high-риска (наш уникальный слой).

---

## 5. Роутинг (без внешних зависимостей)

Хеш-роутер на `window.location.hash`:
- `''` / `#/` → **DonorPortal** (главная, лицо продукта)
- `#/submit` → **SubmitFlow** (вход НКО)
- Переключение — простые ссылки + `useState` по `hashchange`.

---

## 6. Seed — `src/seedData.js`

14 отчётов по реальным программам/НКО Chevron (список — в промпте генератора).
Реалистичные KZ-числа, суммарный охват ≈ 32 000. Русские цитаты. Даты 2026.
**Для демо:** 2–3 отчёта с непустыми `dataGaps`, 1–2 с `risks` (medium/high) — чтобы риск-линза
сразу показывала работу. Экспорт: `export const seedReports = [...]` + default.

---

## 7. Интеграция (пишет человек-интегратор в App.jsx)

- App становится роутером: читает hash, на `/` фетчит `/api/reports` → DonorPortal;
  на `#/submit` рендерит SubmitFlow (переработанный текущий App: заметки → extract → POST /api/reports
  → редирект на портал с подсветкой нового отчёта).
- Общий дизайн-язык из `styles.css` (paper-and-ink) — переиспользуется, донор-специфичные
  классы добавляются туда же.
