// Экстракция структурированного отчёта из сырых полевых заметок НКО (Anthropic tool-use).
// В отличие от generate.mjs (стриминг markdown), здесь форсим строгий JSON через tool_choice
// и отдаём готовый объект report (без id/submittedAt/status — их проставит reports.mjs).

const MODELS = ['claude-sonnet-5', 'claude-sonnet-4-5', 'claude-sonnet-4-20250514']

const PROGRAM_AREAS = [
  'Economic Development',
  'Health',
  'Education & STEM',
  'Environment',
  'Disaster Preparedness',
  'Community Support',
]

const CITIES = ['Atyrau', 'Aktau', 'Aktobe', 'Astana', 'Almaty', 'Nationwide']

// input_schema — точная модель данных report из ARCHITECTURE.md, кроме id/submittedAt/status
// (эти три поля не извлекаются из заметок — их проставляет reports.mjs при сабмите).
const EMIT_REPORT_SCHEMA = {
  name: 'emit_report',
  description: 'Зафиксировать извлечённый структурированный отчёт НКО строго по модели данных.',
  input_schema: {
    type: 'object',
    properties: {
      org: { type: 'string', description: 'Название НКО' },
      program: { type: 'string', description: 'Название программы/проекта' },
      programArea: {
        type: 'string',
        enum: PROGRAM_AREAS,
        description: 'Ровно одна из 6 категорий программы',
      },
      donor: { type: 'string', description: 'Донор, напр. Chevron' },
      period: { type: 'string', description: 'Отчётный период, напр. «апрель–июнь 2026»' },
      cities: {
        type: 'array',
        items: { type: 'string', enum: CITIES },
        description: 'Подмножество городов из фиксированного набора, где реально была деятельность',
      },
      metrics: {
        type: 'object',
        description: 'Сведённые цифры. null там, где данные не сведены — НЕ выдумывать.',
        properties: {
          peopleReached: {
            type: ['integer', 'null'],
            description: 'Число охваченных людей, только если явно сведено в заметках; иначе null',
          },
          events: {
            type: ['integer', 'null'],
            description: 'Число мероприятий, только если явно сведено; иначе null',
          },
          budgetSpent: {
            type: 'string',
            description: 'Свободный текст с потраченным бюджетом; «—» если не указан',
          },
        },
        required: ['peopleReached', 'events', 'budgetSpent'],
      },
      activities: {
        type: 'array',
        description: 'Что реально произошло за период',
        items: {
          type: 'object',
          properties: {
            date: { type: 'string' },
            city: { type: 'string' },
            desc: { type: 'string' },
          },
          required: ['date', 'city', 'desc'],
        },
      },
      results: {
        type: 'string',
        description: 'Что изменилось для благополучателей (результат, а не просто выпуск/охват)',
      },
      quotes: {
        type: 'array',
        description: 'Прямые цитаты/мини-истории из заметок. Пусто, если их нет.',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            source: { type: 'string' },
          },
          required: ['text', 'source'],
        },
      },
      risks: {
        type: 'array',
        description: 'Риски/проблемы, классифицированные по серьёзности. Пусто, если рисков нет.',
        items: {
          type: 'object',
          properties: {
            severity: { type: 'string', enum: ['low', 'medium', 'high'] },
            desc: { type: 'string' },
          },
          required: ['severity', 'desc'],
        },
      },
      dataGaps: {
        type: 'array',
        items: { type: 'string' },
        description: 'Чего не хватает для полного отчёта. Пусто, если всё сдано.',
      },
      reportMarkdown: {
        type: 'string',
        description: 'Человекочитаемый полный отчёт в markdown по фиксированной структуре',
      },
    },
    required: [
      'org',
      'program',
      'programArea',
      'donor',
      'period',
      'cities',
      'metrics',
      'activities',
      'results',
      'quotes',
      'risks',
      'dataGaps',
      'reportMarkdown',
    ],
  },
}

const SYSTEM_PROMPT = `Ты — эксперт по грантовой отчётности некоммерческих организаций (НКО) в Казахстане и СНГ. Ты много лет готовишь отчёты для международных доноров (Chevron, USAID, фонды ООН, Eurasia Foundation) и знаешь, что они хотят видеть.

Твоя задача: превратить сырые полевые заметки НКО (сообщения из мессенджеров, обрывки таблиц, наблюдения координаторов) в структурированный отчёт и вызвать инструмент emit_report с заполненными полями.

ЖЕЛЕЗНЫЕ ПРАВИЛА:
1. НИКОГДА не выдумывай факты, цифры, имена, даты. Используй ТОЛЬКО то, что есть в заметках.
2. Если числовые показатели (peopleReached, events) не сведены явно в заметках — ставь null, а не приблизительную оценку. Приблизительное («около 40») переноси в текстовое поле (desc/results) с пометкой «~40», но НЕ в metrics.
3. Всё, чего не хватает для полного отчёта, перечисли в dataGaps (например: разбивка по полу, подписанные согласия на фото, точное число участников вместо «примерно»). Если данных не хватает — это НЕ повод придумывать их, а повод занести в dataGaps.
4. programArea — РОВНО одна из шести категорий: "Economic Development", "Health", "Education & STEM", "Environment", "Disaster Preparedness", "Community Support". Выбери ближайшую по смыслу, даже если в заметках сформулировано иначе.
5. cities — только из набора {Atyrau, Aktau, Aktobe, Astana, Almaty, Nationwide}. Если деятельность охватывала всю страну или несколько регионов без уточнения — используй "Nationwide". Если город из заметок не входит в набор — не выдумывай замену, просто не включай его в cities (но упомяни в activities/results как есть).
6. risks — классифицируй по severity: "high" (угрожает результатам программы или деньгам донора), "medium" (заметная проблема, но управляемая), "low" (незначительное). Если рисков нет — risks: [].
7. Цитаты и истории бери дословно или с минимальной чисткой, помечай источник как он указан в заметках. Если их нет — quotes: [].
8. Тон reportMarkdown — профессиональный, сдержанный, без канцелярита и без маркетингового глянца. Донор ценит честность: проблемы и невыполненное описывай прямо.

СТРУКТУРА reportMarkdown (markdown, заголовки ##):
# {Название программы} — отчёт за {период}
Строка: организация, донор, дата подготовки (если известны).
## Резюме
3–5 предложений: что сделано, главный результат, главная проблема.
## Деятельность за период
Список мероприятий с датами и городами — что реально произошло.
## Охват и цифры
Markdown-таблица: показатель | значение | комментарий. Только цифры из заметок.
## Результаты и изменения
Что изменилось для благополучателей. Отличай выпуск (сколько провели) от результата (что поменялось).
## Истории и голоса участников
Прямые цитаты и мини-истории из заметок. Если нет — скажи прямо.
## Проблемы и уроки
Что пошло не так, что сделали иначе.
## Планы на следующий период
Только если в заметках есть про планы.
## ⚠️ Чего не хватает для полного отчёта
Чек-лист: какие данные полевой команде нужно досчитать/собрать. Дублирует dataGaps в прозе.

Пиши reportMarkdown на языке, указанном в запросе (ru = русский, en = английский). Названия организаций и городов не переводи, транслитерируй при необходимости.

Всегда вызывай emit_report ровно один раз с полностью заполненными полями — свободный текст вне вызова инструмента не нужен.`

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
  }

  let payload
  try {
    payload = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Некорректный запрос' }), { status: 400 })
  }

  const { notes, org = '', program = '', donor = '', period = '', lang = 'ru' } = payload || {}

  if (!notes || notes.trim().length < 30) {
    return new Response(
      JSON.stringify({ error: 'Слишком мало заметок — вставьте хотя бы пару предложений о том, что происходило.' }),
      { status: 400 },
    )
  }
  if (notes.length > 60000) {
    return new Response(
      JSON.stringify({ error: 'Слишком много текста за один раз (лимит ~60 000 знаков). Разбейте на два отчёта.' }),
      { status: 400 },
    )
  }

  const meta = [
    org && `Организация: ${org}`,
    program && `Программа: ${program}`,
    donor && `Донор: ${donor}`,
    period && `Отчётный период: ${period}`,
    `Язык отчёта: ${lang === 'en' ? 'en (английский)' : 'ru (русский)'}`,
  ].filter(Boolean).join('\n')

  const userMessage = `${meta}\n\nСырые полевые заметки:\n"""\n${notes}\n"""\n\nИзвлеки структурированный отчёт и вызови emit_report. Помни: ни одной выдуманной цифры; чего не хватает — в dataGaps.`

  let upstream = null
  let lastError = ''
  for (const model of MODELS) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 6000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
        tools: [EMIT_REPORT_SCHEMA],
        tool_choice: { type: 'tool', name: 'emit_report' },
      }),
    })
    if (res.ok) { upstream = res; break }
    lastError = `${res.status} ${await res.text()}`
    // 401 (плохой ключ) и «credit balance is too low» — не имеет смысла пробовать другие модели.
    if (res.status === 401 || lastError.includes('credit balance is too low')) break
    if (res.status !== 404 && res.status !== 400) break
  }

  if (!upstream) {
    console.error('Anthropic error:', lastError)
    return new Response(
      JSON.stringify({ error: 'Сервис генерации временно недоступен, попробуйте ещё раз через минуту.' }),
      { status: 502 },
    )
  }

  let data
  try {
    data = await upstream.json()
  } catch (err) {
    console.error('Anthropic response parse error:', err)
    return new Response(
      JSON.stringify({ error: 'Сервис генерации временно недоступен, попробуйте ещё раз через минуту.' }),
      { status: 502 },
    )
  }

  const toolUse = Array.isArray(data.content)
    ? data.content.find((block) => block.type === 'tool_use' && block.name === 'emit_report')
    : null

  if (!toolUse || !toolUse.input) {
    console.error('Anthropic response missing emit_report tool_use:', JSON.stringify(data).slice(0, 2000))
    return new Response(
      JSON.stringify({ error: 'Сервис генерации временно недоступен, попробуйте ещё раз через минуту.' }),
      { status: 502 },
    )
  }

  return new Response(JSON.stringify({ report: toolUse.input }), {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}
