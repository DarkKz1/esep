import React, { useRef, useState } from 'react'
import { marked } from 'marked'
import { demoNotes, demoMeta } from './demoData.js'

marked.setOptions({ gfm: true, breaks: true })

const LOADING_HINTS = [
  'Читаю заметки…',
  'Собираю цифры в таблицу охвата…',
  'Отделяю результаты от мероприятий…',
  'Ищу цитаты участников…',
  'Проверяю, чего не хватает для полного отчёта…',
]

export default function App() {
  const [notes, setNotes] = useState('')
  const [org, setOrg] = useState('')
  const [program, setProgram] = useState('')
  const [donor, setDonor] = useState('')
  const [period, setPeriod] = useState('')
  const [lang, setLang] = useState('ru')
  const [report, setReport] = useState('')
  const [status, setStatus] = useState('idle') // idle | loading | streaming | done | error
  const [error, setError] = useState('')
  const [hintIdx, setHintIdx] = useState(0)
  const [copied, setCopied] = useState(false)
  const [fbOpen, setFbOpen] = useState(false)
  const [fbSent, setFbSent] = useState(false)
  const abortRef = useRef(null)
  const reportRef = useRef(null)

  const fillDemo = () => {
    setNotes(demoNotes)
    setOrg(demoMeta.org)
    setProgram(demoMeta.program)
    setDonor(demoMeta.donor)
    setPeriod(demoMeta.period)
    setError('')
  }

  const generate = async () => {
    if (status === 'loading' || status === 'streaming') return
    setError('')
    setReport('')
    setStatus('loading')
    setHintIdx(0)
    const hintTimer = setInterval(() => setHintIdx(i => (i + 1) % LOADING_HINTS.length), 2200)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ notes, org, program, donor, period, lang }),
        signal: controller.signal,
      })
      if (!res.ok) {
        let msg = 'Что-то пошло не так, попробуйте ещё раз.'
        try { msg = (await res.json()).error || msg } catch { /* no body */ }
        throw new Error(msg)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let acc = ''
      setStatus('streaming')
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        acc += decoder.decode(value, { stream: true })
        setReport(acc)
      }
      setStatus('done')
      setTimeout(() => reportRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
    } catch (e) {
      if (e.name === 'AbortError') { setStatus('idle'); return }
      setError(e.message)
      setStatus('error')
    } finally {
      clearInterval(hintTimer)
    }
  }

  const copyReport = async () => {
    await navigator.clipboard.writeText(report)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const downloadMd = () => {
    const blob = new Blob([report], { type: 'text/markdown;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `otchet-${(program || 'esep').toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '-')}.md`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const submitFeedback = async (e) => {
    e.preventDefault()
    const form = e.target
    const data = new FormData(form)
    await fetch('/', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(data).toString(),
    })
    setFbSent(true)
  }

  const busy = status === 'loading' || status === 'streaming'

  return (
    <div className="app">
      <header className="header no-print">
        <div className="brand">
          <span className="brand-mark">Esep</span>
          <span className="brand-tag">отчёт донору из полевых заметок — за минуту</span>
        </div>
        <button className="ghost-btn" onClick={() => setFbOpen(true)}>Оставить отзыв</button>
      </header>

      <section className="hero no-print">
        <h1>Полевой хаос → отчёт донору</h1>
        <p>
          Вставьте всё как есть: сообщения из WhatsApp, обрывки таблиц, заметки координаторов.
          Esep соберёт из них структурированный отчёт — с цифрами охвата, историями участников
          и честным списком того, каких данных не хватает. Ни одной выдуманной цифры.
        </p>
      </section>

      <main className="layout">
        <section className="pane input-pane no-print">
          <div className="pane-head">
            <h2>1 · Сырые заметки</h2>
            <button className="link-btn" onClick={fillDemo}>Заполнить демо-данными</button>
          </div>

          <div className="meta-grid">
            <input placeholder="Организация" value={org} onChange={e => setOrg(e.target.value)} />
            <input placeholder="Программа / проект" value={program} onChange={e => setProgram(e.target.value)} />
            <input placeholder="Донор" value={donor} onChange={e => setDonor(e.target.value)} />
            <input placeholder="Период (напр. апрель–июнь 2026)" value={period} onChange={e => setPeriod(e.target.value)} />
          </div>

          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder={'Вставьте сюда всё, что есть:\n\n«12.04 тренинг в Атырау, пришло 27 чел…»\n«по анкетам 24 из 27 — полезно»\n«проблема: зал оказался платным…»'}
            rows={14}
          />

          <div className="controls">
            <div className="lang-toggle" role="radiogroup" aria-label="Язык отчёта">
              <button className={lang === 'ru' ? 'active' : ''} onClick={() => setLang('ru')}>Отчёт на русском</button>
              <button className={lang === 'en' ? 'active' : ''} onClick={() => setLang('en')}>Report in English</button>
            </div>
            <button className="primary-btn" onClick={generate} disabled={busy || notes.trim().length < 30}>
              {busy ? 'Готовлю отчёт…' : 'Собрать отчёт'}
            </button>
          </div>
          {notes.trim().length > 0 && notes.trim().length < 30 && (
            <p className="hint">Нужно чуть больше текста — хотя бы пара предложений.</p>
          )}
        </section>

        <section className="pane report-pane" ref={reportRef}>
          <div className="pane-head no-print">
            <h2>2 · Отчёт</h2>
            {status === 'done' && (
              <div className="report-actions">
                <button className="ghost-btn" onClick={copyReport}>{copied ? '✓ Скопировано' : 'Копировать'}</button>
                <button className="ghost-btn" onClick={downloadMd}>Скачать .md</button>
                <button className="ghost-btn" onClick={() => window.print()}>Печать / PDF</button>
              </div>
            )}
          </div>

          {status === 'idle' && (
            <div className="placeholder no-print">
              <p>Здесь появится отчёт.</p>
              <p className="placeholder-sub">Нет своих данных под рукой? Нажмите «Заполнить демо-данными» слева — увидите, как это работает.</p>
            </div>
          )}

          {status === 'loading' && (
            <div className="placeholder no-print">
              <div className="spinner" aria-hidden="true" />
              <p>{LOADING_HINTS[hintIdx]}</p>
            </div>
          )}

          {status === 'error' && (
            <div className="placeholder error no-print">
              <p>{error}</p>
              <button className="ghost-btn" onClick={generate}>Попробовать ещё раз</button>
            </div>
          )}

          {(status === 'streaming' || status === 'done') && (
            <article
              className="report-body"
              dangerouslySetInnerHTML={{ __html: marked.parse(report) }}
            />
          )}
          {status === 'streaming' && <div className="stream-cursor no-print" aria-hidden="true">▍</div>}
        </section>
      </main>

      <footer className="footer no-print">
        <p>
          Esep — бесплатный инструмент для НКО. Заметки не сохраняются на сервере: текст
          обрабатывается и сразу забывается. Сделан за 63 часа на хакатоне nFactorial, июль 2026.
        </p>
      </footer>

      {fbOpen && (
        <div className="modal-backdrop no-print" onClick={e => { if (e.target === e.currentTarget) setFbOpen(false) }}>
          <div className="modal" role="dialog" aria-label="Форма отзыва">
            {fbSent ? (
              <div className="fb-done">
                <h3>Спасибо! 🙌</h3>
                <p>Ваш отзыв поможет сделать Esep полезнее для НКО.</p>
                <button className="primary-btn" onClick={() => setFbOpen(false)}>Закрыть</button>
              </div>
            ) : (
              <form name="feedback" onSubmit={submitFeedback}>
                <input type="hidden" name="form-name" value="feedback" />
                <h3>Отзыв об Esep</h3>
                <label>
                  Кто вы? (роль и организация)
                  <input name="role" required placeholder="напр. координатор программ, ОФ «…»" />
                </label>
                <label>
                  Попробовали собрать отчёт? Что получилось, что нет?
                  <textarea name="experience" required rows={3} />
                </label>
                <label>
                  Чего не хватает, чтобы вы пользовались этим в реальной отчётности?
                  <textarea name="missing" rows={3} />
                </label>
                <label>
                  Оценка от 1 до 5
                  <select name="score" defaultValue="4">
                    <option>5</option><option>4</option><option>3</option><option>2</option><option>1</option>
                  </select>
                </label>
                <label>
                  Контакт для связи (необязательно)
                  <input name="contact" placeholder="телеграм / email" />
                </label>
                <div className="modal-actions">
                  <button type="button" className="ghost-btn" onClick={() => setFbOpen(false)}>Отмена</button>
                  <button type="submit" className="primary-btn">Отправить</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
