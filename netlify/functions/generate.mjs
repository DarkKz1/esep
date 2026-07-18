// Стриминговая генерация отчёта: принимает полевые заметки, отдаёт markdown-отчёт
// чанками plain-text (SSE Anthropic парсится на сервере, клиенту летит чистый текст).

const MODELS = ['claude-sonnet-5', 'claude-sonnet-4-5', 'claude-sonnet-4-20250514']

const SYSTEM_PROMPT = `Ты — эксперт по грантовой отчётности некоммерческих организаций (НКО) в Казахстане и СНГ. Ты много лет готовишь отчёты для международных доноров (Chevron, USAID, фонды ООН, Eurasia Foundation) и знаешь, что они хотят видеть.

Твоя задача: превратить сырые полевые заметки НКО (сообщения из мессенджеров, обрывки таблиц, наблюдения координаторов) в структурированный профессиональный отчёт донору.

ЖЕЛЕЗНЫЕ ПРАВИЛА:
1. НИКОГДА не выдумывай факты, цифры, имена, даты. Используй ТОЛЬКО то, что есть в заметках.
2. Если данных для раздела нет — пиши «Данные за период не предоставлены» и добавь этот пункт в раздел «Чего не хватает».
3. Все цифры из заметок собирай в таблицу охвата. Если цифра приблизительная («около 40») — так и пиши: «~40».
4. Цитаты и истории бери дословно или с минимальной чисткой, помечай источник как он указан в заметках.
5. Тон — профессиональный, сдержанный, без канцелярита и без маркетингового глянца. Донор ценит честность: проблемы и невыполненное описывай прямо.

СТРУКТУРА ОТЧЁТА (markdown, заголовки ##):
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
Что пошло не так, что сделали иначе. Доноры доверяют отчётам, где это есть.
## Планы на следующий период
Только если в заметках есть про планы.
## ⚠️ Чего не хватает для полного отчёта
Чек-лист: какие данные полевой команде нужно досчитать/собрать (например: разбивка по полу, подписанные согласия на фото, точное число участников вместо «примерно»). Это самый ценный раздел — будь конкретным.

Пиши на языке, указанном в запросе (ru = русский, en = английский). Названия организаций и городов не переводи, транслитерируй при необходимости.`

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  let payload
  try {
    payload = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Некорректный запрос' }), { status: 400 })
  }

  const { notes, org = '', program = '', donor = '', period = '', lang = 'ru' } = payload
  if (!notes || notes.trim().length < 30) {
    return new Response(JSON.stringify({ error: 'Слишком мало заметок — вставьте хотя бы пару предложений о том, что происходило.' }), { status: 400 })
  }
  if (notes.length > 60000) {
    return new Response(JSON.stringify({ error: 'Слишком много текста за один раз (лимит ~60 000 знаков). Разбейте на два отчёта.' }), { status: 400 })
  }

  const meta = [
    org && `Организация: ${org}`,
    program && `Программа: ${program}`,
    donor && `Донор: ${donor}`,
    period && `Отчётный период: ${period}`,
    `Язык отчёта: ${lang === 'en' ? 'en (английский)' : 'ru (русский)'}`,
  ].filter(Boolean).join('\n')

  const userMessage = `${meta}\n\nСырые полевые заметки:\n"""\n${notes}\n"""\n\nПодготовь отчёт по структуре из инструкции. Помни: ни одной выдуманной цифры.`

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
        max_tokens: 4000,
        stream: true,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    })
    if (res.ok) { upstream = res; break }
    lastError = `${res.status} ${await res.text()}`
    if (res.status !== 404 && res.status !== 400) break
  }

  if (!upstream) {
    console.error('Anthropic error:', lastError)
    return new Response(JSON.stringify({ error: 'Сервис генерации временно недоступен, попробуйте ещё раз через минуту.' }), { status: 502 })
  }

  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''

  const stream = new ReadableStream({
    async start(controller) {
      const reader = upstream.body.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop()
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const data = line.slice(6).trim()
            if (!data || data === '[DONE]') continue
            try {
              const event = JSON.parse(data)
              if (event.type === 'content_block_delta' && event.delta?.text) {
                controller.enqueue(encoder.encode(event.delta.text))
              }
            } catch { /* пропускаем неполные SSE-строки */ }
          }
        }
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-cache',
    },
  })
}
