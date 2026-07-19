import React, { useState } from 'react'
import { renderMarkdown } from './safeHtml.js'
import { demoNotes, demoMeta, demoReport } from './demoData.js'

const nf = (n) => (n ?? 0).toLocaleString('ru-RU')
const reach = (n) => (n == null ? '—' : n.toLocaleString('ru-RU'))

export default function SubmitFlow({ onSubmitted, onFeedback }) {
  const [notes, setNotes] = useState('')
  const [org, setOrg] = useState('')
  const [program, setProgram] = useState('')
  const [donor, setDonor] = useState('Chevron')
  const [period, setPeriod] = useState('')
  const [lang, setLang] = useState('ru')
  const [draft, setDraft] = useState(null)      // извлечённый report до отправки
  const [status, setStatus] = useState('idle')  // idle | extracting | preview | sending | error
  const [error, setError] = useState('')
  const [isDemo, setIsDemo] = useState(false)

  const fillDemo = () => {
    setNotes(demoNotes); setOrg(demoMeta.org); setProgram(demoMeta.program)
    setDonor('Chevron'); setPeriod(demoMeta.period); setError(''); setIsDemo(true)
  }

  const extract = async () => {
    if (status === 'extracting') return
    setError(''); setStatus('extracting'); setDraft(null)

    // Демо-режим: если заметки не менялись после «Заполнить демо-данными», проводим
    // готовый структурированный отчёт локально — сквозной сценарий работает без Anthropic API.
    if (isDemo && notes.trim() === demoNotes.trim()) {
      await new Promise(r => setTimeout(r, 1400)) // имитация обработки, чтобы шаг был виден
      setDraft({ ...demoReport })
      setStatus('preview')
      return
    }

    try {
      const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ notes, org, program, donor, period, lang }),
      })
      if (!res.ok) {
        let msg = 'Не удалось разобрать заметки, попробуйте ещё раз.'
        try { msg = (await res.json()).error || msg } catch { /* no body */ }
        throw new Error(msg)
      }
      const { report } = await res.json()
      setDraft(report)
      setStatus('preview')
    } catch (e) {
      setError(e.message); setStatus('error')
    }
  }

  const send = async () => {
    setStatus('sending')
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(draft),
      })
      if (!res.ok) throw new Error('Не удалось отправить отчёт донору.')
      const { report } = await res.json()
      onSubmitted(report)   // отдаём весь отчёт: портал добавит его оптимистично, без гонки за re-fetch
    } catch (e) {
      setError(e.message); setStatus('error')
    }
  }

  const busy = status === 'extracting' || status === 'sending'

  return (
    <div className="submit-page">
      <header className="cine-header submit-topbar no-print">
        <div className="cine-brand">
          <span className="cine-mark">Esep</span>
          <span className="cine-dot" aria-hidden="true" />
          <span className="cine-brandtag">Вход для НКО</span>
        </div>
        <nav className="cine-nav">
          <a className="cine-navlink" href="#/">← Портал донора</a>
          <button className="cine-navbtn" onClick={onFeedback}>Отзыв</button>
        </nav>
      </header>

      <div className="app submit-body">
      <section className="hero no-print">
        <h1>Полевой хаос → отчёт донору</h1>
        <p>
          Вставьте всё как есть: сообщения из WhatsApp, обрывки таблиц, заметки координаторов.
          Esep структурирует их в отчёт — с цифрами охвата и честным списком того, чего не хватает —
          и отправит донору в общий портал. Ни одной выдуманной цифры.
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
              <button className={lang === 'ru' ? 'active' : ''} onClick={() => setLang('ru')}>RU</button>
              <button className={lang === 'en' ? 'active' : ''} onClick={() => setLang('en')}>EN</button>
            </div>
            <button className="primary-btn" onClick={extract} disabled={busy || notes.trim().length < 30}>
              {status === 'extracting' ? 'Структурирую…' : 'Разобрать заметки'}
            </button>
          </div>
          {notes.trim().length > 0 && notes.trim().length < 30 && (
            <p className="hint">Нужно чуть больше текста — хотя бы пара предложений.</p>
          )}
        </section>

        <section className="pane report-pane">
          <div className="pane-head no-print">
            <h2>2 · Проверьте и отправьте</h2>
            {status === 'preview' && (
              <button className="primary-btn" onClick={send}>Отправить донору →</button>
            )}
          </div>

          {status === 'idle' && (
            <div className="placeholder no-print">
              <p>Здесь появится структурированный отчёт.</p>
              <p className="placeholder-sub">Нет своих данных? Нажмите «Заполнить демо-данными» — увидите, как это работает.</p>
            </div>
          )}
          {status === 'extracting' && (
            <div className="placeholder no-print"><div className="spinner" aria-hidden="true" /><p>Читаю заметки, собираю цифры, ищу пробелы…</p></div>
          )}
          {status === 'sending' && (
            <div className="placeholder no-print"><div className="spinner" aria-hidden="true" /><p>Отправляю на портал донора…</p></div>
          )}
          {status === 'error' && (
            <div className="placeholder error no-print">
              <p>{error}</p>
              <p className="placeholder-sub">Живой разбор произвольного текста требует активного AI-ключа. Хотите увидеть полный проход прямо сейчас — нажмите «Заполнить демо-данными» слева.</p>
              <button className="ghost-btn" onClick={() => setStatus(draft ? 'preview' : 'idle')}>Назад</button>
            </div>
          )}

          {status === 'preview' && draft && (
            <div className="draft">
              <div className="draft-metrics">
                <span className="dm"><b>{reach(draft.metrics?.peopleReached)}</b> {draft.metrics?.peopleReached == null ? 'охват не сведён' : 'охват'}</span>
                <span className="dm"><b>{(draft.cities || []).length}</b> город(а)</span>
                <span className="dm"><b>{draft.activities?.length || 0}</b> мероприятий</span>
                <span className={`dm ${draft.dataGaps?.length ? 'dm-warn' : 'dm-ok'}`}><b>{draft.dataGaps?.length || 0}</b> пробелов в данных</span>
              </div>
              {draft.dataGaps?.length > 0 && (
                <div className="detail-block gap-block">
                  <h4>⚠ Esep отметил, чего не хватает — досчитайте до закрытия периода</h4>
                  <ul>{draft.dataGaps.map((g, i) => <li key={i}>{g}</li>)}</ul>
                </div>
              )}
              <article className="report-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(draft.reportMarkdown) }} />
            </div>
          )}
        </section>
      </main>
      </div>
    </div>
  )
}
