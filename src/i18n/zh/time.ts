import type { Translation } from '../en'

export const time: Translation['time'] = {
  days: {
    sunday: '周日',
    monday: '周一',
    tuesday: '周二',
    wednesday: '周三',
    thursday: '周四',
    friday: '周五',
    saturday: '周六',
  },
  ordinal: {
    last: '最后一个',
    // e.g. ordinal(-2) interpolates ordinal(2) = '第二个' into '倒数第二个'.
    toLast: '倒数{{ordinal}}',
    first: '第一个',
    second: '第二个',
    third: '第三个',
    nth: '第{{n}}个',
  },
  bydaySeparator: '、',
  bydayWithOrdinal: '{{ordinal}}{{day}}',
  recurrence: {
    weekly: '每{{days}}',
    weeklyAt: '每{{days}} {{time}}',
    weeklyEveryOther: '隔周{{days}}',
    weeklyEveryOtherAt: '隔周{{days}} {{time}}',
    weeklyEveryN: '每{{n}}周{{days}}',
    weeklyEveryNAt: '每{{n}}周{{days}} {{time}}',
    monthly: '每月{{days}}',
    monthlyAt: '每月{{days}} {{time}}',
    recurring: '定期活动',
    recurringAt: '定期活动 {{time}}',
    recurringWithDays: '定期活动（{{days}}）',
    recurringWithDaysAt: '定期活动（{{days}}） {{time}}',
  },
  ongoing: '进行中',
}
