/**
 * ============================================================================
 * 异步事件队列 - 共享工具模块
 * ============================================================================
 *
 * 本模块提供事件队列的读写工具函数，供所有 Edge Functions 复用。
 *
 * 设计原则:
 *   1. 幂等性: 通过 idempotency_key 确保同一事件不会被重复写入或处理
 *   2. 可靠性: 支持重试机制和死信队列
 *   3. 可复用: 任何 Edge Function 都可以通过 enqueueEvent() 写入事件
 *   4. 类型安全: 使用 TypeScript 类型定义确保 payload 结构正确
 *
 * 使用方式:
 *   import { enqueueEvent, enqueueEvents, EventType } from '../_shared/eventQueue.ts';
 *
 *   // 写入单个事件
 *   await enqueueEvent(supabase, {
 *     event_type: EventType.COMMISSION,
 *     source: 'group-buy-squad',
 *     payload: { order_id: '...', user_id: '...', order_amount: 10 },
 *     idempotency_key: 'squad:COMMISSION:order_abc123',
 *     session_id: '...',
 *     user_id: '...',
 *   });
 *
 *   // 批量写入事件
 *   await enqueueEvents(supabase, [event1, event2, event3]);
 *
 * 注意事项:
 *   - 本模块使用 Supabase client (service_role) 进行数据库操作
 *   - 所有写入操作都使用 upsert + ON CONFLICT 确保幂等性
 *   - Worker 消费事件时使用 dequeueEvents() 获取待处理事件
 * ============================================================================
 */

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 事件类型枚举
 * 定义所有支持的异步事件类型
 *
 * 命名规范: 使用大写下划线格式，与数据库中的 event_type 字段值一致
 * 扩展方式: 新增业务场景时，在此处添加新的事件类型即可
 */
export enum EventType {
  /** 推荐佣金处理 - 为推荐人发放三级分销佣金 */
  COMMISSION = 'COMMISSION',
  /** AI 对话奖励 - 增加用户的 AI 对话配额 */
  AI_REWARD = 'AI_REWARD',
  /** 首次拼团奖励 - 给邀请人增加抽奖机会 */
  FIRST_GROUP_BUY = 'FIRST_GROUP_BUY',
  /** 中奖通知 - 发送 Telegram/站内通知 */
  NOTIFICATION = 'NOTIFICATION',
  /** B2B 新订单 - 通知管理后台有新的批发订单 */
  B2B_NEW_ORDER = 'B2B_NEW_ORDER',
}

/**
 * 事件状态枚举
 * 状态流转: pending -> processing -> completed / failed
 */
export enum EventStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

/**
 * 推荐佣金事件的 payload 结构
 * 对应 handle-purchase-commission 的请求参数
 */
export interface CommissionPayload {
  order_id: string;
  user_id: string;
  order_amount: number;
}

/**
 * AI 对话奖励事件的 payload 结构
 * 对应 ai-add-bonus 的请求参数
 */
export interface AiRewardPayload {
  user_id: string;
  amount: number;
  reason: string;
}

/**
 * 首次拼团奖励事件的 payload 结构
 * 对应 handle-first-group-buy-reward 的请求参数
 */
export interface FirstGroupBuyPayload {
  user_id: string;
  order_id: string;
}

/**
 * 中奖通知事件的 payload 结构
 * 对应 notification_queue 表的插入数据
 */
export interface NotificationPayload {
  user_id: string;
  type: string;
  product_name: string;
  session_code: string;
  won_at: string;
  is_squad_buy: boolean;
}

/**
 * 事件 payload 的联合类型
 * 根据 event_type 确定具体的 payload 结构
 */
export type EventPayload =
  | CommissionPayload
  | AiRewardPayload
  | FirstGroupBuyPayload
  | NotificationPayload;

/**
 * 写入事件队列的参数结构
 */
export interface EnqueueEventParams {
  /** 事件类型 */
  event_type: EventType;
  /** 事件来源（产生事件的 Edge Function 名称） */
  source: string;
  /** 事件负载（业务数据） */
  payload: EventPayload | Record<string, unknown>;
  /** 幂等键（确保不重复写入），格式建议: "source:type:business_id" */
  idempotency_key: string;
  /** 关联的会话 ID（可选） */
  session_id?: string;
  /** 关联的用户 ID（可选） */
  user_id?: string;
  /** 计划处理时间（可选，默认立即处理） */
  scheduled_at?: string;
  /** 最大重试次数（可选，默认 3 次） */
  max_retries?: number;
}

/**
 * 从队列中取出的事件结构
 */
export interface QueuedEvent {
  id: string;
  event_type: EventType;
  source: string;
  payload: Record<string, unknown>;
  idempotency_key: string;
  status: EventStatus;
  retry_count: number;
  max_retries: number;
  last_error: string | null;
  session_id: string | null;
  user_id: string | null;
  created_at: string;
}

// ============================================================================
// 写入事件（生产者端）
// ============================================================================

/**
 * 写入单个事件到队列
 *
 * 使用 upsert 确保幂等性：如果 idempotency_key 已存在，不会重复写入。
 * 这意味着即使 group-buy-squad 因为某种原因重试，也不会产生重复事件。
 *
 * @param supabase - Supabase client (必须使用 service_role key)
 * @param event - 事件参数
 * @returns 写入结果
 *
 * @example
 * await enqueueEvent(supabase, {
 *   event_type: EventType.COMMISSION,
 *   source: 'group-buy-squad',
 *   payload: { order_id: 'abc', user_id: 'def', order_amount: 10 },
 *   idempotency_key: 'squad:COMMISSION:abc',
 *   session_id: 'session-uuid',
 *   user_id: 'user-uuid',
 * });
 */
export async function enqueueEvent(
  supabase: any,
  event: EnqueueEventParams,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('event_queue')
      .upsert(
        {
          event_type: event.event_type,
          source: event.source,
          payload: event.payload,
          idempotency_key: event.idempotency_key,
          status: EventStatus.PENDING,
          retry_count: 0,
          max_retries: event.max_retries ?? 3,
          session_id: event.session_id || null,
          user_id: event.user_id || null,
          scheduled_at: event.scheduled_at || new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          // 如果 idempotency_key 冲突，不更新（保持幂等）
          onConflict: 'idempotency_key',
          ignoreDuplicates: true,
        },
      );

    if (error) {
      console.error(`[EventQueue] Failed to enqueue event (${event.event_type}):`, error);
      return { success: false, error: error.message };
    }

    console.log(
      `[EventQueue] Enqueued: type=${event.event_type}, source=${event.source}, key=${event.idempotency_key}`,
    );
    return { success: true };
  } catch (err: any) {
    console.error(`[EventQueue] Unexpected error enqueuing event:`, err);
    return { success: false, error: err.message };
  }
}

/**
 * 批量写入事件到队列
 *
 * 使用单次 upsert 操作批量写入，减少数据库往返次数。
 * 同样通过 idempotency_key 确保幂等性。
 *
 * @param supabase - Supabase client (必须使用 service_role key)
 * @param events - 事件参数数组
 * @returns 写入结果
 *
 * @example
 * // 一键包团时批量写入所有异步事件
 * await enqueueEvents(supabase, [
 *   { event_type: EventType.COMMISSION, source: 'group-buy-squad', ... },
 *   { event_type: EventType.AI_REWARD, source: 'group-buy-squad', ... },
 *   { event_type: EventType.FIRST_GROUP_BUY, source: 'group-buy-squad', ... },
 *   { event_type: EventType.NOTIFICATION, source: 'group-buy-squad', ... },
 * ]);
 */
export async function enqueueEvents(
  supabase: any,
  events: EnqueueEventParams[],
): Promise<{ success: boolean; enqueued: number; errors: string[] }> {
  const errors: string[] = [];
  let enqueued = 0;

  // 构建批量插入数据
  const rows = events.map((event) => ({
    event_type: event.event_type,
    source: event.source,
    payload: event.payload,
    idempotency_key: event.idempotency_key,
    status: EventStatus.PENDING,
    retry_count: 0,
    max_retries: event.max_retries ?? 3,
    session_id: event.session_id || null,
    user_id: event.user_id || null,
    scheduled_at: event.scheduled_at || new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));

  try {
    const { data, error } = await supabase
      .from('event_queue')
      .upsert(rows, {
        onConflict: 'idempotency_key',
        ignoreDuplicates: true,
      })
      .select('id');

    if (error) {
      console.error(`[EventQueue] Batch enqueue failed:`, error);
      errors.push(error.message);
    } else {
      enqueued = data?.length ?? rows.length;
      console.log(`[EventQueue] Batch enqueued: ${enqueued} events from ${events[0]?.source}`);
    }
  } catch (err: any) {
    console.error(`[EventQueue] Unexpected batch enqueue error:`, err);
    errors.push(err.message);
  }

  return {
    success: errors.length === 0,
    enqueued,
    errors,
  };
}

// ============================================================================
// 消费事件（Worker 端）
// ============================================================================

/**
 * 从队列中取出待处理的事件
 *
 * 使用 "SELECT ... FOR UPDATE SKIP LOCKED" 模式确保并发安全：
 * - FOR UPDATE: 锁定选中的行，防止其他 Worker 同时处理
 * - SKIP LOCKED: 跳过已被锁定的行，避免等待
 *
 * 注意: Supabase JS client 不直接支持 FOR UPDATE SKIP LOCKED，
 * 因此这里使用 RPC 或分步操作来模拟。
 *
 * @param supabase - Supabase client (必须使用 service_role key)
 * @param batchSize - 每次取出的事件数量（默认 10）
 * @param workerId - Worker 实例标识（用于锁定）
 * @returns 待处理的事件列表
 */
export async function dequeueEvents(
  supabase: any,
  batchSize: number = 10,
  workerId: string = `worker-${Date.now()}`,
): Promise<QueuedEvent[]> {
  const now = new Date().toISOString();

  try {
    // 步骤 1: 查找待处理的事件（状态为 pending，且计划时间已到）
    const { data: pendingEvents, error: selectError } = await supabase
      .from('event_queue')
      .select('id')
      .eq('status', EventStatus.PENDING)
      .lte('scheduled_at', now)
      .is('locked_by', null)
      .order('created_at', { ascending: true })
      .limit(batchSize);

    if (selectError || !pendingEvents || pendingEvents.length === 0) {
      return [];
    }

    const eventIds = pendingEvents.map((e: any) => e.id);

    // 步骤 2: 尝试锁定这些事件（使用乐观锁模式）
    // 只更新 status 仍为 pending 且 locked_by 仍为 null 的行
    const { data: lockedEvents, error: lockError } = await supabase
      .from('event_queue')
      .update({
        status: EventStatus.PROCESSING,
        locked_by: workerId,
        locked_at: now,
        updated_at: now,
      })
      .in('id', eventIds)
      .eq('status', EventStatus.PENDING)
      .is('locked_by', null)
      .select('*');

    if (lockError) {
      console.error(`[EventQueue] Failed to lock events:`, lockError);
      return [];
    }

    if (lockedEvents && lockedEvents.length > 0) {
      console.log(
        `[EventQueue] Dequeued ${lockedEvents.length} events (worker: ${workerId})`,
      );
    }

    return lockedEvents || [];
  } catch (err: any) {
    console.error(`[EventQueue] Unexpected dequeue error:`, err);
    return [];
  }
}

// ============================================================================
// 更新事件状态（Worker 端）
// ============================================================================

/**
 * 标记事件处理完成
 *
 * @param supabase - Supabase client
 * @param eventId - 事件 ID
 */
export async function markEventCompleted(
  supabase: any,
  eventId: string,
): Promise<void> {
  const { error } = await supabase
    .from('event_queue')
    .update({
      status: EventStatus.COMPLETED,
      processed_at: new Date().toISOString(),
      locked_by: null,
      locked_at: null,
    })
    .eq('id', eventId);

  if (error) {
    console.error(`[EventQueue] Failed to mark event ${eventId} as completed:`, error);
  } else {
    console.log(`[EventQueue] Event ${eventId} completed`);
  }
}

/**
 * 标记事件处理失败，并决定是重试还是转入死信队列
 *
 * 逻辑:
 *   - 如果 retry_count < max_retries: 重置为 pending 状态，等待下次重试
 *   - 如果 retry_count >= max_retries: 转入 dead_letter_queue
 *
 * @param supabase - Supabase client
 * @param event - 当前事件
 * @param errorMessage - 错误消息
 */
export async function markEventFailed(
  supabase: any,
  event: QueuedEvent,
  errorMessage: string,
): Promise<void> {
  const newRetryCount = event.retry_count + 1;

  if (newRetryCount < event.max_retries) {
    // 还有重试机会：重置为 pending，增加 retry_count
    // 使用指数退避策略计算下次重试时间
    const backoffSeconds = Math.min(30 * Math.pow(2, newRetryCount), 300); // 最大 5 分钟
    const nextRetryAt = new Date(Date.now() + backoffSeconds * 1000).toISOString();

    const { error } = await supabase
      .from('event_queue')
      .update({
        status: EventStatus.PENDING,
        retry_count: newRetryCount,
        last_error: errorMessage,
        locked_by: null,
        locked_at: null,
        scheduled_at: nextRetryAt,
      })
      .eq('id', event.id);

    if (error) {
      console.error(`[EventQueue] Failed to update retry for event ${event.id}:`, error);
    } else {
      console.log(
        `[EventQueue] Event ${event.id} will retry (${newRetryCount}/${event.max_retries}) at ${nextRetryAt}`,
      );
    }
  } else {
    // 重试次数耗尽：转入死信队列
    await moveToDeadLetterQueue(supabase, event, errorMessage);
  }
}

/**
 * 将事件转入死信队列
 *
 * 当事件多次重试仍然失败时调用此函数。
 * 死信队列中的事件需要人工介入排查。
 *
 * @param supabase - Supabase client
 * @param event - 失败的事件
 * @param finalError - 最终的错误消息
 */
async function moveToDeadLetterQueue(
  supabase: any,
  event: QueuedEvent,
  finalError: string,
): Promise<void> {
  try {
    // 1. 写入死信队列
    const { error: dlqError } = await supabase
      .from('dead_letter_queue')
      .insert({
        original_event_id: event.id,
        event_type: event.event_type,
        source: event.source,
        payload: event.payload,
        idempotency_key: event.idempotency_key,
        error_history: [
          {
            attempt: event.retry_count + 1,
            error: finalError,
            timestamp: new Date().toISOString(),
          },
        ],
        final_error: finalError,
        total_retries: event.retry_count + 1,
        session_id: event.session_id,
        user_id: event.user_id,
      });

    if (dlqError) {
      console.error(`[EventQueue] Failed to insert into dead_letter_queue:`, dlqError);
    }

    // 2. 更新原事件状态为 failed
    const { error: updateError } = await supabase
      .from('event_queue')
      .update({
        status: EventStatus.FAILED,
        last_error: finalError,
        locked_by: null,
        locked_at: null,
        processed_at: new Date().toISOString(),
      })
      .eq('id', event.id);

    if (updateError) {
      console.error(`[EventQueue] Failed to mark event ${event.id} as failed:`, updateError);
    }

    console.error(
      `[EventQueue] ⚠️ Event ${event.id} moved to dead_letter_queue after ${event.retry_count + 1} retries. Type: ${event.event_type}, Error: ${finalError}`,
    );
  } catch (err: any) {
    console.error(`[EventQueue] Critical: Failed to move event to DLQ:`, err);
  }
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 生成幂等键
 *
 * 统一的幂等键生成规则，确保各个调用方使用一致的格式。
 *
 * @param source - 事件来源（如 'squad', 'join', 'lottery'）
 * @param eventType - 事件类型
 * @param businessId - 业务唯一标识（如 order_id, session_id）
 * @param suffix - 可选后缀（用于区分同一业务的多个同类型事件）
 * @returns 格式化的幂等键
 *
 * @example
 * generateIdempotencyKey('squad', EventType.COMMISSION, 'order-uuid-123');
 * // => "squad:COMMISSION:order-uuid-123"
 *
 * generateIdempotencyKey('squad', EventType.COMMISSION, 'order-uuid-123', 'bot1');
 * // => "squad:COMMISSION:order-uuid-123:bot1"
 */
export function generateIdempotencyKey(
  source: string,
  eventType: EventType,
  businessId: string,
  suffix?: string,
): string {
  const parts = [source, eventType, businessId];
  if (suffix) {
    parts.push(suffix);
  }
  return parts.join(':');
}

/**
 * 释放超时的锁
 *
 * 如果某个 Worker 在处理事件时崩溃，事件会一直处于 processing 状态。
 * 此函数用于释放超过指定时间的锁，使事件可以被其他 Worker 重新处理。
 *
 * 建议通过定时任务（如 pg_cron 或 Supabase Cron）每 5 分钟调用一次。
 *
 * @param supabase - Supabase client
 * @param timeoutMinutes - 锁超时时间（分钟），默认 5 分钟
 * @returns 释放的事件数量
 */
export async function releaseStaleEvents(
  supabase: any,
  timeoutMinutes: number = 5,
): Promise<number> {
  const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('event_queue')
    .update({
      status: EventStatus.PENDING,
      locked_by: null,
      locked_at: null,
      last_error: `Lock released: worker timed out after ${timeoutMinutes} minutes`,
    })
    .eq('status', EventStatus.PROCESSING)
    .lt('locked_at', cutoff)
    .select('id');

  if (error) {
    console.error(`[EventQueue] Failed to release stale events:`, error);
    return 0;
  }

  const count = data?.length ?? 0;
  if (count > 0) {
    console.log(`[EventQueue] Released ${count} stale events (locked > ${timeoutMinutes}min)`);
  }
  return count;
}
