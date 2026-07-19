// Стор отчётов НКО поверх Netlify Blobs: один ключ 'all' хранит JSON-массив всех отчётов.
// GET  /api/reports  → { reports: [...] } (сеется из seedData.js при первом обращении)
// POST /api/reports  → { report } (валидация + проставление id/submittedAt/status, unshift в начало)

import { getStore } from '@netlify/blobs'

const store = getStore('esep-reports')

const AREAS = ['Economic Development', 'Health', 'Education & STEM', 'Environment', 'Disaster Preparedness', 'Community Support']
const CITIES = ['Atyrau', 'Aktau', 'Aktobe', 'Astana', 'Almaty', 'Nationwide']
const SEVERITIES = ['low', 'medium', 'high']

// Портал публичный и self-serve (логина нет намеренно), поэтому POST должен быть БЕЗВРЕДЕН
// при любом входе: вырезаем HTML-теги из всех строк (защита от stored-XSS в reportMarkdown),
// приводим типы, режем длины. Даже сырой curl не сможет ни сломать рендер, ни внедрить скрипт.
// Убираем только настоящие HTML-теги (<tag ...> / </tag>), НЕ трогая одиночный «<» в тексте.
const TAG_RE = /<\/?[a-zA-Z][^>]*>/g
const SCRIPTY_RE = /<\s*(script|style|iframe|object|embed)[\s\S]*?<\s*\/\s*\1\s*>/gi
const stripTags = (s) => String(s ?? '').replace(SCRIPTY_RE, '').replace(TAG_RE, '')
const clean = (s, max) => stripTags(s).slice(0, max).trim()
const cleanMarkdown = (s) => String(s ?? '')
  .replace(/<\s*(script|iframe|object|embed|style|link|meta)[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
  .replace(TAG_RE, '')               // HTML-теги; markdown-синтаксис (#, |, *, > ) не трогается
  .replace(/javascript:/gi, '')
  .slice(0, 50000)
const cleanInt = (n) => (Number.isInteger(n) && n >= 0 && n <= 100000000 ? n : null)
const cleanArr = (a) => (Array.isArray(a) ? a : [])

// Приводит любой (в т.ч. враждебный) payload к валидному, безопасному объекту report.
function sanitizeReport(p) {
  return {
    org: clean(p.org, 160),
    program: clean(p.program, 160),
    programArea: AREAS.includes(p.programArea) ? p.programArea : 'Community Support',
    donor: clean(p.donor || 'Chevron', 80),
    period: clean(p.period, 80),
    cities: cleanArr(p.cities).filter(c => CITIES.includes(c)).slice(0, 6),
    metrics: {
      peopleReached: cleanInt(p.metrics?.peopleReached),
      events: cleanInt(p.metrics?.events),
      budgetSpent: clean(p.metrics?.budgetSpent || '—', 60),
    },
    activities: cleanArr(p.activities).slice(0, 40).map(a => ({
      date: clean(a?.date, 40), city: clean(a?.city, 40), desc: clean(a?.desc, 400),
    })),
    results: clean(p.results, 4000),
    quotes: cleanArr(p.quotes).slice(0, 20).map(q => ({
      text: clean(q?.text, 600), source: clean(q?.source, 120),
    })),
    risks: cleanArr(p.risks).slice(0, 20)
      .map(r => ({ severity: SEVERITIES.includes(r?.severity) ? r.severity : 'medium', desc: clean(r?.desc, 600) }))
      .filter(r => r.desc),
    dataGaps: cleanArr(p.dataGaps).slice(0, 20).map(g => clean(g, 300)).filter(Boolean),
    reportMarkdown: cleanMarkdown(p.reportMarkdown),
  }
}

// Транслитерация не делаем — просто нормализуем строку в безопасный для id кусок:
// нижний регистр, пробелы и спецсимволы → дефис, обрезка повторов/краёв.
function slugify(str) {
  return String(str)
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

// Простой детерминированный хеш строки (djb2-подобный) — БЕЗ Date.now/Math.random,
// нужен только чтобы разные отчёты с одинаковым org+program не схлопнулись в один id.
function hashSuffix(str) {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0
  }
  return hash.toString(36).slice(0, 5)
}

// Короткий суффикс = счётчик (длина текущего массива) + хеш строки — детерминированно и уникально.
function makeId(org, program, count) {
  const base = `${slugify(org)}-${slugify(program)}`
  const suffix = `${count.toString(36)}${hashSuffix(`${org}|${program}|${count}`)}`
  return `${base}-${suffix}`
}

async function readAll() {
  const data = await store.get('all', { type: 'json' })
  if (data == null) {
    // Стор пуст — засеиваем демо-данными.
    const { seedReports } = await import('../../src/seedData.js')
    await store.setJSON('all', seedReports)
    return seedReports
  }
  return data
}

export default async (req) => {
  try {
    if (req.method === 'GET') {
      // Приватная чистка демо-стора к исходным 14 seed (?reseed=<токен>) — на случай, если
      // во время демо накопились тестовые сабмиты. Токен зашит намеренно (проект демо-уровня).
      const url = new URL(req.url)
      if (url.searchParams.get('reseed') === 'esep-demo-2026') {
        const { seedReports } = await import('../../src/seedData.js')
        await store.setJSON('all', seedReports)
        return new Response(JSON.stringify({ reports: seedReports, reseeded: true }), {
          status: 200,
          headers: { 'content-type': 'application/json', 'cache-control': 'no-store, max-age=0' },
        })
      }
      const reports = await readAll()
      return new Response(JSON.stringify({ reports }), {
        status: 200,
        // no-store: после сабмита портал должен сразу видеть новый отчёт (иначе кэш ломает вау-момент).
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store, max-age=0' },
      })
    }

    if (req.method === 'POST') {
      let payload
      try {
        payload = await req.json()
      } catch {
        return new Response(JSON.stringify({ error: 'Некорректный запрос' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        })
      }

      if (!payload || !payload.org || !payload.program) {
        return new Response(
          JSON.stringify({ error: 'Обязательные поля: org, program' }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        )
      }

      // Полная санитизация входа — открытый POST не может навредить порталу.
      const safe = sanitizeReport(payload)
      const { org, program } = safe

      const all = await readAll()
      // Пересдача отчёта той же программы тем же НКО = замена, не дубль
      // (иначе повторные прогоны демо плодили бы копии).
      const reports = all.filter(r => !(r.org === org && r.program === program))

      const report = {
        ...safe,
        id: makeId(org, program, reports.length),
        submittedAt: new Date().toISOString(),
        status: 'submitted',
      }

      reports.unshift(report)
      await store.setJSON('all', reports)

      return new Response(JSON.stringify({ report }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ error: 'Метод не поддерживается' }), {
      status: 405,
      headers: { 'content-type': 'application/json' },
    })
  } catch (err) {
    console.error('reports.mjs error:', err)
    return new Response(JSON.stringify({ error: 'Внутренняя ошибка сервера' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
}
