import { useContext } from 'react'
import { ProductionContext } from './productionContextStore'

export function useProduction() {
  const context = useContext(ProductionContext)
  if (!context) throw new Error('useProduction must be used inside ProductionProvider')
  return context
}
