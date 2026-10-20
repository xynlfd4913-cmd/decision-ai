export const plans = {
  pack10: {
    id: "pack10",
    title: "体验卡包",
    amount: 990,
    credits: 10,
    plan: "free",
    description: "决策AI 10次深度分析",
  },
  monthly: {
    id: "monthly",
    title: "月度会员",
    amount: 1900,
    credits: 60,
    plan: "free",
    description: "决策AI 月度会员",
  },
  pro: {
    id: "pro",
    title: "Pro会员",
    amount: 3900,
    credits: 0,
    plan: "pro",
    description: "决策AI Pro会员",
  },
};

export function getPlan(planId) {
  return plans[planId] || null;
}
