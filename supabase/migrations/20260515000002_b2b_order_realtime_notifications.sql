-- ============================================================================
-- B2B 订单实时同步与消息推送
-- ============================================================================
-- 功能：
--   1. 将 b2b_orders 和 notifications 表加入 Supabase Realtime publication
--   2. 创建触发器：订单状态变更时自动写入 notifications 表
--   3. 批发商前端可通过 Supabase Realtime 实时收到订单更新
-- ============================================================================

-- 1. 启用 Realtime 订阅
-- ============================================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.b2b_orders;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- 确保 b2b_orders 表有 REPLICA IDENTITY FULL（Realtime 需要）
ALTER TABLE public.b2b_orders REPLICA IDENTITY FULL;
ALTER TABLE public.notifications REPLICA IDENTITY FULL;

-- 2. 创建订单状态变更通知触发器函数
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_b2b_order_status_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_notification_type text;
  v_title_zh text;
  v_title_ru text;
  v_title_tg text;
  v_message_zh text;
  v_message_ru text;
  v_message_tg text;
  v_order_number text;
  v_should_notify boolean := false;
BEGIN
  v_order_number := NEW.order_number;

  -- 检测 fulfillment_status 变更
  IF OLD.fulfillment_status IS DISTINCT FROM NEW.fulfillment_status THEN
    v_should_notify := true;
    
    CASE NEW.fulfillment_status
      WHEN 'confirmed' THEN
        v_notification_type := 'B2B_ORDER_CONFIRMED';
        v_title_zh := '订单已确认';
        v_title_ru := 'Заказ подтверждён';
        v_title_tg := 'Фармоиш тасдиқ шуд';
        v_message_zh := '您的订单 ' || v_order_number || ' 已确认，正在为您备货';
        v_message_ru := 'Ваш заказ ' || v_order_number || ' подтверждён, идёт подготовка';
        v_message_tg := 'Фармоиши шумо ' || v_order_number || ' тасдиқ шуд, омодасозӣ идома дорад';

      WHEN 'picking' THEN
        v_notification_type := 'B2B_ORDER_PICKING';
        v_title_zh := '订单备货中';
        v_title_ru := 'Заказ комплектуется';
        v_title_tg := 'Фармоиш ҷамъ карда мешавад';
        v_message_zh := '您的订单 ' || v_order_number || ' 正在备货中';
        v_message_ru := 'Ваш заказ ' || v_order_number || ' комплектуется';
        v_message_tg := 'Фармоиши шумо ' || v_order_number || ' ҷамъ карда мешавад';

      WHEN 'ready_to_ship' THEN
        v_notification_type := 'B2B_ORDER_READY';
        v_title_zh := '订单待发货';
        v_title_ru := 'Заказ готов к отправке';
        v_title_tg := 'Фармоиш барои ирсол омода аст';
        v_message_zh := '您的订单 ' || v_order_number || ' 已备好，即将发货';
        v_message_ru := 'Ваш заказ ' || v_order_number || ' готов к отправке';
        v_message_tg := 'Фармоиши шумо ' || v_order_number || ' барои ирсол омода аст';

      WHEN 'shipping' THEN
        v_notification_type := 'B2B_ORDER_SHIPPING';
        v_title_zh := '订单配送中';
        v_title_ru := 'Заказ в пути';
        v_title_tg := 'Фармоиш дар роҳ аст';
        v_message_zh := '您的订单 ' || v_order_number || ' 已发货，正在配送中';
        v_message_ru := 'Ваш заказ ' || v_order_number || ' отправлен и в пути';
        v_message_tg := 'Фармоиши шумо ' || v_order_number || ' ирсол шуд ва дар роҳ аст';

      WHEN 'delivered' THEN
        v_notification_type := 'B2B_ORDER_DELIVERED';
        v_title_zh := '订单已送达';
        v_title_ru := 'Заказ доставлен';
        v_title_tg := 'Фармоиш расонида шуд';
        v_message_zh := '您的订单 ' || v_order_number || ' 已送达，请查收';
        v_message_ru := 'Ваш заказ ' || v_order_number || ' доставлен, проверьте получение';
        v_message_tg := 'Фармоиши шумо ' || v_order_number || ' расонида шуд, лутфан қабул кунед';

      WHEN 'cancelled' THEN
        v_notification_type := 'B2B_ORDER_CANCELLED';
        v_title_zh := '订单已取消';
        v_title_ru := 'Заказ отменён';
        v_title_tg := 'Фармоиш бекор карда шуд';
        v_message_zh := '您的订单 ' || v_order_number || ' 已取消' || 
                        CASE WHEN NEW.cancellation_reason IS NOT NULL 
                             THEN '，原因：' || NEW.cancellation_reason 
                             ELSE '' END;
        v_message_ru := 'Ваш заказ ' || v_order_number || ' отменён' ||
                        CASE WHEN NEW.cancellation_reason IS NOT NULL 
                             THEN ', причина: ' || NEW.cancellation_reason 
                             ELSE '' END;
        v_message_tg := 'Фармоиши шумо ' || v_order_number || ' бекор карда шуд' ||
                        CASE WHEN NEW.cancellation_reason IS NOT NULL 
                             THEN ', сабаб: ' || NEW.cancellation_reason 
                             ELSE '' END;

      ELSE
        v_should_notify := false;
    END CASE;
  END IF;

  -- 检测 payment_status 变更（收款确认）
  IF NOT v_should_notify AND OLD.payment_status IS DISTINCT FROM NEW.payment_status THEN
    IF NEW.payment_status = 'paid' OR NEW.financial_status = 'paid' THEN
      v_should_notify := true;
      v_notification_type := 'B2B_PAYMENT_CONFIRMED';
      v_title_zh := '收款已确认';
      v_title_ru := 'Оплата подтверждена';
      v_title_tg := 'Пардохт тасдиқ шуд';
      v_message_zh := '您的订单 ' || v_order_number || ' 已确认收款 ' || 
                      COALESCE(NEW.paid_total::text, '') || ' TJS';
      v_message_ru := 'Оплата по заказу ' || v_order_number || ' подтверждена: ' || 
                      COALESCE(NEW.paid_total::text, '') || ' TJS';
      v_message_tg := 'Пардохти фармоиши ' || v_order_number || ' тасдиқ шуд: ' || 
                      COALESCE(NEW.paid_total::text, '') || ' TJS';
    END IF;
  END IF;

  -- 写入通知
  IF v_should_notify AND v_notification_type IS NOT NULL THEN
    INSERT INTO public.notifications (
      user_id,
      type,
      title,
      content,
      title_i18n,
      message_i18n,
      related_id,
      related_type,
      data,
      is_read
    ) VALUES (
      NEW.user_id,
      v_notification_type,
      v_title_zh,
      v_message_zh,
      jsonb_build_object('zh', v_title_zh, 'ru', v_title_ru, 'tg', v_title_tg),
      jsonb_build_object('zh', v_message_zh, 'ru', v_message_ru, 'tg', v_message_tg),
      NEW.id::text,
      'b2b_order',
      jsonb_build_object(
        'order_id', NEW.id,
        'order_number', NEW.order_number,
        'fulfillment_status', NEW.fulfillment_status,
        'payment_status', NEW.payment_status,
        'total_amount', NEW.total_amount,
        'notification_type', v_notification_type
      ),
      false
    );
  END IF;

  RETURN NEW;
END;
$$;

-- 3. 创建触发器
-- ============================================================================
DROP TRIGGER IF EXISTS trg_b2b_order_status_notification ON public.b2b_orders;
CREATE TRIGGER trg_b2b_order_status_notification
  AFTER UPDATE ON public.b2b_orders
  FOR EACH ROW
  WHEN (
    OLD.fulfillment_status IS DISTINCT FROM NEW.fulfillment_status
    OR OLD.payment_status IS DISTINCT FROM NEW.payment_status
  )
  EXECUTE FUNCTION public.fn_b2b_order_status_notification();

-- 4. 为 notifications 表添加 RLS 策略（如果尚未添加）
-- ============================================================================
DO $$
BEGIN
  -- 启用 RLS
  ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
  
  -- 用户只能读取自己的通知
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'notifications' AND policyname = 'Users can view own notifications'
  ) THEN
    CREATE POLICY "Users can view own notifications" ON public.notifications
      FOR SELECT USING (user_id = auth.uid()::text OR user_id = current_setting('request.jwt.claims', true)::jsonb->>'sub');
  END IF;

  -- 允许 service_role 和触发器插入
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'notifications' AND policyname = 'Service can insert notifications'
  ) THEN
    CREATE POLICY "Service can insert notifications" ON public.notifications
      FOR INSERT WITH CHECK (true);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'RLS policy setup: %', SQLERRM;
END $$;

-- 5. 为 b2b_orders 添加 RLS 策略支持 Realtime 订阅
-- ============================================================================
DO $$
BEGIN
  ALTER TABLE public.b2b_orders ENABLE ROW LEVEL SECURITY;
  
  -- 批发商可以查看自己的订单（Realtime 需要 SELECT 权限）
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'b2b_orders' AND policyname = 'Wholesalers can view own orders'
  ) THEN
    CREATE POLICY "Wholesalers can view own orders" ON public.b2b_orders
      FOR SELECT USING (user_id = auth.uid()::text OR user_id = current_setting('request.jwt.claims', true)::jsonb->>'sub');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'b2b_orders RLS: %', SQLERRM;
END $$;

-- 6. 授权
-- ============================================================================
GRANT SELECT ON public.notifications TO anon, authenticated;
GRANT SELECT ON public.b2b_orders TO anon, authenticated;
