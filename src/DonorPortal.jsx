import React, { useEffect, useMemo, useRef, useState } from 'react'
import { marked } from 'marked'
import { computeSignals, buildDataRequests } from './insights.js'

marked.setOptions({ gfm: true, breaks: true })

const KNOWN_CITIES = ['Atyrau', 'Aktau', 'Aktobe', 'Astana', 'Almaty']
const AREAS = ['Economic Development', 'Health', 'Education & STEM', 'Environment', 'Disaster Preparedness', 'Community Support']

const nf = (n) => (n ?? 0).toLocaleString('ru-RU')
// Охват: null = «не сведено» (принцип «не выдумываем цифры»), НЕ ноль.
const reach = (n) => (n == null ? '—' : n.toLocaleString('ru-RU'))

function aggregate(reports) {
  const totalReached = reports.reduce((s, r) => s + (r.metrics?.peopleReached || 0), 0)
  const programs = new Set(reports.map(r => r.program))
  const orgs = new Set(reports.map(r => r.org))
  const cityCounts = {}
  let nationwide = 0
  reports.forEach(r => (r.cities || []).forEach(c => {
    if (c === 'Nationwide') nationwide++
    else cityCounts[c] = (cityCounts[c] || 0) + 1
  }))
  const risks = { high: 0, medium: 0, low: 0 }
  reports.forEach(r => (r.risks || []).forEach(rk => { risks[rk.severity] = (risks[rk.severity] || 0) + 1 }))
  const dataGapsCount = reports.reduce((s, r) => s + (r.dataGaps?.length || 0), 0)
  const clean = reports.filter(r => !(r.dataGaps?.length) && !(r.risks || []).some(x => x.severity === 'high')).length
  const quality = reports.length ? Math.round((clean / reports.length) * 100) : 100
  const perArea = {}
  reports.forEach(r => { perArea[r.programArea] = (perArea[r.programArea] || 0) + 1 })
  return { totalReached, programs: programs.size, orgs: orgs.size, cityCounts, nationwide, risks, dataGapsCount, quality, perArea }
}

// Плавный count-up к целевому числу (и при смене значения — напр. после нового сабмита).
function useCountUp(target, duration = 900) {
  const [val, setVal] = useState(0)
  const fromRef = useRef(0)
  useEffect(() => {
    const from = fromRef.current
    if (from === target) return
    let raf
    const t0 = performance.now()
    const tick = (t) => {
      const p = Math.min((t - t0) / duration, 1)
      const eased = 1 - Math.pow(1 - p, 3)
      setVal(Math.round(from + (target - from) * eased))
      if (p < 1) raf = requestAnimationFrame(tick)
      else fromRef.current = target
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])
  return val
}

function StatTile({ label, value, raw, suffix = '', sub, tone }) {
  const animated = useCountUp(typeof raw === 'number' ? raw : 0)
  const display = typeof raw === 'number' ? `${animated.toLocaleString('ru-RU')}${suffix}` : value
  return (
    <div className={`stat-tile ${tone || ''}`}>
      <div className="stat-value">{display}</div>
      <div className="stat-label">{label}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

function ReportCard({ r, expanded, onToggle, highlight }) {
  const gaps = r.dataGaps?.length || 0
  const highRisk = (r.risks || []).filter(x => x.severity === 'high').length
  const medRisk = (r.risks || []).filter(x => x.severity === 'medium').length
  return (
    <article className={`report-card ${highlight ? 'is-new' : ''}`}>
      <button className="card-head" onClick={onToggle} aria-expanded={expanded}>
        <div className="card-titles">
          <h3>{r.program}</h3>
          <span className="card-org">{r.org}</span>
        </div>
        <span className={`area-chip area-${AREAS.indexOf(r.programArea)}`}>{r.programArea}</span>
      </button>

      <div className="card-meta">
        <span className="meta-num">{reach(r.metrics?.peopleReached)} <em>{r.metrics?.peopleReached == null ? 'охват не сведён' : 'охват'}</em></span>
        <span className="meta-cities">{(r.cities || []).join(' · ')}</span>
        <span className="meta-period">{r.period}</span>
      </div>

      {(gaps > 0 || highRisk > 0 || medRisk > 0) && (
        <div className="card-flags">
          {highRisk > 0 && <span className="flag flag-risk-high">⚑ {highRisk} риск{highRisk > 1 ? 'а' : ''} · высокий</span>}
          {medRisk > 0 && <span className="flag flag-risk-med">⚑ {medRisk} риск · средний</span>}
          {gaps > 0 && <span className="flag flag-gap">◑ {gaps} пробел{gaps > 1 ? (gaps < 5 ? 'а' : 'ов') : ''} в данных</span>}
        </div>
      )}

      {expanded && (
        <div className="card-body">
          {r.risks?.length > 0 && (
            <div className="detail-block risk-block">
              <h4>Риски</h4>
              <ul>{r.risks.map((x, i) => <li key={i}><b className={`sev sev-${x.severity}`}>{x.severity}</b> {x.desc}</li>)}</ul>
            </div>
          )}
          {r.dataGaps?.length > 0 && (
            <div className="detail-block gap-block">
              <h4>Чего не хватает для полного отчёта</h4>
              <ul>{r.dataGaps.map((g, i) => <li key={i}>{g}</li>)}</ul>
            </div>
          )}
          <div className="report-body" dangerouslySetInnerHTML={{ __html: marked.parse(r.reportMarkdown || '') }} />
        </div>
      )}
    </article>
  )
}

function DonorBrief({ reports }) {
  const signals = useMemo(() => computeSignals(reports), [reports])
  const requests = useMemo(() => buildDataRequests(reports), [reports])
  const [openReq, setOpenReq] = useState(null)
  const [copiedIdx, setCopiedIdx] = useState(null)

  const copyRequest = async (msg, idx) => {
    await navigator.clipboard.writeText(msg)
    setCopiedIdx(idx)
    setTimeout(() => setCopiedIdx(null), 2000)
  }

  if (!signals.length) return null
  return (
    <section className="brief no-print">
      <div className="brief-head">
        <h2>Донорский бриф</h2>
        <span className="brief-badge">пересчитывается на каждом отчёте</span>
      </div>
      <div className="brief-grid">
        {signals.map((s, i) => (
          <div key={i} className={`signal signal-${s.tone}`}>
            <h4>{s.title}</h4>
            <p>{s.text}</p>
            {s.action && <div className="signal-action">→ {s.action}</div>}
          </div>
        ))}
      </div>

      {requests.length > 0 && (
        <div className="requests">
          <h3>Готовые запросы данных к партнёрам</h3>
          <p className="requests-sub">Сформированы автоматически из пробелов в отчётах — скопируйте и отправьте партнёру.</p>
          <div className="requests-list">
            {requests.map((rq, i) => (
              <div key={i} className="request-item">
                <button className="request-head" onClick={() => setOpenReq(openReq === i ? null : i)}>
                  <span><b>{rq.org}</b> · {rq.program}</span>
                  <span className="request-count">{rq.items.length} пункт(а)</span>
                </button>
                {openReq === i && (
                  <div className="request-body">
                    <pre>{rq.message}</pre>
                    <button className="ghost-btn" onClick={() => copyRequest(rq.message, i)}>
                      {copiedIdx === i ? '✓ Скопировано' : 'Копировать запрос'}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

export default function DonorPortal({ reports, loading, newId, onFeedback }) {
  const [area, setArea] = useState('all')
  const [city, setCity] = useState('all')
  const [openId, setOpenId] = useState(null)

  const agg = useMemo(() => aggregate(reports), [reports])

  const filtered = useMemo(() => reports.filter(r =>
    (area === 'all' || r.programArea === area) &&
    (city === 'all' || (r.cities || []).includes(city))
  ), [reports, area, city])

  const needsAttention = useMemo(() =>
    reports.filter(r => (r.risks || []).some(x => x.severity === 'high') || (r.dataGaps?.length || 0) > 0)
      .sort((a, b) => {
        const ah = (a.risks || []).some(x => x.severity === 'high') ? 1 : 0
        const bh = (b.risks || []).some(x => x.severity === 'high') ? 1 : 0
        return bh - ah
      }), [reports])

  return (
    <div className="app">
      <header className="header no-print">
        <div className="brand">
          <span className="brand-mark">Esep</span>
          <span className="brand-tag">Портал импакта · Community Partnership Kazakhstan</span>
        </div>
        <nav className="top-nav">
          <a className="nav-link active" href="#/">Портал донора</a>
          <a className="nav-link" href="#/submit">Сдать отчёт (НКО) →</a>
          <button className="ghost-btn" onClick={onFeedback}>Отзыв</button>
        </nav>
      </header>

      <section className="portal-hero no-print">
        <div className="hero-kicker">FUNDED BY CHEVRON · DELIVERED WITH LOCAL PARTNERS</div>
        <h1>Живая картина импакта — из отчётов партнёров, а не из презентаций</h1>
        <p>
          Каждый партнёр сдаёт отчёт из полевых заметок. Портал сводит их в реальном времени —
          и подсвечивает, где данных не хватает и где риски. То, что раньше собиралось руками неделями.
        </p>
      </section>

      {loading ? (
        <div className="portal-loading">Загружаю отчёты партнёров…</div>
      ) : (
        <>
          <section className="stats-row">
            <StatTile label="Человек охвачено" raw={agg.totalReached} sub="суммарно по программам" />
            <StatTile label="Программ" raw={agg.programs} />
            <StatTile label="Партнёров-НКО" raw={agg.orgs} />
            <StatTile label="Городов + нац. охват" raw={Object.keys(agg.cityCounts).length} sub={`+ ${agg.nationwide} nationwide`} />
            <StatTile label="Качество данных" raw={agg.quality} suffix="%" sub="отчётов без пробелов и высоких рисков"
              tone={agg.quality >= 70 ? 'good' : 'warn'} />
            <StatTile label="Открытых рисков" raw={agg.risks.high + agg.risks.medium + agg.risks.low}
              sub={`${agg.risks.high} высоких · ${agg.risks.medium} средних`}
              tone={agg.risks.high > 0 ? 'danger' : ''} />
          </section>

          <DonorBrief reports={reports} />

          {needsAttention.length > 0 && (
            <section className="attention no-print">
              <div className="attention-head">
                <h2>Требует внимания донора</h2>
                <span className="attention-count">{needsAttention.length}</span>
              </div>
              <p className="attention-sub">Отчёты с рисками или неполными данными — по ним стоит вернуться к партнёру до закрытия периода.</p>
              <div className="attention-grid">
                {needsAttention.map(r => (
                  <button key={r.id} className="attention-item" onClick={() => { setOpenId(r.id); document.getElementById(`rc-${r.id}`)?.scrollIntoView({ behavior: 'smooth' }) }}>
                    <span className="ai-org">{r.org}</span>
                    <span className="ai-prog">{r.program}</span>
                    <span className="ai-tags">
                      {(r.risks || []).some(x => x.severity === 'high') && <em className="t-risk">высокий риск</em>}
                      {(r.dataGaps?.length || 0) > 0 && <em className="t-gap">{r.dataGaps.length} пробел(ов)</em>}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="portfolio">
            <div className="filters no-print">
              <div className="filter-group">
                <label>Направление</label>
                <select value={area} onChange={e => setArea(e.target.value)}>
                  <option value="all">Все</option>
                  {AREAS.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
              <div className="filter-group">
                <label>Город</label>
                <select value={city} onChange={e => setCity(e.target.value)}>
                  <option value="all">Все</option>
                  {KNOWN_CITIES.map(c => <option key={c} value={c}>{c}</option>)}
                  <option value="Nationwide">Nationwide</option>
                </select>
              </div>
              <span className="filter-count">{filtered.length} из {reports.length}</span>
            </div>

            <div className="cards-grid">
              {filtered.map(r => (
                <div id={`rc-${r.id}`} key={r.id}>
                  <ReportCard
                    r={r}
                    expanded={openId === r.id}
                    onToggle={() => setOpenId(openId === r.id ? null : r.id)}
                    highlight={r.id === newId}
                  />
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      <footer className="footer no-print">
        <p>
          Esep — портал сбора и агрегации импакта для доноров и их партнёров-НКО.
          Демо-данные — 14 программ из портфеля Chevron Kazakhstan. Сделано за 63 часа на хакатоне nFactorial, июль 2026.
        </p>
      </footer>
    </div>
  )
}
