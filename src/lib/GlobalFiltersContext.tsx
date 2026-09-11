'use client'

import { createContext, useContext, useState } from 'react'

type GlobalFilters = {
  entity: 'PMD' | 'Medflix' | ''
  fy: string
  setEntity: (v: 'PMD' | 'Medflix' | '') => void
  setFy: (v: string) => void
}

const GlobalFiltersContext = createContext<GlobalFilters>({
  entity: '',
  fy: '',
  setEntity: () => {},
  setFy: () => {},
})

export function GlobalFiltersProvider({ children }: { children: React.ReactNode }) {
  const [entity, setEntity] = useState<'PMD' | 'Medflix' | ''>('')
  const [fy, setFy] = useState('')

  return (
    <GlobalFiltersContext.Provider value={{ entity, fy, setEntity, setFy }}>
      {children}
    </GlobalFiltersContext.Provider>
  )
}

export function useGlobalFilters() {
  return useContext(GlobalFiltersContext)
}
