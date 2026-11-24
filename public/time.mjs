export const slots = ['breakfast', 'lunch', 'dinner']
export const initialTimes = { breakfast: '06:00', lunch: '10:00', dinner: '16:30' }
const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh', calendar: 'gregory', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

export function vietnamTime(now = new Date()) {
  const parts = Object.fromEntries(formatter.formatToParts(now).map(part => [part.type, part.value]))
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` }
}

export function nextMeal(now = new Date()) {
  const { date, time } = vietnamTime(now)
  if (time < '09:30') return { date, meal: 'breakfast' }
  if (time < '14:00') return { date, meal: 'lunch' }
  if (time < '21:30') return { date, meal: 'dinner' }
  return { date: vietnamTime(new Date(+now + 12 * 3_600_000)).date, meal: 'breakfast' }
}

export function isDate(date) {
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
    && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().startsWith(date)
}
