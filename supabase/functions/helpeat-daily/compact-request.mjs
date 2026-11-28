import { checkedRecommendations, providerRequest } from './recommendation.mjs'

const withoutEmpty = record => Object.fromEntries(Object.entries(record).filter(([, value]) =>
  value != null && value !== '' && (!Array.isArray(value) || value.length > 0)))

function sameMeal(recent, confirmed) {
  return recent && confirmed && Object.keys(recent).length === 3 && Array.isArray(recent.dishes) && recent.date === confirmed.date
    && recent.meal === confirmed.meal && recent.dishes.length === confirmed.dishes.length
    && recent.dishes.every((name, index) => name === confirmed.dishes[index])
}

function compactHabits(habits, confirmedMeals) {
  const { byMeal, recent, ...counts } = habits ?? {}
  const summary = withoutEmpty(counts)
  const slots = withoutEmpty(byMeal ?? {})
  if (Object.keys(slots).length) summary.byMeal = slots
  if (recent?.length) {
    if (recent.every((meal, i) => sameMeal(meal, confirmedMeals[i]))) {
      summary.recent_confirmed_meals_prefix_count = recent.length
    } else {
      summary.recent = recent
    }
  }
  return summary
}

export function compactProviderRequest(context, restaurantIdsByDish, settings) {
  const { candidates: original, habits, ...metadata } = context
  const restaurantAliases = new Map()
  const dishIds = new Map()
  const restaurants = {}
  const candidates = original.map((dish, index) => {
    const alias = 'd' + (index + 1)
    dishIds.set(alias, dish.dish_id)
    const ids = restaurantIdsByDish.get(dish.dish_id)
    if (ids?.length !== dish.restaurants.length) throw new Error('Missing candidate restaurant identities')
    return {
      dish_id: alias, name: dish.name,
      ...withoutEmpty({ journal_exact_match: dish.journal_exact_match }),
      restaurants: dish.restaurants.map(({ price_vnd, max_price_vnd, dish_source, availability_verified, ...place }, i) => {
        const id = ids[i]
        if (!restaurantAliases.has(id)) {
          const restaurantId = 'r' + (restaurantAliases.size + 1)
          restaurantAliases.set(id, restaurantId)
          restaurants[restaurantId] = withoutEmpty(place)
        }
        return { restaurant_id: restaurantAliases.get(id),
          ...withoutEmpty({ price_vnd, max_price_vnd, dish_source, availability_verified }) }
      }),
    }
  })
  const summary = compactHabits(habits, context.confirmed_meals)
  const body = providerRequest({
    ...metadata, ...(Object.keys(summary).length ? { habits: summary } : {}), restaurants, candidates,
  }, settings)
  return { body, candidates, dishIds }
}

export function resolveCompactRecommendations(result, compact, originals) {
  const selections = checkedRecommendations(result, compact.candidates)
  if (!selections) return null
  const recommendations = selections.map(({ dish_id, reason }) => ({ dish_id: compact.dishIds.get(dish_id), reason }))
  return checkedRecommendations({ recommendations }, originals)
}
