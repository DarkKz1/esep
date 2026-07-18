// Стор отчётов НКО поверх Netlify Blobs: один ключ 'all' хранит JSON-массив всех отчётов.
// GET  /api/reports  → { reports: [...] } (сеется из seedData.js при первом обращении)
// POST /api/reports  → { report } (валидация + проставление id/submittedAt/status, unshift в начало)

import { getStore } from '@netlify/blobs'

const store = getStore('esep-reports')

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
      const reports = await readAll()
      return new Response(JSON.stringify({ reports }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
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

      const { org, program, programArea } = payload || {}
      if (!org || !program || !programArea) {
        return new Response(
          JSON.stringify({ error: 'Обязательные поля: org, program, programArea' }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        )
      }

      const reports = await readAll()

      const report = {
        ...payload,
        id: payload.id || makeId(org, program, reports.length),
        submittedAt: payload.submittedAt || new Date().toISOString(),
        status: payload.status || 'submitted',
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
