// Telegram Bot Webhook 处理器
// 接收和处理来自 Telegram 的消息

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: any;
}

interface TelegramMessage {
  message_id: number;
  from: {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
    language_code?: string;
  };
  chat: {
    id: number;
    type: string;
  };
  date: number;
  text?: string;
  entities?: Array<{
    type: string;
    offset: number;
    length: number;
  }>;
}

interface BotCommand {
  command: string;
  description: string;
  handler: (message: TelegramMessage, supabase: any) => Promise<string>;
}

// 多语言消息模板
const messages = {
  zh: {
    welcome: "欢迎来到TezBarakatTJ！🎉\n\n这是您的专属积分商城平台，您可以：\n• 查看钱包余额\n• 参与精彩积分商城\n• 管理您的彩票\n• 获得专属推荐奖励\n\n输入 /help 查看所有可用命令。",
    help: "🤖 可用命令：\n\n/start - 开始使用\n/help - 帮助信息\n/balance - 查看钱包余额\n/tickets - 查看我的彩票\n/history - 交易历史\n/withdraw - 提现申请\n/deposit - 充值说明\n/referral - 推广信息\n/language - 切换语言\n/support - 客服支持",
    balance_error: "无法获取钱包信息，请稍后重试。",
    user_not_found: "用户未找到，请先在小程序中完成注册。",
    unknown_command: "未知命令，输入 /help 查看可用命令。",
    error: "系统错误，请稍后重试。"
  },
  ru: {
    welcome: "Добро пожаловать в TezBarakatTJ! 🎉\n\nЭто ваша эксклюзивная платформа для участия в розыгрышах, где вы можете:\n• Проверить баланс кошелька\n• Участвовать в захватывающих розыгрышах\n• Управлять вашими билетами\n• Получать эксклюзивные реферальные награды\n\nВведите /help для просмотра всех доступных команд.",
    help: "🤖 Доступные команды:\n\n/start - Начать использование\n/help - Справочная информация\n/balance - Проверить баланс кошелька\n/tickets - Мои билеты\n/history - История транзакций\n/withdraw - Заявка на вывод\n/deposit - Инструкции по пополнению\n/referral - Реферальная информация\n/language - Сменить язык\n/support - Поддержка",
    balance_error: "Невозможно получить информацию о кошельке, попробуйте позже.",
    user_not_found: "Пользователь не найден, пожалуйста, сначала зарегистрируйтесь в мини-приложении.",
    unknown_command: "Неизвестная команда, введите /help для просмотра доступных команд.",
    error: "Системная ошибка, попробуйте позже."
  },
  tg: {
    welcome: "Хуш омадед ба TezBarakatTJ! 🎉\n\nИн платформаи махсуси шумо барои иштирок дар бахтозмоӣ аст, дар ин ҷо шумо метавонед:\n• Боқимондаи ҳамёнро бинед\n• Дар бахтозмоиҳои ҷолиб иштирок кунед\n• Билетҳои худро идора кунед\n• Мукофотҳои махсуси таклифро дарёфт кунед\n\nБарои дидани ҳамаи фармонҳои дастрас /help-ро ворид кунед.",
    help: "🤖 Фармонҳои дастрас:\n\n/start - Оғози истифода\n/help - Маълумоти кумакӣ\n/balance - Боқимондаи ҳамён\n/tickets - Билетҳои ман\n/history - Таърихи муомилот\n/withdraw - Дархости баровардан\n/deposit - Дастури пурсозӣ\n/referral - Маълумоти реферал\n/language - Тағйири забон\n/support - Дастгирӣ",
    balance_error: "Наметавон маълумоти ҳамёнро гирифт, баъдтар кӯшиш кунед.",
    user_not_found: "Корбар ёфт нашуд, лутфан аввал дар барномаи хурд сабтном кунед.",
    unknown_command: "Фармони номаълум, барои дидани фармонҳои дастрас /help-ро ворид кунед.",
    error: "Хатои система, баъдтар кӯшиш кунед."
  }
};

// Bot 命令处理器
const commands: BotCommand[] = [
  {
    command: '/start',
    description: '开始使用Bot',
    handler: async (message: TelegramMessage, supabase: any) => {
      const telegramId = message.from.id.toString();
      const chatId = message.chat.id;
      // 语言检测：优先使用Telegram提供的language_code，默认塔吉克语
      const lang = message.from.language_code?.startsWith('ru') ? 'ru' : 
                   message.from.language_code?.startsWith('zh') ? 'zh' :
                   message.from.language_code?.startsWith('tg') ? 'tg' : 
                   message.from.language_code?.startsWith('en') ? 'ru' : 'tg';

      try {
        // 查找或创建用户的Bot设置
        const { data: settings, error: settingsError } = await supabase
          .from('bot_user_settings')
          .select('*')
          .eq('telegram_chat_id', chatId)
          .single();

        if (settingsError && settingsError.code !== 'PGRST116') {
          console.error('Error fetching bot settings:', settingsError);
        }

        // 如果没有设置记录，查找用户并创建设置
        if (!settings) {
          const { data: user } = await supabase
            .from('users')
            .select('id')
            .eq('telegram_id', telegramId)
            .single();

          if (user) {
            await supabase
              .from('bot_user_settings')
              .insert({
                user_id: user.id,
                telegram_chat_id: chatId,
                language_code: lang
              });
          }
        }

        return messages[lang as keyof typeof messages]?.welcome || messages.zh.welcome;
      } catch (error: unknown) {
    const errMsg = error instanceof Error ? errMsg : String(error);
        console.error('Error in /start command:', error);
        return messages[lang as keyof typeof messages]?.error || messages.zh.error;
      }
    }
  },
  {
    command: '/help',
    description: '显示帮助信息',
    handler: async (message: TelegramMessage, supabase: any) => {
      const lang = await getUserLanguage(message.chat.id, supabase);
      return messages[lang as keyof typeof messages]?.help || messages.zh.help;
    }
  },
  {
    command: '/balance',
    description: '查看钱包余额',
    handler: async (message: TelegramMessage, supabase: any) => {
      const telegramId = message.from.id.toString();
      const lang = await getUserLanguage(message.chat.id, supabase);

      try {
        // 查找用户
        const { data: user } = await supabase
          .from('users')
          .select('id')
          .eq('telegram_id', telegramId)
          .single();

        if (!user) {
          return messages[lang as keyof typeof messages]?.user_not_found || messages.zh.user_not_found;
        }

        /**
         * 获取钱包信息
         * 
         * 钱包类型说明（重要）：
         * - 现金钱包: type='TJS', currency='TJS'
         * - 积分钱包: type='LUCKY_COIN', currency='POINTS'
         * 
         * 注意：数据库字段名是 'type'，不是 'wallet_type'
         */
        const { data: wallets } = await supabase
          .from('wallets')
          .select('type, balance')    // 修复：字段名是'type'，不是'wallet_type'
          .eq('user_id', user.id);

        if (!wallets || wallets.length === 0) {
          return messages[lang as keyof typeof messages]?.balance_error || messages.zh.balance_error;
        }

        // 修复：使用正确的字段名 'type'
        const balanceWallet = wallets.find(w => w.type === 'TJS')?.balance || 0;
        const luckyCoinWallet = wallets.find(w => w.type === 'LUCKY_COIN')?.balance || 0;

        const balanceText = {
          zh: `💰 您的钱包余额：\n\n💵 余额钱包：${balanceWallet} 元\n🍀 积分：${luckyCoinWallet} 枚\n\n点击打开小程序进行充值或交易 →`,
          ru: `💰 Ваш баланс кошелька:\n\n💵 Основной баланс: ${balanceWallet} сом\n🍀 Удачные монеты: ${luckyCoinWallet} шт\n\nНажмите, чтобы открыть мини-приложение для пополнения или торговли →`,
          tg: `💰 Боқимондаи ҳамёни шумо:\n\n💵 Боқимондаи асосӣ: ${balanceWallet} сомонӣ\n🍀 Тангаҳои бахт: ${luckyCoinWallet} дона\n\nБарои пурсозӣ ё савдо барномаи хурдро кушоед →`
        };

        return balanceText[lang as keyof typeof balanceText] || balanceText.zh;
      } catch (error: unknown) {
    const errMsg = error instanceof Error ? errMsg : String(error);
        console.error('Error in /balance command:', error);
        return messages[lang as keyof typeof messages]?.balance_error || messages.zh.balance_error;
      }
    }
  },
  {
    command: '/tickets',
    description: '查看我的彩票',
    handler: async (message: TelegramMessage, supabase: any) => {
      const telegramId = message.from.id.toString();
      const lang = await getUserLanguage(message.chat.id, supabase);

      try {
        const { data: user } = await supabase
          .from('users')
          .select('id')
          .eq('telegram_id', telegramId)
          .single();

        if (!user) {
          return messages[lang as keyof typeof messages]?.user_not_found || messages.zh.user_not_found;
        }

        // 获取用户的彩票
        const { data: entries } = await supabase
          .from('lottery_entries')
          .select(`
            id,
            numbers,
            status,
            lotteries(title, status, draw_time, ticket_price)
          `)
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(10);

        if (!entries || entries.length === 0) {
          const noTicketsText = {
            zh: "🎫 您暂时没有彩票\n\n立即打开小程序参与积分商城吧！",
            ru: "🎫 У вас пока нет билетов\n\nОткройте мини-приложение, чтобы участвовать в розыгрышах!",
            tg: "🎫 Шумо ҳанӯз билет надоред\n\nБарои иштирок дар бахтозмоӣ барномаи хурдро кушоед!"
          };
          return noTicketsText[lang as keyof typeof noTicketsText] || noTicketsText.zh;
        }

        const ticketsText = {
          zh: "🎫 您的彩票 (最近10张)：\n\n",
          ru: "🎫 Ваши билеты (последние 10):\n\n",
          tg: "🎫 Билетҳои шумо (10 тои охирин):\n\n"
        };

        let response = ticketsText[lang as keyof typeof ticketsText] || ticketsText.zh;

        entries.forEach((entry, index) => {
          const statusEmoji = entry.status === 'WON' ? '🏆' : 
                             entry.status === 'LOST' ? '❌' : '⏳';
          response += `${statusEmoji} #${entry.numbers}\n`; // 7位数开奖码
          response += `📊 ${entry.lotteries.title}\n`;
          response += `💰 ${entry.lotteries?.ticket_price || 0}元\n\n`;
        });

        return response;
      } catch (error: unknown) {
    const errMsg = error instanceof Error ? errMsg : String(error);
        console.error('Error in /tickets command:', error);
        return messages[lang as keyof typeof messages]?.error || messages.zh.error;
      }
    }
  }
];

// 获取用户语言设置
async function getUserLanguage(chatId: number, supabase: any): Promise<string> {
  try {
    const { data: settings } = await supabase
      .from('bot_user_settings')
      .select('language_code')
      .eq('telegram_chat_id', chatId)
      .single();

    if (!settings?.language_code) return 'tg';
    const lc = settings.language_code.toLowerCase();
    if (lc.startsWith('ru')) return 'ru';
    if (lc.startsWith('zh')) return 'zh';
    if (lc.startsWith('tg')) return 'tg';
    if (lc.startsWith('en')) return 'ru';
    return 'tg';
  } catch {
    return 'tg';
  }
}

// 发送消息到 Telegram
async function sendTelegramMessage(chatId: number, text: string, botToken: string): Promise<boolean> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML'
      }),
    });

    return response.ok;
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? errMsg : String(error);
    console.error('Error sending Telegram message:', error);
    return false;
  }
}

// 记录Bot消息
async function logBotMessage(
  supabase: any,
  userId: string | null,
  telegramMessageId: number,
  telegramChatId: number,
  messageType: string,
  content: string | null,
  command: string | null,
  responseSent: boolean,
  responseContent: string | null,
  errorMessage: string | null
) {
  try {
    await supabase
      .from('bot_messages')
      .insert({
        user_id: userId,
        telegram_message_id: telegramMessageId,
        telegram_chat_id: telegramChatId,
        message_type: messageType,
        content: content,
        command: command,
        response_sent: responseSent,
        response_content: responseContent,
        error_message: errorMessage
      });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? errMsg : String(error);
    console.error('Error logging bot message:', error);
  }
}

// 更新命令使用统计
async function updateCommandStats(supabase: any, userId: string, command: string) {
  try {
    const { data: existing } = await supabase
      .from('bot_command_stats')
      .select('usage_count')
      .eq('user_id', userId)
      .eq('command', command)
      .single();

    if (existing) {
      await supabase
        .from('bot_command_stats')
        .update({
          usage_count: existing.usage_count + 1,
          last_used_at: new Date().toISOString()
        })
        .eq('user_id', userId)
        .eq('command', command);
    } else {
      await supabase
        .from('bot_command_stats')
        .insert({
          user_id: userId,
          command: command,
          usage_count: 1
        });
    }
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? errMsg : String(error);
    console.error('Error updating command stats:', error);
  }
}

serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE, PATCH',
    'Access-Control-Max-Age': '86400',
    'Access-Control-Allow-Credentials': 'false'
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN') || '8074258399:AAG1WdyCJe4vphx9YB3B6z60nTE3dhBBP-Q';

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body: TelegramUpdate = await req.json();
    console.log('Received Telegram update:', JSON.stringify(body, null, 2));

    if (!body.message) {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const message = body.message;
    const chatId = message.chat.id;
    const telegramId = message.from.id.toString();
    const messageText = message.text || '';

    // 查找用户
    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('telegram_id', telegramId)
      .single();

    let responseText = '';
    let command = null;
    let responseSent = false;
    let errorMessage = null;

    try {
      // 检查是否是命令
      if (messageText.startsWith('/')) {
        command = messageText.split(' ')[0];
        const commandHandler = commands.find(c => c.command === command);

        if (commandHandler) {
          responseText = await commandHandler.handler(message, supabase);
          
          if (user) {
            await updateCommandStats(supabase, user.id, command);
          }
        } else {
          const lang = await getUserLanguage(chatId, supabase);
          responseText = messages[lang as keyof typeof messages]?.unknown_command || messages.zh.unknown_command;
        }
      } else {
        // 处理普通消息
        const lang = await getUserLanguage(chatId, supabase);
        responseText = messages[lang as keyof typeof messages]?.help || messages.zh.help;
      }

      // 发送回复
      responseSent = await sendTelegramMessage(chatId, responseText, botToken);
      
    } catch (error: unknown) {
    const errMsg = error instanceof Error ? errMsg : String(error);
      console.error('Error processing message:', error);
      errorMessage = errMsg;
      const lang = await getUserLanguage(chatId, supabase);
      responseText = messages[lang as keyof typeof messages]?.error || messages.zh.error;
      responseSent = await sendTelegramMessage(chatId, responseText, botToken);
    }

    // 记录消息
    await logBotMessage(
      supabase,
      user?.id || null,
      message.message_id,
      chatId,
      message.text ? 'text' : 'other',
      messageText,
      command,
      responseSent,
      responseText,
      errorMessage
    );

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: unknown) {
    const errMsg = error instanceof Error ? errMsg : String(error);
    console.error('Webhook error:', error);
    return new Response(JSON.stringify({ 
      error: 'Internal server error',
      message: errMsg 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});