// Аналитический движок портфеля: детерминированные инсайты из структурированных отчётов.
// Работает на любых данных (seed или живые сабмиты) без внешних вызовов — LLM структурирует
// на входе (extract.mjs), здесь считается интеллект поверх: аномалии, концентрация,
// риск-экспозиция, автозапросы к партнёрам по пробелам данных.

const nf = (n) => (n ?? 0).toLocaleString('ru-RU')

// Ключевые сигналы портфеля, отсортированные по важности для донора.
export function computeSignals(reports) {
  const signals = []
  if (!reports.length) return signals

  const reached = reports.map(r => r.metrics?.peopleReached || 0)
  const total = reached.reduce((s, n) => s + n, 0)

  // 1. Высокие риски — всегда первым сигналом.
  const highRisk = reports.filter(r => (r.risks || []).some(x => x.severity === 'high'))
  highRisk.forEach(r => {
    const risk = r.risks.find(x => x.severity === 'high')
    signals.push({
      tone: 'risk',
      title: `${r.org} — высокий риск`,
      text: risk.desc,
      action: `Связаться с «${r.org}» до закрытия периода`,
    })
  })

  // 2. Концентрация охвата: один контрибьютор > 15% портфеля.
  if (total > 0) {
    const top = reports.reduce((a, b) => ((a.metrics?.peopleReached || 0) > (b.metrics?.peopleReached || 0) ? a : b))
    const share = Math.round(((top.metrics?.peopleReached || 0) / total) * 100)
    if (share >= 15) {
      signals.push({
        tone: 'info',
        title: `Концентрация охвата: ${share}% даёт одна программа`,
        text: `«${top.program}» (${top.org}) — ${nf(top.metrics.peopleReached)} из ${nf(total)}. Итоговая цифра портфеля чувствительна к качеству данных этой программы.`,
        action: `Приоритетно верифицировать данные «${top.program}»`,
      })
    }
  }

  // 3. Несведённый охват: программы с peopleReached = null.
  const unknown = reports.filter(r => r.metrics?.peopleReached == null)
  if (unknown.length > 0) {
    signals.push({
      tone: 'gap',
      title: `${unknown.length} программ${unknown.length === 1 ? 'а' : ''} без сведённого охвата`,
      text: `${unknown.map(r => `«${r.program}»`).join(', ')} — охват не входит в итоговые ${nf(total)}. Реальная цифра портфеля выше отображаемой.`,
      action: 'Запросить сведение листов регистрации',
    })
  }

  // 4. Покрытие обратной связи/пробелы по программам с наибольшим охватом.
  const bigWithGaps = reports
    .filter(r => (r.dataGaps?.length || 0) > 0 && (r.metrics?.peopleReached || 0) > 0)
    .sort((a, b) => (b.metrics?.peopleReached || 0) - (a.metrics?.peopleReached || 0))[0]
  if (bigWithGaps) {
    signals.push({
      tone: 'gap',
      title: `Крупная программа с неполными данными`,
      text: `«${bigWithGaps.program}» (${nf(bigWithGaps.metrics.peopleReached)} охвата) несёт ${bigWithGaps.dataGaps.length} пробел(а) в данных — риск для консолидированной отчётности.`,
      action: `Отправить запрос данных в «${bigWithGaps.org}»`,
    })
  }

  // 5. Здоровая часть портфеля — позитивный сигнал в конец.
  const clean = reports.filter(r => !(r.dataGaps?.length) && !(r.risks || []).length)
  if (clean.length > 0) {
    signals.push({
      tone: 'good',
      title: `${clean.length} из ${reports.length} отчётов — полные и без рисков`,
      text: 'Эти программы готовы к консолидации в годовой отчёт без дополнительных запросов.',
      action: null,
    })
  }

  return signals
}

// Автогенерация готовых запросов к партнёрам по каждому пробелу данных.
// Возвращает [{org, program, items: [строки-пробелы], message: готовый текст письма}]
export function buildDataRequests(reports) {
  return reports
    .filter(r => (r.dataGaps?.length || 0) > 0)
    .map(r => ({
      org: r.org,
      program: r.program,
      items: r.dataGaps,
      message: `Здравствуйте!

Спасибо за отчёт по программе «${r.program}» за ${r.period}. Для консолидации в отчёт донора просим досчитать и прислать:

${r.dataGaps.map((g, i) => `${i + 1}. ${g}`).join('\n')}

Это позволит включить вашу программу в сводные показатели без оговорок.

С уважением, команда программы`,
    }))
}
