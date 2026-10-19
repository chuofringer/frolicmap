import type { DetailData } from '../useDetailData'
import type { ListItem } from '@shared/types'

const listItem: ListItem = {
  id: 'pg-1',
  type: 'place',
  name: "Koret Children's Playground",
  category: 'playground',
  lat: 37.769,
  lng: -122.456,
  age_min: 1,
  age_max: 12,
  cost: 'free',
  indoor: 0,
  status: 'approved',
  city: null,
  has_playground: null,
  name_zh: null,
}

// A fully-populated DetailData with NO photo — the primary fixture, exercising
// the compact badge-row header path.
export function makeDetailData(overrides: Partial<DetailData> = {}): DetailData {
  return {
    id: 'pg-1',
    listItem,
    detail: undefined,
    detailFailed: false,
    detailRetryable: false,
    retryDetail: () => {},
    detailRetrying: false,
    meta: { emoji: '🎢', color: '#f59e0b' },
    categoryName: 'Playground',
    emoji: '🎢',
    distanceLabel: '0.8 mi',
    address: 'Bowling Green Dr, Golden Gate Park, San Francisco',
    description: 'Historic 1888 playground with a concrete slide and carousel.',
    website: 'https://sfrecpark.org',
    sourceUrl: 'https://sfrecpark.org',
    sourceHost: 'sfrecpark.org',
    lastVerified: '2026-07-02',
    googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=Koret',
    appleMapsUrl: 'https://maps.apple.com/?q=Koret',
    priceUsd: null,
    isFree: true,
    indoor: 0,
    ageLabel: 'Ages 1–12',
    hoursValue: 'Open daily · 7:00 AM – 6:00 PM',
    hoursUnknown: false,
    goodToKnow: [{ label: 'Restrooms nearby', state: 'yes' }],
    openUntil: '6 PM',
    shareUrl: 'https://frolicmap.app/?item=pg-1',
    ...overrides,
  }
}
