import React, { useMemo, useState } from 'react'

// Визуальный слой портала. Палитра категорий валидирована dataviz-скриптом
// (lightness band / chroma floor / CVD ≥ 12 / contrast) и живёт в CSS-переменных
// --cat-0..--cat-5 (один источник: styles.css), SVG читает их через var().

export const AREAS_ORDER = [
  'Economic Development', 'Health', 'Education & STEM',
  'Environment', 'Disaster Preparedness', 'Community Support',
]
const AREA_SHORT = {
  'Economic Development': 'Экономика',
  'Health': 'Здоровье',
  'Education & STEM': 'Образование и STEM',
  'Environment': 'Экология',
  'Disaster Preparedness': 'Готовность к ЧС',
  'Community Support': 'Сообщества',
}

const nf = (n) => (n ?? 0).toLocaleString('ru-RU')

// Города: позиции на упрощённом контуре Казахстана (viewBox 400×240, по геокоординатам).
const CITY_POS = {
  Atyrau: { x: 78, y: 118, labelUp: true },
  Aktau: { x: 63, y: 178 },
  Aktobe: { x: 122, y: 80 },
  Astana: { x: 243, y: 71 },
  Almaty: { x: 291, y: 177 },
}
// Упрощённый узнаваемый контур КЗ (Каспий слева, прямой север, алтайский восток, вырез на юге).
const KZ_PATH = 'M24,67 L46,63 L90,33 L152,29 L222,17 L283,33 L362,75 L380,100 L367,127 L340,151 L318,156 L318,188 L275,181 L239,191 L213,212 L187,200 L152,173 L130,147 L107,155 L103,195 L77,196 L58,160 L66,148 L55,133 L49,128 L26,107 Z'

// Карта: bubble на город, размер = число программ (sqrt-шкала), один hue (магнитуда ≠ радуга).
export function KZMap({ reports }) {
  const [hover, setHover] = useState(null)

  const cities = useMemo(() => {
    const acc = {}
    reports.forEach(r => (r.cities || []).forEach(c => {
      if (!CITY_POS[c]) return
      acc[c] = acc[c] || { programs: 0, reached: 0 }
      acc[c].programs += 1
      acc[c].reached += r.metrics?.peopleReached || 0
    }))
    return acc
  }, [reports])

  const nationwide = useMemo(
    () => reports.filter(r => (r.cities || []).includes('Nationwide')).length,
    [reports],
  )
  const maxPrograms = Math.max(1, ...Object.values(cities).map(c => c.programs))

  return (
    <div className="viz-card">
      <h3>География программ</h3>
      <div className="map-wrap">
        <svg viewBox="0 0 400 240" role="img" aria-label="Карта Казахстана: количество программ по городам">
          <path d={KZ_PATH} className="kz-outline" />
          {Object.entries(cities).map(([name, c]) => {
            const { x, y, labelUp } = CITY_POS[name]
            const r = 6 + Math.sqrt(c.programs / maxPrograms) * 9
            return (
              <g key={name}
                 onMouseEnter={() => setHover({ name, ...c, x, y })}
                 onMouseLeave={() => setHover(null)}>
                {/* хит-таргет больше марка */}
                <circle cx={x} cy={y} r={r + 8} fill="transparent" />
                <circle cx={x} cy={y} r={r} className="city-bubble" />
                <text x={x} y={y + 3.5} className="city-count">{c.programs}</text>
                <text x={x} y={labelUp ? y - r - 6 : y + r + 12} className="city-name">{name}</text>
              </g>
            )
          })}
        </svg>
        {hover && (
          <div className="map-tooltip" style={{ left: `${(hover.x / 400) * 100}%`, top: `${(hover.y / 240) * 100}%` }}>
            <b>{hover.name}</b>
            <span>{hover.programs} программ(ы)</span>
            <span>охват программ: {nf(hover.reached)}</span>
          </div>
        )}
      </div>
      <div className="map-foot">+ {nationwide} программ(ы) работают nationwide — по всей стране</div>
    </div>
  )
}

// Горизонтальные бары: программы по направлениям. Identity-цвета из валидированной
// палитры, прямые лейблы значений (легенда не нужна — имя строки слева).
export function AreaBars({ reports }) {
  const counts = useMemo(() => {
    const acc = {}
    reports.forEach(r => { acc[r.programArea] = (acc[r.programArea] || 0) + 1 })
    return acc
  }, [reports])
  const max = Math.max(1, ...Object.values(counts))

  return (
    <div className="viz-card">
      <h3>Портфель по направлениям</h3>
      <div className="bars">
        {AREAS_ORDER.map((area, i) => {
          const v = counts[area] || 0
          return (
            <div className="bar-row" key={area} title={`${area}: ${v}`}>
              <span className="bar-label">{AREA_SHORT[area]}</span>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${(v / max) * 100}%`, background: `var(--cat-${i})` }} />
                <span className="bar-value">{v}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Кольцо качества данных: статусный цвет (не категориальный), число в центре.
export function QualityRing({ value }) {
  const R = 17
  const C = 2 * Math.PI * R
  const tone = value >= 70 ? 'var(--accent)' : '#8a6d10'
  return (
    <svg className="q-ring" viewBox="0 0 44 44" role="img" aria-label={`Качество данных ${value}%`}>
      <circle cx="22" cy="22" r={R} className="q-track" />
      <circle
        cx="22" cy="22" r={R} className="q-value"
        style={{ stroke: tone, strokeDasharray: `${(value / 100) * C} ${C}` }}
      />
    </svg>
  )
}
