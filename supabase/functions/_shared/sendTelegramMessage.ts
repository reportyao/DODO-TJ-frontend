/**
 * 通知消息发送共享模块
 * 【迁移修复】从 Telegram Bot 迁移到 WhatsApp 通知队列
 * 
 * 改动说明：
 * - 移除 Telegram Bot Token 和直接发送逻辑
 * - 改为写入 notification_queue 表，由 whatsapp-notification-sender 统一消费
 * - 用户标识从 telegram_id 改为 phone_number
 * - 保留原有的函数签名和多语言模板以保持向后兼容
 * 
 * 注意：函数名保持为 sendTelegramMessage 以避免修改所有调用方，
 * 但实际已改为写入通知队列。
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.42.0'

// 多语言翻译模板
const translations = {
  zh: {
    commission_earned: (amount: number, level: number) => `恭喜！您获得了 ${amount} TJS 的佣金。来自您的 L${level} 朋友的购买。`,
    purchase_success: (amount: number) => `您成功购买了价值 ${amount} TJS 的彩票份额。祝您好运！`,
    first_deposit_bonus: (amount: number) => `🎉 您的充值赠送 ${amount} 积分已成功到账！`,
  },
  ru: {
    commission_earned: (amount: number, level: number) => `Поздравляем! Вы получили комиссию ${amount} TJS от покупки вашего друга уровня L${level}.`,
    purchase_success: (amount: number) => `Вы успешно приобрели долю лотереи на сумму ${amount} TJS. Удачи!`,
    first_deposit_bonus: (amount: number) => `🎉 Ваш бонус за пополнение ${amount} баллов успешно зачислен!`,
  },
  tg: {
    commission_earned: (amount: number, level: number) => `Табрик! Шумо аз хариди дӯсти сатҳи L${level} комиссияи ${amount} TJS гирифтед.`,
    purchase_success: (amount: number) => `Шумо бомуваффақият ҳиссаи лотореяро ба маблағи ${amount} TJS харидед. Барори кор!`,
    first_deposit_bonus: (amount: number) => `🎉 Ҷоизаи пуркунии шумо ${amount} хол бомуваффақият ба ҳисоб гузошта шуд!`,
  },
}

type NotificationType = 'commission_earned' | 'purchase_success' | 'first_deposit_bonus'

interface NotificationData {
  amount?: number
  level?: number
}

/**
 * 根据用户 ID 获取其 phone_number 和首选语言
 * 【迁移修复】从 telegram_id 改为 phone_number
 */
async function getUserNotificationInfo(userId: string): Promise<{ phone_number: string, preferred_language: string } | null> {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data, error } = await supabase
    .from('users')
    .select('phone_number, preferred_language')
    .eq('id', userId)
    .single()

  if (error || !data || !data.phone_number) {
    console.error(`Failed to get notification info for user ${userId}:`, error)
    return null
  }

  return {
    phone_number: data.phone_number,
    preferred_language: data.preferred_language || 'tg',
  }
}

/**
 * 发送通知消息（写入通知队列）
 * 【迁移修复】原为直接发送 Telegram 消息，现改为写入 notification_queue
 * 
 * @param userId 目标用户 ID
 * @param type 消息类型
 * @param data 消息数据
 */
export async function sendTelegramMessage(
  userId: string,
  type: NotificationType,
  data: NotificationData = {}
): Promise<void> {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const userInfo = await getUserNotificationInfo(userId)
  if (!userInfo) {
    console.log(`[sendTelegramMessage] User ${userId} has no phone_number, skipping notification`)
    return
  }

  const { phone_number, preferred_language } = userInfo
  const lang = preferred_language in translations ? preferred_language as keyof typeof translations : 'tg'
  const t = translations[lang]

  let messageText = ''

  switch (type) {
    case 'commission_earned':
      messageText = t.commission_earned(data.amount || 0, data.level || 0)
      break
    case 'purchase_success':
      messageText = t.purchase_success(data.amount || 0)
      break
    case 'first_deposit_bonus':
      messageText = t.first_deposit_bonus(data.amount || 0)
      break
    default:
      console.error(`Unknown notification type: ${type}`)
      return
  }

  const now = new Date().toISOString()

  try {
    const { error } = await supabase
      .from('notification_queue')
      .insert({
        user_id: userId,
        phone_number: phone_number,
        type: type,
        notification_type: type,
        title: '',
        message: messageText,
        payload: data,
        data: data,
        status: 'pending',
        priority: 2,
        scheduled_at: now,
        created_at: now,
        updated_at: now,
      })

    if (error) {
      console.error(`Failed to queue notification for user ${userId}:`, error)
    } else {
      console.log(`Notification queued for user ${userId}, type: ${type}`)
    }
  } catch (error) {
    console.error('Error queuing notification:', error)
  }
}
