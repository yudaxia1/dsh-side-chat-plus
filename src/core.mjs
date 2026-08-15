const SIDE_ID_PREFIX = 'sidechat-'
const MAX_QUERY_LENGTH = 400
const DEFAULT_LIMIT = 24
const MAX_LIMIT = 60

class SideChatError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'SideChatError'
    this.code = code
  }
}

function requireSessionId(value, field = 'sessionId') {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new SideChatError('invalid-request', `${field} 必须是非空字符串`)
  }
  return value.trim()
}

function makeSideSessionId(now = Date.now(), random = Math.random()) {
  const entropy = Math.floor(random * 0x100000000).toString(36).padStart(6, '0')
  return `${SIDE_ID_PREFIX}${now.toString(36)}-${entropy}`
}

function isSideSession(header, parentSessionId) {
  return header !== null
    && typeof header === 'object'
    && typeof header.id === 'string'
    && header.id.startsWith(SIDE_ID_PREFIX)
    && header.origin === 'subagent'
    && header.parentSession === parentSessionId
}

function latestRetainedSession(headers, parentSessionId) {
  return [...headers]
    .filter(header => isSideSession(header, parentSessionId))
    .sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0))[0]
}

function flattenText(value, depth = 0) {
  if (depth > 5 || value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(item => flattenText(item, depth + 1)).filter(Boolean).join('\n')
  if (typeof value !== 'object') return ''
  const preferred = ['role', 'name', 'text', 'content', 'message', 'path', 'command', 'query', 'title', 'result']
  const parts = []
  for (const key of preferred) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      const text = flattenText(value[key], depth + 1)
      if (text) parts.push(`${key}: ${text}`)
    }
  }
  if (parts.length > 0) return parts.join('\n')
  return Object.values(value).map(item => flattenText(item, depth + 1)).filter(Boolean).join('\n')
}

function eventText(event) {
  const body = flattenText(event?.data)
  return body === '' ? String(event?.type ?? '') : `${String(event?.type ?? 'event')}\n${body}`
}

function queryTerms(query) {
  return [...new Set(String(query ?? '')
    .toLocaleLowerCase()
    .match(/[\p{L}\p{N}_./\\:-]{2,}/gu) ?? [])]
    .slice(0, 24)
}

function relevance(text, terms) {
  if (terms.length === 0) return 0
  const haystack = text.toLocaleLowerCase()
  let score = 0
  for (const term of terms) {
    let from = 0
    while (true) {
      const at = haystack.indexOf(term, from)
      if (at < 0) break
      score += 1
      from = at + term.length
    }
  }
  return score
}

function selectContextEvents(events, query, requestedLimit = DEFAULT_LIMIT) {
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number(requestedLimit) || DEFAULT_LIMIT))
  const normalized = [...events].map((event, index) => ({
    event,
    index,
    text: eventText(event),
  }))
  if (normalized.length <= limit) return normalized.map(item => item.event)

  const terms = queryTerms(String(query ?? '').slice(0, MAX_QUERY_LENGTH))
  const headCount = Math.min(4, Math.ceil(limit * 0.15))
  const tailCount = Math.min(10, Math.ceil(limit * 0.35))
  const chosen = new Set()
  for (let i = 0; i < headCount; i += 1) chosen.add(i)
  for (let i = Math.max(0, normalized.length - tailCount); i < normalized.length; i += 1) chosen.add(i)

  normalized
    .filter(item => !chosen.has(item.index))
    .map(item => ({ ...item, score: relevance(item.text, terms) }))
    .sort((a, b) => b.score - a.score || b.index - a.index)
    .slice(0, Math.max(0, limit - chosen.size))
    .forEach(item => chosen.add(item.index))

  return [...chosen].sort((a, b) => a - b).map(index => normalized[index].event)
}

function formatContextSnapshot(parentSessionId, events, query) {
  const selected = selectContextEvents(events, query)
  const blocks = selected.map((event, index) => {
    const seq = Number.isFinite(event?.seq) ? event.seq : index
    const text = eventText(event).slice(0, 5000)
    return `[${seq}] ${text}`
  })
  return [
    `主会话 ${parentSessionId} 的按需上下文（只读摘录，不是复制到侧聊的消息）：`,
    `检索问题：${String(query ?? '').slice(0, MAX_QUERY_LENGTH) || '最近上下文'}`,
    ...blocks,
  ].join('\n\n')
}

function normalizeOpenRequest(input) {
  const source = input !== null && typeof input === 'object' ? input : {}
  return {
    parentSessionId: requireSessionId(source.parentSessionId, 'parentSessionId'),
    anchorText: typeof source.anchorText === 'string' ? source.anchorText.trim().slice(0, 8000) : '',
  }
}

function normalizeContextRequest(input) {
  const source = input !== null && typeof input === 'object' ? input : {}
  return {
    query: typeof source.query === 'string' ? source.query.slice(0, MAX_QUERY_LENGTH) : '',
    limit: Math.max(1, Math.min(MAX_LIMIT, Number(source.limit) || DEFAULT_LIMIT)),
  }
}

export {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  SIDE_ID_PREFIX,
  SideChatError,
  eventText,
  formatContextSnapshot,
  isSideSession,
  latestRetainedSession,
  makeSideSessionId,
  normalizeContextRequest,
  normalizeOpenRequest,
  requireSessionId,
  selectContextEvents,
}
