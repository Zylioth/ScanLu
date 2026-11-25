import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export interface CartLine {
  key: string
  menuItemId: string
  qty: number
  optionIds: string[]
  /** Price per unit including modifiers, captured when added. */
  unitPrice: number
}

interface CartState {
  lines: CartLine[]
  customerName: string
  note: string
  addLine: (line: Omit<CartLine, 'key'>) => void
  setQty: (key: string, qty: number) => void
  removeLine: (key: string) => void
  clear: () => void
  setCustomerName: (name: string) => void
  setNote: (note: string) => void
}

function signature(line: Omit<CartLine, 'key'>): string {
  return `${line.menuItemId}|${[...line.optionIds].sort().join(',')}`
}

export const useCart = create<CartState>()(
  persist(
    (set) => ({
      lines: [],
      customerName: '',
      note: '',

      addLine: (incoming) =>
        set((state) => {
          const sig = signature(incoming)
          const existing = state.lines.find(
            (l) => `${l.menuItemId}|${[...l.optionIds].sort().join(',')}` === sig,
          )
          if (existing) {
            return {
              lines: state.lines.map((l) =>
                l.key === existing.key ? { ...l, qty: l.qty + incoming.qty } : l,
              ),
            }
          }
          return { lines: [...state.lines, { ...incoming, key: crypto.randomUUID() }] }
        }),

      setQty: (key, qty) =>
        set((state) => ({
          lines:
            qty <= 0
              ? state.lines.filter((l) => l.key !== key)
              : state.lines.map((l) => (l.key === key ? { ...l, qty } : l)),
        })),

      removeLine: (key) => set((state) => ({ lines: state.lines.filter((l) => l.key !== key) })),

      clear: () => set({ lines: [], note: '' }),

      setCustomerName: (customerName) => set({ customerName }),

      setNote: (note) => set({ note }),
    }),
    {
      name: 'ohpos.cart',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        lines: state.lines,
        customerName: state.customerName,
        note: state.note,
      }),
    },
  ),
)

export function cartCupCount(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.qty, 0)
}
