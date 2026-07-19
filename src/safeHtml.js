import { marked } from 'marked'
import DOMPurify from 'dompurify'

marked.setOptions({ gfm: true, breaks: true })

// Единая точка рендера markdown → безопасный HTML.
// Второй слой защиты (первый — санитизация на сервере при записи в reports.mjs):
// даже если в стор попал заражённый reportMarkdown, DOMPurify вырежет скрипты/обработчики.
export function renderMarkdown(md) {
  return DOMPurify.sanitize(marked.parse(md || ''), { USE_PROFILES: { html: true } })
}
