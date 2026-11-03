import { useEffect, useState } from 'react'
import { Input } from './ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'

interface PageSizeSelectProps {
  value: number
  options: readonly number[]
  onChange: (value: number) => void
  className?: string
}

export function PageSizeSelect({ value, options, onChange, className = '' }: PageSizeSelectProps) {
  const [customValue, setCustomValue] = useState(() => String(value))
  const [customSelected, setCustomSelected] = useState(() => !options.includes(value))
  const isCustom = customSelected || !options.includes(value)

  useEffect(() => {
    if (!isCustom) setCustomValue(String(value))
  }, [isCustom, value])

  const applyCustomValue = () => {
    const parsed = Number(customValue)
    if (Number.isInteger(parsed) && parsed > 0) onChange(parsed)
    else setCustomValue(isCustom ? String(value) : '')
  }

  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <Select
        value={isCustom ? 'custom' : String(value)}
        onValueChange={(selected) => {
          if (selected === 'custom') {
            setCustomSelected(true)
            setCustomValue(isCustom ? String(value) : '')
            return
          }
          setCustomSelected(false)
          onChange(Number(selected))
        }}
      >
        <SelectTrigger className="h-8 w-[78px] text-xs sm:text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="min-w-0 w-[78px]">
          {options.map((option) => (
            <SelectItem key={option} value={String(option)} className="pl-2 text-xs sm:text-sm [&>span:first-child]:hidden">
              {option}
            </SelectItem>
          ))}
          <SelectItem value="custom" className="pl-2 text-xs sm:text-sm [&>span:first-child]:hidden">Custom…</SelectItem>
        </SelectContent>
      </Select>
      {isCustom && (
        <Input
          type="number"
          min="1"
          step="1"
          inputMode="numeric"
          aria-label="Custom items per page"
          value={customValue}
          onChange={(event) => setCustomValue(event.target.value.replace(/[^0-9]/g, ''))}
          onBlur={applyCustomValue}
          onKeyDown={(event) => { if (event.key === 'Enter') applyCustomValue() }}
          className="h-8 w-20 text-xs sm:text-sm"
        />
      )}
    </div>
  )
}
