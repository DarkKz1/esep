import React, { useEffect, useState, useCallback } from 'react'
import DonorPortal from './DonorPortal.jsx'
import SubmitFlow from './SubmitFlow.jsx'
import FeedbackModal from './FeedbackModal.jsx'

// Лёгкий хеш-роутер без внешних зависимостей.
function useHashRoute() {
  const [hash, setHash] = useState(window.location.hash)
  useEffect(() => {
    const onChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return hash
}

export default function App() {
  const hash = useHashRoute()
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [newId, setNewId] = useState(null)
  const [fbOpen, setFbOpen] = useState(false)

  const loadReports = useCallback(async () => {
    try {
      const res = await fetch(`/api/reports?t=${Date.now()}`, { cache: 'no-store' })
      const data = await res.json()
      setReports(data.reports || [])
    } catch {
      setReports([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadReports() }, [loadReports])

  // После отправки отчёта НКО — обновить список, подсветить новый, уйти на портал.
  const handleSubmitted = useCallback(async (id) => {
    setNewId(id)
    setLoading(true)
    await loadReports()
    window.location.hash = '#/'
    window.scrollTo({ top: 0 })
    setTimeout(() => setNewId(null), 6000)
  }, [loadReports])

  const isSubmit = hash === '#/submit'

  return (
    <>
      {isSubmit ? (
        <SubmitFlow onSubmitted={handleSubmitted} onFeedback={() => setFbOpen(true)} />
      ) : (
        <DonorPortal reports={reports} loading={loading} newId={newId} onFeedback={() => setFbOpen(true)} />
      )}
      {fbOpen && <FeedbackModal onClose={() => setFbOpen(false)} />}
    </>
  )
}
