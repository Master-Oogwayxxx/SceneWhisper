import type { ExternalVideoTarget } from '@/types/types'

const VIDEO_CODE_PLACEHOLDER = '{videoCode}'
const ACTRESS_PLACEHOLDER = '{actress}'

export function getExternalVideoCodeFromFileName(fileName: string): string {
  const extensionIndex = fileName.lastIndexOf('.')
  const stem = extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName
  const splitMatch = stem.match(/^(.+-\d{2,6}(?:-(?:RM|SUB))*)-\d{3}$/i)
  const baseStem = splitMatch ? splitMatch[1] : stem

  return baseStem.replace(/(?:-(?:RM|SUB))+$/i, '')
}

export function isValidExternalVideoTarget(target: ExternalVideoTarget): boolean {
  return target.label.trim().length > 0 &&
    target.url_template.trim().length > 0 &&
    target.url_template.includes(VIDEO_CODE_PLACEHOLDER)
}

export function buildExternalVideoTargetUrl(target: ExternalVideoTarget, videoCode: string, actressName = ''): string {
  return target.url_template
    .split(VIDEO_CODE_PLACEHOLDER).join(encodeURIComponent(videoCode))
    .split(ACTRESS_PLACEHOLDER).join(encodeURIComponent(actressName))
}
