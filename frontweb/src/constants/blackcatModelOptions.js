export const BLACKCAT_MODEL_OPTION_KEYS = [
  'text',
  'image',
  'storyboard_image',
  'video_classic',
  'video_omni',
]

export const defaultBlackcatModelOptions = {
  text: [
    { label: 'DeepSeek V4（deepseek-v4-pro）', value: 'deepseek-v4-pro' },
  ],
  image: [
    { label: '即梦 4.5（doubao-seedream-4-5-251128）', value: 'doubao-seedream-4-5-251128' },
  ],
  storyboard_image: [
    { label: '即梦 4.5（doubao-seedream-4-5-251128）', value: 'doubao-seedream-4-5-251128' },
  ],
  video_classic: [
    { label: '即梦 Seedance 1.5 Pro（doubao-seedance-1-5-pro-251215）', value: 'doubao-seedance-1-5-pro-251215' },
  ],
  video_omni: [
    { label: '即梦 Seedance 2.0（doubao-seedance-2-0-260128）', value: 'doubao-seedance-2-0-260128' },
  ],
}

function normalizeBlackcatModelOption(item) {
  if (typeof item === 'string') {
    const value = item.trim()
    if (!value) return null
    return { label: value, value }
  }

  const value = String(item?.value || '').trim()
  const label = String(item?.label || value).trim()
  if (!value || !label) return null
  return { label, value }
}

export function normalizeBlackcatModelOptions(rawOptions) {
  return BLACKCAT_MODEL_OPTION_KEYS.reduce((result, key) => {
    const source = Array.isArray(rawOptions?.[key]) ? rawOptions[key] : defaultBlackcatModelOptions[key]
    const normalized = source.map(normalizeBlackcatModelOption).filter(Boolean)

    result[key] = normalized.length ? normalized : defaultBlackcatModelOptions[key]
    return result
  }, {})
}

export function createDefaultBlackcatModelSelections(options = defaultBlackcatModelOptions) {
  return BLACKCAT_MODEL_OPTION_KEYS.reduce((result, key) => {
    result[key] = options[key]?.[0]?.value || ''
    return result
  }, {})
}

export async function loadBlackcatModelOptions() {
  const requestUrl = `/api/v1/settings/blackcat-model-options?_=${Date.now()}`

  try {
    const response = await fetch(requestUrl, { cache: 'no-store' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const json = await response.json()
    return normalizeBlackcatModelOptions(json?.data || json)
  } catch (_) {
    return normalizeBlackcatModelOptions(defaultBlackcatModelOptions)
  }
}