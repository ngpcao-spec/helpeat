export function homeAi(env) {
  const url = env.HOME_AI_BRIDGE_URL
  const secret = env.HELPEAT_BRIDGE_SECRET
  if (!url || !secret || secret.length < 32 || !url.startsWith('https://')) return null
  return async (action, payload) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
      signal: AbortSignal.timeout(27_000),
      redirect: 'error',
    })
    if (!response.ok) throw new Error('HOME_AI_UNAVAILABLE')
    return response.json()
  }
}

export async function rank(ai, kind, candidates, context) {
  const fallback = candidates.slice(0, 3)
  if (!ai || candidates.length < 2) return fallback
  const byId = new Map(candidates.map(item => [item.id, item]))
  try {
    const { ids } = await ai('rank', {
      kind, context, candidates: candidates.map(item => ({
        id: item.id, name: item.name, rank: item.rank ?? item.score, familiar: item.familiar, near: item.near,
        issueCount: item.issues?.length ?? item.restaurants?.[0]?.issues.length,
        menu: item.menu, total: item.total,
      })),
    })
    if (!Array.isArray(ids)) return fallback
    const approved = [...new Set(ids)].map(id => byId.get(id)).filter(Boolean).slice(0, 3)
    return approved.length ? approved : fallback
  } catch {
    return fallback
  }
}
