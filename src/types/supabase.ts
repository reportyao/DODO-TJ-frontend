export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      admin_audit_logs: {
        Row: {
          action: string
          admin_id: string | null
          created_at: string | null
          details: Json | null
          duration_ms: number | null
          error_message: string | null
          id: string
          ip_address: string | null
          new_data: Json | null
          new_value: Json | null
          old_data: Json | null
          old_value: Json | null
          source: string | null
          status: string | null
          target_id: string | null
          target_table: string | null
          target_type: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          admin_id?: string | null
          created_at?: string | null
          details?: Json | null
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          ip_address?: string | null
          new_data?: Json | null
          new_value?: Json | null
          old_data?: Json | null
          old_value?: Json | null
          source?: string | null
          status?: string | null
          target_id?: string | null
          target_table?: string | null
          target_type?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          admin_id?: string | null
          created_at?: string | null
          details?: Json | null
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          ip_address?: string | null
          new_data?: Json | null
          new_value?: Json | null
          old_data?: Json | null
          old_value?: Json | null
          source?: string | null
          status?: string | null
          target_id?: string | null
          target_table?: string | null
          target_type?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_audit_logs_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_notification_channels: {
        Row: {
          bot_token: string | null
          channel_type: string
          chat_id: string | null
          created_at: string | null
          description: string | null
          email_address: string | null
          id: string
          is_active: boolean | null
          name: string
          updated_at: string | null
          webhook_url: string | null
        }
        Insert: {
          bot_token?: string | null
          channel_type: string
          chat_id?: string | null
          created_at?: string | null
          description?: string | null
          email_address?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          updated_at?: string | null
          webhook_url?: string | null
        }
        Update: {
          bot_token?: string | null
          channel_type?: string
          chat_id?: string | null
          created_at?: string | null
          description?: string | null
          email_address?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          updated_at?: string | null
          webhook_url?: string | null
        }
        Relationships: []
      }
      admin_notification_logs: {
        Row: {
          channel_id: string | null
          channel_name: string | null
          channel_type: string | null
          error_message: string | null
          event_type: string
          id: string
          message: string
          queue_id: string | null
          response_data: Json | null
          sent_at: string | null
          status: string
        }
        Insert: {
          channel_id?: string | null
          channel_name?: string | null
          channel_type?: string | null
          error_message?: string | null
          event_type: string
          id?: string
          message: string
          queue_id?: string | null
          response_data?: Json | null
          sent_at?: string | null
          status: string
        }
        Update: {
          channel_id?: string | null
          channel_name?: string | null
          channel_type?: string | null
          error_message?: string | null
          event_type?: string
          id?: string
          message?: string
          queue_id?: string | null
          response_data?: Json | null
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_notification_logs_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "admin_notification_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_notification_logs_queue_id_fkey"
            columns: ["queue_id"]
            isOneToOne: false
            referencedRelation: "admin_notification_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_notification_queue: {
        Row: {
          created_at: string | null
          error_message: string | null
          event_data: Json
          event_type: string
          formatted_message: string | null
          id: string
          max_retries: number | null
          processed_at: string | null
          retry_count: number | null
          scheduled_at: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          error_message?: string | null
          event_data?: Json
          event_type: string
          formatted_message?: string | null
          id?: string
          max_retries?: number | null
          processed_at?: string | null
          retry_count?: number | null
          scheduled_at?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          error_message?: string | null
          event_data?: Json
          event_type?: string
          formatted_message?: string | null
          id?: string
          max_retries?: number | null
          processed_at?: string | null
          retry_count?: number | null
          scheduled_at?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      admin_notification_subscriptions: {
        Row: {
          channel_id: string | null
          created_at: string | null
          event_type: string
          id: string
          is_active: boolean | null
          priority: number | null
        }
        Insert: {
          channel_id?: string | null
          created_at?: string | null
          event_type: string
          id?: string
          is_active?: boolean | null
          priority?: number | null
        }
        Update: {
          channel_id?: string | null
          created_at?: string | null
          event_type?: string
          id?: string
          is_active?: boolean | null
          priority?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_notification_subscriptions_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "admin_notification_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_sessions: {
        Row: {
          admin_id: string
          created_at: string
          expires_at: string
          id: string
          ip_address: string | null
          is_active: boolean
          session_token: string
          user_agent: string | null
        }
        Insert: {
          admin_id: string
          created_at?: string
          expires_at?: string
          id?: string
          ip_address?: string | null
          is_active?: boolean
          session_token?: string
          user_agent?: string | null
        }
        Update: {
          admin_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          ip_address?: string | null
          is_active?: boolean
          session_token?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_sessions_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_users: {
        Row: {
          created_at: string | null
          created_by: string | null
          display_name: string | null
          email: string | null
          failed_login_attempts: number
          id: string
          is_active: boolean | null
          last_login_at: string | null
          locked_until: string | null
          password_hash: string
          permissions: Json | null
          role: string | null
          status: string | null
          updated_at: string | null
          username: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          display_name?: string | null
          email?: string | null
          failed_login_attempts?: number
          id?: string
          is_active?: boolean | null
          last_login_at?: string | null
          locked_until?: string | null
          password_hash: string
          permissions?: Json | null
          role?: string | null
          status?: string | null
          updated_at?: string | null
          username: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          display_name?: string | null
          email?: string | null
          failed_login_attempts?: number
          id?: string
          is_active?: boolean | null
          last_login_at?: string | null
          locked_until?: string | null
          password_hash?: string
          permissions?: Json | null
          role?: string | null
          status?: string | null
          updated_at?: string | null
          username?: string
        }
        Relationships: []
      }
      ai_chat_history: {
        Row: {
          ai_response: string
          content: string
          created_at: string | null
          id: number
          is_blocked: boolean
          metadata: Json | null
          response_time: number | null
          role: string
          session_id: string | null
          user_id: string | null
          user_message: string
        }
        Insert: {
          ai_response?: string
          content: string
          created_at?: string | null
          id?: number
          is_blocked?: boolean
          metadata?: Json | null
          response_time?: number | null
          role: string
          session_id?: string | null
          user_id?: string | null
          user_message?: string
        }
        Update: {
          ai_response?: string
          content?: string
          created_at?: string | null
          id?: number
          is_blocked?: boolean
          metadata?: Json | null
          response_time?: number | null
          role?: string
          session_id?: string | null
          user_id?: string | null
          user_message?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_chat_history_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_chat_logs: {
        Row: {
          answer: string | null
          created_at: string | null
          id: string
          message: string | null
          model: string | null
          question: string | null
          response: string | null
          tokens_used: number | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          answer?: string | null
          created_at?: string | null
          id?: string
          message?: string | null
          model?: string | null
          question?: string | null
          response?: string | null
          tokens_used?: number | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          answer?: string | null
          created_at?: string | null
          id?: string
          message?: string | null
          model?: string | null
          question?: string | null
          response?: string | null
          tokens_used?: number | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_chat_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_chat_quota: {
        Row: {
          base_quota: number
          bonus_quota: number | null
          created_at: string | null
          daily_limit: number | null
          daily_used: number | null
          date: string
          id: number
          last_reset_date: string | null
          updated_at: string | null
          used_quota: number
          user_id: string
        }
        Insert: {
          base_quota?: number
          bonus_quota?: number | null
          created_at?: string | null
          daily_limit?: number | null
          daily_used?: number | null
          date?: string
          id?: number
          last_reset_date?: string | null
          updated_at?: string | null
          used_quota?: number
          user_id: string
        }
        Update: {
          base_quota?: number
          bonus_quota?: number | null
          created_at?: string | null
          daily_limit?: number | null
          daily_used?: number | null
          date?: string
          id?: number
          last_reset_date?: string | null
          updated_at?: string | null
          used_quota?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_chat_quota_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_topic_generation_tasks: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string | null
          error_message: string | null
          id: string
          request_payload: Json
          result_payload: Json | null
          status: string
          topic_id: string | null
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          id?: string
          request_payload?: Json
          result_payload?: Json | null
          status?: string
          topic_id?: string | null
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          id?: string
          request_payload?: Json
          result_payload?: Json | null
          status?: string
          topic_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_topic_generation_tasks_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "homepage_topics"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string | null
          details: Json | null
          entity_id: string | null
          entity_type: string | null
          id: string
          ip_address: string | null
          new_data: Json | null
          old_data: Json | null
          target_id: string | null
          target_table: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          details?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          new_data?: Json | null
          old_data?: Json | null
          target_id?: string | null
          target_table?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          details?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          new_data?: Json | null
          old_data?: Json | null
          target_id?: string | null
          target_table?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      banners: {
        Row: {
          created_at: string | null
          end_time: string | null
          id: string
          image_url: string
          image_url_ru: string | null
          image_url_tg: string | null
          image_url_zh: string | null
          is_active: boolean | null
          link_type: string | null
          link_url: string | null
          sort_order: number | null
          start_time: string | null
          target_id: string | null
          title: string
          title_i18n: Json | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          end_time?: string | null
          id?: string
          image_url: string
          image_url_ru?: string | null
          image_url_tg?: string | null
          image_url_zh?: string | null
          is_active?: boolean | null
          link_type?: string | null
          link_url?: string | null
          sort_order?: number | null
          start_time?: string | null
          target_id?: string | null
          title: string
          title_i18n?: Json | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          end_time?: string | null
          id?: string
          image_url?: string
          image_url_ru?: string | null
          image_url_tg?: string | null
          image_url_zh?: string | null
          is_active?: boolean | null
          link_type?: string | null
          link_url?: string | null
          sort_order?: number | null
          start_time?: string | null
          target_id?: string | null
          title?: string
          title_i18n?: Json | null
          updated_at?: string | null
        }
        Relationships: []
      }
      batch_order_items: {
        Row: {
          added_at: string | null
          arrival_notes: string | null
          arrival_status: string | null
          batch_id: string
          id: string
          notification_sent: boolean | null
          notification_sent_at: string | null
          order_id: string
          order_type: string
          pickup_code: string | null
          pickup_code_expires_at: string | null
          pickup_code_generated_at: string | null
          product_image: string | null
          product_name: string | null
          product_name_i18n: Json | null
          product_sku: string | null
          quantity: number | null
          updated_at: string | null
          user_id: string | null
          user_name: string | null
          user_telegram_id: number | null
        }
        Insert: {
          added_at?: string | null
          arrival_notes?: string | null
          arrival_status?: string | null
          batch_id: string
          id?: string
          notification_sent?: boolean | null
          notification_sent_at?: string | null
          order_id: string
          order_type: string
          pickup_code?: string | null
          pickup_code_expires_at?: string | null
          pickup_code_generated_at?: string | null
          product_image?: string | null
          product_name?: string | null
          product_name_i18n?: Json | null
          product_sku?: string | null
          quantity?: number | null
          updated_at?: string | null
          user_id?: string | null
          user_name?: string | null
          user_telegram_id?: number | null
        }
        Update: {
          added_at?: string | null
          arrival_notes?: string | null
          arrival_status?: string | null
          batch_id?: string
          id?: string
          notification_sent?: boolean | null
          notification_sent_at?: string | null
          order_id?: string
          order_type?: string
          pickup_code?: string | null
          pickup_code_expires_at?: string | null
          pickup_code_generated_at?: string | null
          product_image?: string | null
          product_name?: string | null
          product_name_i18n?: Json | null
          product_sku?: string | null
          quantity?: number | null
          updated_at?: string | null
          user_id?: string | null
          user_name?: string | null
          user_telegram_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "batch_order_items_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batch_statistics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_order_items_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "shipment_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_command_stats: {
        Row: {
          command: string
          created_at: string | null
          error_message: string | null
          execution_time_ms: number | null
          id: string
          response_time_ms: number | null
          success: boolean | null
          user_id: string | null
        }
        Insert: {
          command: string
          created_at?: string | null
          error_message?: string | null
          execution_time_ms?: number | null
          id?: string
          response_time_ms?: number | null
          success?: boolean | null
          user_id?: string | null
        }
        Update: {
          command?: string
          created_at?: string | null
          error_message?: string | null
          execution_time_ms?: number | null
          id?: string
          response_time_ms?: number | null
          success?: boolean | null
          user_id?: string | null
        }
        Relationships: []
      }
      bot_messages: {
        Row: {
          chat_id: number | null
          content: string | null
          created_at: string | null
          direction: string | null
          id: string
          message_id: number | null
          message_type: string | null
          metadata: Json | null
          user_id: string | null
        }
        Insert: {
          chat_id?: number | null
          content?: string | null
          created_at?: string | null
          direction?: string | null
          id?: string
          message_id?: number | null
          message_type?: string | null
          metadata?: Json | null
          user_id?: string | null
        }
        Update: {
          chat_id?: number | null
          content?: string | null
          created_at?: string | null
          direction?: string | null
          id?: string
          message_id?: number | null
          message_type?: string | null
          metadata?: Json | null
          user_id?: string | null
        }
        Relationships: []
      }
      bot_sessions: {
        Row: {
          chat_id: number | null
          context: Json | null
          created_at: string | null
          id: string
          last_activity_at: string | null
          state: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          chat_id?: number | null
          context?: Json | null
          created_at?: string | null
          id?: string
          last_activity_at?: string | null
          state?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          chat_id?: number | null
          context?: Json | null
          created_at?: string | null
          id?: string
          last_activity_at?: string | null
          state?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bot_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_user_settings: {
        Row: {
          created_at: string | null
          id: string
          language: string | null
          lottery_notifications: boolean | null
          marketing_notifications: boolean | null
          notifications_enabled: boolean | null
          timezone: string | null
          updated_at: string | null
          user_id: string | null
          wallet_notifications: boolean | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          language?: string | null
          lottery_notifications?: boolean | null
          marketing_notifications?: boolean | null
          notifications_enabled?: boolean | null
          timezone?: string | null
          updated_at?: string | null
          user_id?: string | null
          wallet_notifications?: boolean | null
        }
        Update: {
          created_at?: string | null
          id?: string
          language?: string | null
          lottery_notifications?: boolean | null
          marketing_notifications?: boolean | null
          notifications_enabled?: boolean | null
          timezone?: string | null
          updated_at?: string | null
          user_id?: string | null
          wallet_notifications?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "bot_user_settings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      col_type: {
        Row: {
          column_name: string | null
          data_type: string | null
          id: number
          table_name: string | null
        }
        Insert: {
          column_name?: string | null
          data_type?: string | null
          id?: number
          table_name?: string | null
        }
        Update: {
          column_name?: string | null
          data_type?: string | null
          id?: number
          table_name?: string | null
        }
        Relationships: []
      }
      commission_settings: {
        Row: {
          created_at: string | null
          description: string | null
          description_i18n: Json | null
          id: string
          is_active: boolean | null
          level: number | null
          min_payout_amount: number | null
          rate: number | null
          trigger_condition: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          description_i18n?: Json | null
          id?: string
          is_active?: boolean | null
          level?: number | null
          min_payout_amount?: number | null
          rate?: number | null
          trigger_condition?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          description_i18n?: Json | null
          id?: string
          is_active?: boolean | null
          level?: number | null
          min_payout_amount?: number | null
          rate?: number | null
          trigger_condition?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      commission_withdrawals: {
        Row: {
          account_holder: string | null
          account_number: string | null
          admin_note: string | null
          amount: number
          bank_name: string | null
          created_at: string | null
          id: string
          payment_account: string | null
          payment_method: string | null
          processed_at: string | null
          processed_by: string | null
          reject_reason: string | null
          status: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          account_holder?: string | null
          account_number?: string | null
          admin_note?: string | null
          amount: number
          bank_name?: string | null
          created_at?: string | null
          id?: string
          payment_account?: string | null
          payment_method?: string | null
          processed_at?: string | null
          processed_by?: string | null
          reject_reason?: string | null
          status?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          account_holder?: string | null
          account_number?: string | null
          admin_note?: string | null
          amount?: number
          bank_name?: string | null
          created_at?: string | null
          id?: string
          payment_account?: string | null
          payment_method?: string | null
          processed_at?: string | null
          processed_by?: string | null
          reject_reason?: string | null
          status?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "commission_withdrawals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      commissions: {
        Row: {
          amount: number
          beneficiary_id: string | null
          created_at: string | null
          from_user_id: string | null
          id: string
          level: number | null
          order_id: string | null
          order_type: string | null
          paid_at: string | null
          rate: number | null
          related_lottery_id: string | null
          related_order_id: string | null
          settled_at: string | null
          source_amount: number | null
          source_user_id: string | null
          status: string | null
          type: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          amount: number
          beneficiary_id?: string | null
          created_at?: string | null
          from_user_id?: string | null
          id?: string
          level?: number | null
          order_id?: string | null
          order_type?: string | null
          paid_at?: string | null
          rate?: number | null
          related_lottery_id?: string | null
          related_order_id?: string | null
          settled_at?: string | null
          source_amount?: number | null
          source_user_id?: string | null
          status?: string | null
          type?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          amount?: number
          beneficiary_id?: string | null
          created_at?: string | null
          from_user_id?: string | null
          id?: string
          level?: number | null
          order_id?: string | null
          order_type?: string | null
          paid_at?: string | null
          rate?: number | null
          related_lottery_id?: string | null
          related_order_id?: string | null
          settled_at?: string | null
          source_amount?: number | null
          source_user_id?: string | null
          status?: string | null
          type?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "commissions_from_user_id_fkey"
            columns: ["from_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      coupons: {
        Row: {
          amount: number
          created_at: string | null
          expires_at: string
          id: string
          related_lottery_id: string | null
          source: string
          status: string
          updated_at: string | null
          used_at: string | null
          user_id: string
        }
        Insert: {
          amount?: number
          created_at?: string | null
          expires_at: string
          id?: string
          related_lottery_id?: string | null
          source?: string
          status?: string
          updated_at?: string | null
          used_at?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string | null
          expires_at?: string
          id?: string
          related_lottery_id?: string | null
          source?: string
          status?: string
          updated_at?: string | null
          used_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coupons_related_lottery_id_fkey"
            columns: ["related_lottery_id"]
            isOneToOne: false
            referencedRelation: "lotteries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupons_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      dead_letter_queue: {
        Row: {
          created_at: string
          error_history: Json
          event_type: string
          final_error: string | null
          id: string
          idempotency_key: string | null
          original_event_id: string
          payload: Json
          resolution_note: string | null
          resolution_status: string
          resolved_at: string | null
          session_id: string | null
          source: string
          total_retries: number
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          error_history?: Json
          event_type: string
          final_error?: string | null
          id?: string
          idempotency_key?: string | null
          original_event_id: string
          payload?: Json
          resolution_note?: string | null
          resolution_status?: string
          resolved_at?: string | null
          session_id?: string | null
          source: string
          total_retries?: number
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          error_history?: Json
          event_type?: string
          final_error?: string | null
          id?: string
          idempotency_key?: string | null
          original_event_id?: string
          payload?: Json
          resolution_note?: string | null
          resolution_status?: string
          resolved_at?: string | null
          session_id?: string | null
          source?: string
          total_retries?: number
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      deposit_requests: {
        Row: {
          admin_note: string | null
          amount: number
          created_at: string | null
          currency: string | null
          id: string
          idempotency_key: string | null
          order_number: string | null
          payer_account: string | null
          payer_name: string | null
          payer_phone: string | null
          payment_method: string | null
          payment_proof: string | null
          payment_proof_images: string[] | null
          payment_proof_url: string | null
          payment_reference: string | null
          processed_at: string | null
          processed_by: string | null
          reject_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          admin_note?: string | null
          amount: number
          created_at?: string | null
          currency?: string | null
          id?: string
          idempotency_key?: string | null
          order_number?: string | null
          payer_account?: string | null
          payer_name?: string | null
          payer_phone?: string | null
          payment_method?: string | null
          payment_proof?: string | null
          payment_proof_images?: string[] | null
          payment_proof_url?: string | null
          payment_reference?: string | null
          processed_at?: string | null
          processed_by?: string | null
          reject_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          admin_note?: string | null
          amount?: number
          created_at?: string | null
          currency?: string | null
          id?: string
          idempotency_key?: string | null
          order_number?: string | null
          payer_account?: string | null
          payer_name?: string | null
          payer_phone?: string | null
          payment_method?: string | null
          payment_proof?: string | null
          payment_proof_images?: string[] | null
          payment_proof_url?: string | null
          payment_reference?: string | null
          processed_at?: string | null
          processed_by?: string | null
          reject_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deposit_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      deposits: {
        Row: {
          admin_note: string | null
          amount: number
          created_at: string | null
          currency: string | null
          id: string
          notes: string | null
          payer_account: string | null
          payer_name: string | null
          payer_phone: string | null
          payment_method: string | null
          payment_proof_url: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          admin_note?: string | null
          amount: number
          created_at?: string | null
          currency?: string | null
          id?: string
          notes?: string | null
          payer_account?: string | null
          payer_name?: string | null
          payer_phone?: string | null
          payment_method?: string | null
          payment_proof_url?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          admin_note?: string | null
          amount?: number
          created_at?: string | null
          currency?: string | null
          id?: string
          notes?: string | null
          payer_account?: string | null
          payer_name?: string | null
          payer_phone?: string | null
          payment_method?: string | null
          payment_proof_url?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deposits_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      draw_algorithms: {
        Row: {
          algorithm_type: string | null
          config: Json | null
          created_at: string | null
          description: string | null
          description_i18n: Json | null
          display_name_i18n: Json | null
          formula_i18n: Json | null
          id: string
          is_active: boolean | null
          is_default: boolean | null
          name: string
          updated_at: string | null
        }
        Insert: {
          algorithm_type?: string | null
          config?: Json | null
          created_at?: string | null
          description?: string | null
          description_i18n?: Json | null
          display_name_i18n?: Json | null
          formula_i18n?: Json | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          name: string
          updated_at?: string | null
        }
        Update: {
          algorithm_type?: string | null
          config?: Json | null
          created_at?: string | null
          description?: string | null
          description_i18n?: Json | null
          display_name_i18n?: Json | null
          formula_i18n?: Json | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      draw_logs: {
        Row: {
          algorithm_id: string | null
          algorithm_name: string | null
          calculation_steps: Json | null
          created_at: string | null
          draw_data: Json | null
          draw_time: string | null
          id: string
          input_data: Json | null
          lottery_id: string | null
          random_seed: string | null
          vrf_proof: string | null
          vrf_seed: string | null
          winner_order_id: string | null
          winner_user_id: string | null
          winning_number: number | null
          winning_ticket_id: string | null
        }
        Insert: {
          algorithm_id?: string | null
          algorithm_name?: string | null
          calculation_steps?: Json | null
          created_at?: string | null
          draw_data?: Json | null
          draw_time?: string | null
          id?: string
          input_data?: Json | null
          lottery_id?: string | null
          random_seed?: string | null
          vrf_proof?: string | null
          vrf_seed?: string | null
          winner_order_id?: string | null
          winner_user_id?: string | null
          winning_number?: number | null
          winning_ticket_id?: string | null
        }
        Update: {
          algorithm_id?: string | null
          algorithm_name?: string | null
          calculation_steps?: Json | null
          created_at?: string | null
          draw_data?: Json | null
          draw_time?: string | null
          id?: string
          input_data?: Json | null
          lottery_id?: string | null
          random_seed?: string | null
          vrf_proof?: string | null
          vrf_seed?: string | null
          winner_order_id?: string | null
          winner_user_id?: string | null
          winning_number?: number | null
          winning_ticket_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "draw_logs_lottery_id_fkey"
            columns: ["lottery_id"]
            isOneToOne: false
            referencedRelation: "lotteries"
            referencedColumns: ["id"]
          },
        ]
      }
      edge_function_logs: {
        Row: {
          action: string
          created_at: string | null
          details: Json | null
          duration_ms: number | null
          error_message: string | null
          function_name: string
          id: string
          ip_address: string | null
          request_body: Json | null
          response_status: number | null
          status: string | null
          target_id: string | null
          target_type: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          details?: Json | null
          duration_ms?: number | null
          error_message?: string | null
          function_name: string
          id?: string
          ip_address?: string | null
          request_body?: Json | null
          response_status?: number | null
          status?: string | null
          target_id?: string | null
          target_type?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          details?: Json | null
          duration_ms?: number | null
          error_message?: string | null
          function_name?: string
          id?: string
          ip_address?: string | null
          request_body?: Json | null
          response_status?: number | null
          status?: string | null
          target_id?: string | null
          target_type?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      error_logs: {
        Row: {
          action_data: Json | null
          action_type: string | null
          admin_note: string | null
          api_endpoint: string | null
          api_method: string | null
          api_response_body: string | null
          api_status_code: number | null
          app_version: string | null
          browser_name: string | null
          browser_version: string | null
          city: string | null
          component_name: string | null
          country: string | null
          created_at: string | null
          device_model: string | null
          device_type: string | null
          error_message: string
          error_stack: string | null
          error_type: string
          id: string
          ip_address: unknown
          is_telegram_mini_app: boolean | null
          network_type: string | null
          os_name: string | null
          os_version: string | null
          page_route: string | null
          page_url: string | null
          phone_number: string | null
          resolved_at: string | null
          resolved_by: string | null
          screen_height: number | null
          screen_width: number | null
          status: string | null
          telegram_id: number | null
          telegram_platform: string | null
          telegram_username: string | null
          updated_at: string | null
          user_actions: Json | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action_data?: Json | null
          action_type?: string | null
          admin_note?: string | null
          api_endpoint?: string | null
          api_method?: string | null
          api_response_body?: string | null
          api_status_code?: number | null
          app_version?: string | null
          browser_name?: string | null
          browser_version?: string | null
          city?: string | null
          component_name?: string | null
          country?: string | null
          created_at?: string | null
          device_model?: string | null
          device_type?: string | null
          error_message: string
          error_stack?: string | null
          error_type: string
          id?: string
          ip_address?: unknown
          is_telegram_mini_app?: boolean | null
          network_type?: string | null
          os_name?: string | null
          os_version?: string | null
          page_route?: string | null
          page_url?: string | null
          phone_number?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          screen_height?: number | null
          screen_width?: number | null
          status?: string | null
          telegram_id?: number | null
          telegram_platform?: string | null
          telegram_username?: string | null
          updated_at?: string | null
          user_actions?: Json | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action_data?: Json | null
          action_type?: string | null
          admin_note?: string | null
          api_endpoint?: string | null
          api_method?: string | null
          api_response_body?: string | null
          api_status_code?: number | null
          app_version?: string | null
          browser_name?: string | null
          browser_version?: string | null
          city?: string | null
          component_name?: string | null
          country?: string | null
          created_at?: string | null
          device_model?: string | null
          device_type?: string | null
          error_message?: string
          error_stack?: string | null
          error_type?: string
          id?: string
          ip_address?: unknown
          is_telegram_mini_app?: boolean | null
          network_type?: string | null
          os_name?: string | null
          os_version?: string | null
          page_route?: string | null
          page_url?: string | null
          phone_number?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          screen_height?: number | null
          screen_width?: number | null
          status?: string | null
          telegram_id?: number | null
          telegram_platform?: string | null
          telegram_username?: string | null
          updated_at?: string | null
          user_actions?: Json | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      event_queue: {
        Row: {
          created_at: string
          event_type: string
          id: string
          idempotency_key: string | null
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          max_retries: number
          payload: Json
          processed_at: string | null
          retry_count: number
          scheduled_at: string
          session_id: string | null
          source: string
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          idempotency_key?: string | null
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_retries?: number
          payload?: Json
          processed_at?: string | null
          retry_count?: number
          scheduled_at?: string
          session_id?: string | null
          source: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          idempotency_key?: string | null
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_retries?: number
          payload?: Json
          processed_at?: string | null
          retry_count?: number
          scheduled_at?: string
          session_id?: string | null
          source?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      exchange_records: {
        Row: {
          amount: number | null
          created_at: string | null
          currency: string | null
          exchange_rate: number | null
          exchange_type: string | null
          from_amount: number
          from_type: string
          from_wallet_type: string | null
          id: string
          source_balance_after: number | null
          source_balance_before: number | null
          source_wallet_id: string | null
          status: string | null
          target_balance_after: number | null
          target_balance_before: number | null
          target_wallet_id: string | null
          to_amount: number
          to_type: string
          to_wallet_type: string | null
          user_id: string | null
        }
        Insert: {
          amount?: number | null
          created_at?: string | null
          currency?: string | null
          exchange_rate?: number | null
          exchange_type?: string | null
          from_amount: number
          from_type: string
          from_wallet_type?: string | null
          id?: string
          source_balance_after?: number | null
          source_balance_before?: number | null
          source_wallet_id?: string | null
          status?: string | null
          target_balance_after?: number | null
          target_balance_before?: number | null
          target_wallet_id?: string | null
          to_amount: number
          to_type: string
          to_wallet_type?: string | null
          user_id?: string | null
        }
        Update: {
          amount?: number | null
          created_at?: string | null
          currency?: string | null
          exchange_rate?: number | null
          exchange_type?: string | null
          from_amount?: number
          from_type?: string
          from_wallet_type?: string | null
          id?: string
          source_balance_after?: number | null
          source_balance_before?: number | null
          source_wallet_id?: string | null
          status?: string | null
          target_balance_after?: number | null
          target_balance_before?: number | null
          target_wallet_id?: string | null
          to_amount?: number
          to_type?: string
          to_wallet_type?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exchange_records_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      full_purchase_orders: {
        Row: {
          batch_id: string | null
          claimed_at: string | null
          created_at: string | null
          currency: string | null
          expires_at: string | null
          id: string
          logistics_status: string | null
          lottery_id: string
          metadata: Json | null
          order_number: string
          picked_up_at: string | null
          picked_up_by: string | null
          pickup_code: string | null
          pickup_point_id: string | null
          pickup_status: string | null
          status: string | null
          total_amount: number
          updated_at: string | null
          user_id: string
        }
        Insert: {
          batch_id?: string | null
          claimed_at?: string | null
          created_at?: string | null
          currency?: string | null
          expires_at?: string | null
          id?: string
          logistics_status?: string | null
          lottery_id: string
          metadata?: Json | null
          order_number: string
          picked_up_at?: string | null
          picked_up_by?: string | null
          pickup_code?: string | null
          pickup_point_id?: string | null
          pickup_status?: string | null
          status?: string | null
          total_amount: number
          updated_at?: string | null
          user_id: string
        }
        Update: {
          batch_id?: string | null
          claimed_at?: string | null
          created_at?: string | null
          currency?: string | null
          expires_at?: string | null
          id?: string
          logistics_status?: string | null
          lottery_id?: string
          metadata?: Json | null
          order_number?: string
          picked_up_at?: string | null
          picked_up_by?: string | null
          pickup_code?: string | null
          pickup_point_id?: string | null
          pickup_status?: string | null
          status?: string | null
          total_amount?: number
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_full_purchase_orders_batch_id"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batch_statistics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_full_purchase_orders_batch_id"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "shipment_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_full_purchase_orders_pickup_point"
            columns: ["pickup_point_id"]
            isOneToOne: false
            referencedRelation: "pickup_points"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "full_purchase_orders_lottery_id_fkey"
            columns: ["lottery_id"]
            isOneToOne: false
            referencedRelation: "lotteries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "full_purchase_orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      group_buy_orders: {
        Row: {
          amount: number
          created_at: string | null
          id: string
          order_number: string | null
          order_timestamp: number | null
          product_id: string | null
          refund_amount: number | null
          refund_lucky_coins: number | null
          refunded_at: string | null
          session_id: string
          status: string | null
          timestamp_ms: number | null
          updated_at: string | null
          user_id: string
          user_uuid: string | null
        }
        Insert: {
          amount: number
          created_at?: string | null
          id?: string
          order_number?: string | null
          order_timestamp?: number | null
          product_id?: string | null
          refund_amount?: number | null
          refund_lucky_coins?: number | null
          refunded_at?: string | null
          session_id: string
          status?: string | null
          timestamp_ms?: number | null
          updated_at?: string | null
          user_id: string
          user_uuid?: string | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          id?: string
          order_number?: string | null
          order_timestamp?: number | null
          product_id?: string | null
          refund_amount?: number | null
          refund_lucky_coins?: number | null
          refunded_at?: string | null
          session_id?: string
          status?: string | null
          timestamp_ms?: number | null
          updated_at?: string | null
          user_id?: string
          user_uuid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "group_buy_orders_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "group_buy_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_buy_orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      group_buy_orders_backup: {
        Row: {
          amount: number | null
          created_at: string | null
          id: string
          session_id: string | null
          status: string | null
          timestamp_ms: number | null
          user_id: string | null
        }
        Insert: {
          amount?: number | null
          created_at?: string | null
          id: string
          session_id?: string | null
          status?: string | null
          timestamp_ms?: number | null
          user_id?: string | null
        }
        Update: {
          amount?: number | null
          created_at?: string | null
          id?: string
          session_id?: string | null
          status?: string | null
          timestamp_ms?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      group_buy_products: {
        Row: {
          created_at: string | null
          currency: string | null
          description: string | null
          description_i18n: Json | null
          duration_hours: number | null
          group_price: number
          group_size: number | null
          id: string
          image_url: string | null
          image_urls: string[] | null
          inventory_product_id: string | null
          is_active: boolean | null
          max_participants: number | null
          min_participants: number | null
          name: string | null
          name_i18n: Json | null
          original_price: number
          price_comparisons: Json | null
          price_per_person: number | null
          sold_quantity: number | null
          status: string | null
          stock: number | null
          stock_quantity: number | null
          timeout_hours: number | null
          title: Json
          title_i18n: Json | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          currency?: string | null
          description?: string | null
          description_i18n?: Json | null
          duration_hours?: number | null
          group_price: number
          group_size?: number | null
          id?: string
          image_url?: string | null
          image_urls?: string[] | null
          inventory_product_id?: string | null
          is_active?: boolean | null
          max_participants?: number | null
          min_participants?: number | null
          name?: string | null
          name_i18n?: Json | null
          original_price: number
          price_comparisons?: Json | null
          price_per_person?: number | null
          sold_quantity?: number | null
          status?: string | null
          stock?: number | null
          stock_quantity?: number | null
          timeout_hours?: number | null
          title?: Json
          title_i18n?: Json | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          currency?: string | null
          description?: string | null
          description_i18n?: Json | null
          duration_hours?: number | null
          group_price?: number
          group_size?: number | null
          id?: string
          image_url?: string | null
          image_urls?: string[] | null
          inventory_product_id?: string | null
          is_active?: boolean | null
          max_participants?: number | null
          min_participants?: number | null
          name?: string | null
          name_i18n?: Json | null
          original_price?: number
          price_comparisons?: Json | null
          price_per_person?: number | null
          sold_quantity?: number | null
          status?: string | null
          stock?: number | null
          stock_quantity?: number | null
          timeout_hours?: number | null
          title?: Json
          title_i18n?: Json | null
          updated_at?: string | null
        }
        Relationships: []
      }
      group_buy_results: {
        Row: {
          algorithm_data: Json | null
          batch_id: string | null
          claimed_at: string | null
          created_at: string | null
          expires_at: string | null
          id: string
          logistics_status: string | null
          picked_up_at: string | null
          picked_up_by: string | null
          pickup_code: string | null
          pickup_point_id: string | null
          pickup_status: string | null
          product_id: string
          session_id: string
          shipping_info: Json | null
          shipping_status: string | null
          status: string | null
          timestamp_sum: string
          total_participants: number
          updated_at: string | null
          user_id: string | null
          winner_id: string
          winner_order_id: string
          winner_uuid: string | null
          winning_index: number
        }
        Insert: {
          algorithm_data?: Json | null
          batch_id?: string | null
          claimed_at?: string | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          logistics_status?: string | null
          picked_up_at?: string | null
          picked_up_by?: string | null
          pickup_code?: string | null
          pickup_point_id?: string | null
          pickup_status?: string | null
          product_id: string
          session_id: string
          shipping_info?: Json | null
          shipping_status?: string | null
          status?: string | null
          timestamp_sum: string
          total_participants: number
          updated_at?: string | null
          user_id?: string | null
          winner_id: string
          winner_order_id: string
          winner_uuid?: string | null
          winning_index: number
        }
        Update: {
          algorithm_data?: Json | null
          batch_id?: string | null
          claimed_at?: string | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          logistics_status?: string | null
          picked_up_at?: string | null
          picked_up_by?: string | null
          pickup_code?: string | null
          pickup_point_id?: string | null
          pickup_status?: string | null
          product_id?: string
          session_id?: string
          shipping_info?: Json | null
          shipping_status?: string | null
          status?: string | null
          timestamp_sum?: string
          total_participants?: number
          updated_at?: string | null
          user_id?: string | null
          winner_id?: string
          winner_order_id?: string
          winner_uuid?: string | null
          winning_index?: number
        }
        Relationships: [
          {
            foreignKeyName: "fk_group_buy_results_batch_id"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batch_statistics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_group_buy_results_batch_id"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "shipment_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_group_buy_results_pickup_point"
            columns: ["pickup_point_id"]
            isOneToOne: false
            referencedRelation: "pickup_points"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_buy_results_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "group_buy_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_buy_results_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: true
            referencedRelation: "group_buy_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_buy_results_winner_order_id_fkey"
            columns: ["winner_order_id"]
            isOneToOne: false
            referencedRelation: "group_buy_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      group_buy_sessions: {
        Row: {
          completed_at: string | null
          created_at: string | null
          current_participants: number | null
          drawn_at: string | null
          end_time: string | null
          expires_at: string | null
          group_size: number | null
          id: string
          initiator_id: string
          max_participants: number | null
          product_id: string
          required_participants: number | null
          session_code: string | null
          start_time: string | null
          started_at: string | null
          status: string | null
          updated_at: string | null
          winner_id: string | null
          winning_timestamp_sum: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          current_participants?: number | null
          drawn_at?: string | null
          end_time?: string | null
          expires_at?: string | null
          group_size?: number | null
          id?: string
          initiator_id: string
          max_participants?: number | null
          product_id: string
          required_participants?: number | null
          session_code?: string | null
          start_time?: string | null
          started_at?: string | null
          status?: string | null
          updated_at?: string | null
          winner_id?: string | null
          winning_timestamp_sum?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          current_participants?: number | null
          drawn_at?: string | null
          end_time?: string | null
          expires_at?: string | null
          group_size?: number | null
          id?: string
          initiator_id?: string
          max_participants?: number | null
          product_id?: string
          required_participants?: number | null
          session_code?: string | null
          start_time?: string | null
          started_at?: string | null
          status?: string | null
          updated_at?: string | null
          winner_id?: string | null
          winning_timestamp_sum?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "group_buy_sessions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "group_buy_products"
            referencedColumns: ["id"]
          },
        ]
      }
      group_buy_sessions_backup: {
        Row: {
          created_at: string | null
          current_participants: number | null
          drawn_at: string | null
          end_time: string | null
          id: string
          product_id: string | null
          start_time: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          current_participants?: number | null
          drawn_at?: string | null
          end_time?: string | null
          id: string
          product_id?: string | null
          start_time?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          current_participants?: number | null
          drawn_at?: string | null
          end_time?: string | null
          id?: string
          product_id?: string | null
          start_time?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      homepage_categories: {
        Row: {
          code: string
          color_token: string
          created_at: string
          icon_key: string
          id: string
          is_active: boolean
          is_fixed: boolean
          name_i18n: Json
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          color_token?: string
          created_at?: string
          icon_key?: string
          id?: string
          is_active?: boolean
          is_fixed?: boolean
          name_i18n?: Json
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string
          color_token?: string
          created_at?: string
          icon_key?: string
          id?: string
          is_active?: boolean
          is_fixed?: boolean
          name_i18n?: Json
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      homepage_tags: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          description_i18n: Json | null
          id: string
          is_active: boolean
          name_i18n: Json
          tag_group: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          description_i18n?: Json | null
          id?: string
          is_active?: boolean
          name_i18n?: Json
          tag_group: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          description_i18n?: Json | null
          id?: string
          is_active?: boolean
          name_i18n?: Json
          tag_group?: string
          updated_at?: string
        }
        Relationships: []
      }
      homepage_topics: {
        Row: {
          card_style: string | null
          cover_image_default: string | null
          cover_image_ru: string | null
          cover_image_tg: string | null
          cover_image_url: string | null
          cover_image_zh: string | null
          created_at: string
          created_by: string | null
          end_time: string | null
          id: string
          intro_i18n: Json | null
          is_active: boolean
          local_context_notes: string | null
          slug: string
          source_type: string
          start_time: string | null
          status: string
          story_blocks_i18n: Json
          subtitle_i18n: Json | null
          theme_color: string | null
          title_i18n: Json
          topic_type: string
          translation_status: Json | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          card_style?: string | null
          cover_image_default?: string | null
          cover_image_ru?: string | null
          cover_image_tg?: string | null
          cover_image_url?: string | null
          cover_image_zh?: string | null
          created_at?: string
          created_by?: string | null
          end_time?: string | null
          id?: string
          intro_i18n?: Json | null
          is_active?: boolean
          local_context_notes?: string | null
          slug: string
          source_type?: string
          start_time?: string | null
          status?: string
          story_blocks_i18n?: Json
          subtitle_i18n?: Json | null
          theme_color?: string | null
          title_i18n?: Json
          topic_type?: string
          translation_status?: Json | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          card_style?: string | null
          cover_image_default?: string | null
          cover_image_ru?: string | null
          cover_image_tg?: string | null
          cover_image_url?: string | null
          cover_image_zh?: string | null
          created_at?: string
          created_by?: string | null
          end_time?: string | null
          id?: string
          intro_i18n?: Json | null
          is_active?: boolean
          local_context_notes?: string | null
          slug?: string
          source_type?: string
          start_time?: string | null
          status?: string
          story_blocks_i18n?: Json
          subtitle_i18n?: Json | null
          theme_color?: string | null
          title_i18n?: Json
          topic_type?: string
          translation_status?: Json | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      inventory_products: {
        Row: {
          ai_understanding: Json | null
          barcode: string | null
          created_at: string | null
          currency: string | null
          description: string | null
          description_i18n: Json | null
          details: string | null
          details_i18n: Json | null
          id: string
          image_url: string | null
          image_urls: string[] | null
          material: string | null
          material_i18n: Json | null
          name: string
          name_i18n: Json | null
          original_price: number
          reserved_stock: number | null
          sku: string | null
          specifications: string | null
          specifications_i18n: Json | null
          status: string | null
          stock: number | null
          updated_at: string | null
        }
        Insert: {
          ai_understanding?: Json | null
          barcode?: string | null
          created_at?: string | null
          currency?: string | null
          description?: string | null
          description_i18n?: Json | null
          details?: string | null
          details_i18n?: Json | null
          id?: string
          image_url?: string | null
          image_urls?: string[] | null
          material?: string | null
          material_i18n?: Json | null
          name: string
          name_i18n?: Json | null
          original_price?: number
          reserved_stock?: number | null
          sku?: string | null
          specifications?: string | null
          specifications_i18n?: Json | null
          status?: string | null
          stock?: number | null
          updated_at?: string | null
        }
        Update: {
          ai_understanding?: Json | null
          barcode?: string | null
          created_at?: string | null
          currency?: string | null
          description?: string | null
          description_i18n?: Json | null
          details?: string | null
          details_i18n?: Json | null
          id?: string
          image_url?: string | null
          image_urls?: string[] | null
          material?: string | null
          material_i18n?: Json | null
          name?: string
          name_i18n?: Json | null
          original_price?: number
          reserved_stock?: number | null
          sku?: string | null
          specifications?: string | null
          specifications_i18n?: Json | null
          status?: string | null
          stock?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      inventory_transactions: {
        Row: {
          created_at: string | null
          id: string
          inventory_product_id: string
          notes: string | null
          operator_id: string | null
          quantity: number
          related_lottery_id: string | null
          related_order_id: string | null
          stock_after: number
          stock_before: number
          transaction_type: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          inventory_product_id: string
          notes?: string | null
          operator_id?: string | null
          quantity: number
          related_lottery_id?: string | null
          related_order_id?: string | null
          stock_after: number
          stock_before: number
          transaction_type: string
        }
        Update: {
          created_at?: string | null
          id?: string
          inventory_product_id?: string
          notes?: string | null
          operator_id?: string | null
          quantity?: number
          related_lottery_id?: string | null
          related_order_id?: string | null
          stock_after?: number
          stock_before?: number
          transaction_type?: string
        }
        Relationships: []
      }
      invite_rewards: {
        Row: {
          created_at: string | null
          id: string
          invitee_id: string | null
          inviter_id: string | null
          is_processed: boolean | null
          lucky_coins_awarded: number | null
          processed_at: string | null
          reward_amount: number | null
          reward_type: string | null
          spin_count_awarded: number | null
          status: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          invitee_id?: string | null
          inviter_id?: string | null
          is_processed?: boolean | null
          lucky_coins_awarded?: number | null
          processed_at?: string | null
          reward_amount?: number | null
          reward_type?: string | null
          spin_count_awarded?: number | null
          status?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          invitee_id?: string | null
          inviter_id?: string | null
          is_processed?: boolean | null
          lucky_coins_awarded?: number | null
          processed_at?: string | null
          reward_amount?: number | null
          reward_type?: string | null
          spin_count_awarded?: number | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invite_rewards_invitee_id_fkey"
            columns: ["invitee_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invite_rewards_inviter_id_fkey"
            columns: ["inviter_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      likes: {
        Row: {
          created_at: string | null
          id: string
          post_id: string | null
          target_id: string
          target_type: string
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          post_id?: string | null
          target_id: string
          target_type: string
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          post_id?: string | null
          target_id?: string
          target_type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      localization_lexicon: {
        Row: {
          code: string
          content_i18n: Json
          created_at: string
          example_bad: string | null
          example_good: string | null
          example_i18n: Json | null
          id: string
          is_active: boolean
          lexicon_group: string
          local_anchors: string[] | null
          sort_order: number
          title_i18n: Json
          tone_notes: string | null
          updated_at: string
        }
        Insert: {
          code: string
          content_i18n?: Json
          created_at?: string
          example_bad?: string | null
          example_good?: string | null
          example_i18n?: Json | null
          id?: string
          is_active?: boolean
          lexicon_group: string
          local_anchors?: string[] | null
          sort_order?: number
          title_i18n?: Json
          tone_notes?: string | null
          updated_at?: string
        }
        Update: {
          code?: string
          content_i18n?: Json
          created_at?: string
          example_bad?: string | null
          example_good?: string | null
          example_i18n?: Json | null
          id?: string
          is_active?: boolean
          lexicon_group?: string
          local_anchors?: string[] | null
          sort_order?: number
          title_i18n?: Json
          tone_notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      lotteries: {
        Row: {
          actual_draw_time: string | null
          ai_understanding: Json | null
          algorithm_id: string | null
          created_at: string | null
          currency: string | null
          description: string | null
          description_i18n: Json | null
          draw_algorithm_data: Json | null
          draw_time: string | null
          drawn_at: string | null
          end_time: string | null
          full_purchase_enabled: boolean | null
          full_purchase_price: number | null
          id: string
          image_url: string | null
          image_urls: string[] | null
          inventory_product_id: string | null
          inventory_product_sku: string | null
          is_featured: boolean | null
          material_i18n: Json | null
          max_per_user: number | null
          original_price: number | null
          period: string | null
          price_comparisons: Json | null
          product_id: string | null
          sold_tickets: number | null
          sort_order: number | null
          specifications_i18n: Json | null
          start_time: string | null
          status: string | null
          ticket_price: number | null
          title: string
          title_i18n: Json | null
          total_tickets: number
          unlimited_purchase: boolean | null
          updated_at: string | null
          vrf_proof: string | null
          vrf_timestamp: number | null
          winning_numbers: number[] | null
          winning_ticket_number: number | null
          winning_user_id: string | null
        }
        Insert: {
          actual_draw_time?: string | null
          ai_understanding?: Json | null
          algorithm_id?: string | null
          created_at?: string | null
          currency?: string | null
          description?: string | null
          description_i18n?: Json | null
          draw_algorithm_data?: Json | null
          draw_time?: string | null
          drawn_at?: string | null
          end_time?: string | null
          full_purchase_enabled?: boolean | null
          full_purchase_price?: number | null
          id?: string
          image_url?: string | null
          image_urls?: string[] | null
          inventory_product_id?: string | null
          inventory_product_sku?: string | null
          is_featured?: boolean | null
          material_i18n?: Json | null
          max_per_user?: number | null
          original_price?: number | null
          period?: string | null
          price_comparisons?: Json | null
          product_id?: string | null
          sold_tickets?: number | null
          sort_order?: number | null
          specifications_i18n?: Json | null
          start_time?: string | null
          status?: string | null
          ticket_price?: number | null
          title: string
          title_i18n?: Json | null
          total_tickets?: number
          unlimited_purchase?: boolean | null
          updated_at?: string | null
          vrf_proof?: string | null
          vrf_timestamp?: number | null
          winning_numbers?: number[] | null
          winning_ticket_number?: number | null
          winning_user_id?: string | null
        }
        Update: {
          actual_draw_time?: string | null
          ai_understanding?: Json | null
          algorithm_id?: string | null
          created_at?: string | null
          currency?: string | null
          description?: string | null
          description_i18n?: Json | null
          draw_algorithm_data?: Json | null
          draw_time?: string | null
          drawn_at?: string | null
          end_time?: string | null
          full_purchase_enabled?: boolean | null
          full_purchase_price?: number | null
          id?: string
          image_url?: string | null
          image_urls?: string[] | null
          inventory_product_id?: string | null
          inventory_product_sku?: string | null
          is_featured?: boolean | null
          material_i18n?: Json | null
          max_per_user?: number | null
          original_price?: number | null
          period?: string | null
          price_comparisons?: Json | null
          product_id?: string | null
          sold_tickets?: number | null
          sort_order?: number | null
          specifications_i18n?: Json | null
          start_time?: string | null
          status?: string | null
          ticket_price?: number | null
          title?: string
          title_i18n?: Json | null
          total_tickets?: number
          unlimited_purchase?: boolean | null
          updated_at?: string | null
          vrf_proof?: string | null
          vrf_timestamp?: number | null
          winning_numbers?: number[] | null
          winning_ticket_number?: number | null
          winning_user_id?: string | null
        }
        Relationships: []
      }
      lottery_entries: {
        Row: {
          created_at: string | null
          id: string
          is_winner: boolean | null
          is_winning: boolean | null
          lottery_id: string | null
          numbers: string | null
          order_id: string | null
          participation_code: string | null
          purchase_price: number | null
          status: string | null
          ticket_number: number | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_winner?: boolean | null
          is_winning?: boolean | null
          lottery_id?: string | null
          numbers?: string | null
          order_id?: string | null
          participation_code?: string | null
          purchase_price?: number | null
          status?: string | null
          ticket_number?: number | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_winner?: boolean | null
          is_winning?: boolean | null
          lottery_id?: string | null
          numbers?: string | null
          order_id?: string | null
          participation_code?: string | null
          purchase_price?: number | null
          status?: string | null
          ticket_number?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lottery_entries_lottery_id_fkey"
            columns: ["lottery_id"]
            isOneToOne: false
            referencedRelation: "lotteries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lottery_entries_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lottery_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      lottery_results: {
        Row: {
          algorithm_data: Json | null
          algorithm_type: string | null
          created_at: string | null
          draw_time: string | null
          drawn_at: string | null
          id: string
          lottery_id: string | null
          winner_id: string | null
          winner_ticket_number: number | null
          winner_user_id: string | null
          winning_code: string | null
          winning_ticket_id: string | null
        }
        Insert: {
          algorithm_data?: Json | null
          algorithm_type?: string | null
          created_at?: string | null
          draw_time?: string | null
          drawn_at?: string | null
          id?: string
          lottery_id?: string | null
          winner_id?: string | null
          winner_ticket_number?: number | null
          winner_user_id?: string | null
          winning_code?: string | null
          winning_ticket_id?: string | null
        }
        Update: {
          algorithm_data?: Json | null
          algorithm_type?: string | null
          created_at?: string | null
          draw_time?: string | null
          drawn_at?: string | null
          id?: string
          lottery_id?: string | null
          winner_id?: string | null
          winner_ticket_number?: number | null
          winner_user_id?: string | null
          winning_code?: string | null
          winning_ticket_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lottery_results_lottery_id_fkey"
            columns: ["lottery_id"]
            isOneToOne: true
            referencedRelation: "lotteries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lottery_results_winner_user_id_fkey"
            columns: ["winner_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      managed_invite_codes: {
        Row: {
          channel: string
          code: string
          created_at: string
          id: string
          is_active: boolean
          notes: string | null
          point_id: string | null
          promoter_id: string
          updated_at: string
        }
        Insert: {
          channel?: string
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          point_id?: string | null
          promoter_id: string
          updated_at?: string
        }
        Update: {
          channel?: string
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          point_id?: string | null
          promoter_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "managed_invite_codes_point_id_fkey"
            columns: ["point_id"]
            isOneToOne: false
            referencedRelation: "promotion_points"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "managed_invite_codes_promoter_id_fkey"
            columns: ["promoter_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      market_listings: {
        Row: {
          buyer_id: string | null
          created_at: string | null
          description: string | null
          id: string
          image_urls: string[] | null
          lottery_id: string | null
          original_price: number | null
          price: number
          prize_id: string | null
          seller_id: string | null
          sold_at: string | null
          status: string | null
          ticket_id: string | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          buyer_id?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          image_urls?: string[] | null
          lottery_id?: string | null
          original_price?: number | null
          price: number
          prize_id?: string | null
          seller_id?: string | null
          sold_at?: string | null
          status?: string | null
          ticket_id?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          buyer_id?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          image_urls?: string[] | null
          lottery_id?: string | null
          original_price?: number | null
          price?: number
          prize_id?: string | null
          seller_id?: string | null
          sold_at?: string | null
          status?: string | null
          ticket_id?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "market_listings_lottery_id_fkey"
            columns: ["lottery_id"]
            isOneToOne: false
            referencedRelation: "lotteries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_listings_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      monitoring_alerts: {
        Row: {
          acknowledged_at: string | null
          alert_type: string
          created_at: string | null
          data: Json | null
          id: string
          is_resolved: boolean | null
          message: string | null
          metadata: Json | null
          resolved_at: string | null
          resource: string | null
          resource_id: string | null
          severity: string | null
          source: string | null
          status: string | null
          title: string | null
          triggered_at: string | null
          updated_at: string | null
        }
        Insert: {
          acknowledged_at?: string | null
          alert_type: string
          created_at?: string | null
          data?: Json | null
          id?: string
          is_resolved?: boolean | null
          message?: string | null
          metadata?: Json | null
          resolved_at?: string | null
          resource?: string | null
          resource_id?: string | null
          severity?: string | null
          source?: string | null
          status?: string | null
          title?: string | null
          triggered_at?: string | null
          updated_at?: string | null
        }
        Update: {
          acknowledged_at?: string | null
          alert_type?: string
          created_at?: string | null
          data?: Json | null
          id?: string
          is_resolved?: boolean | null
          message?: string | null
          metadata?: Json | null
          resolved_at?: string | null
          resource?: string | null
          resource_id?: string | null
          severity?: string | null
          source?: string | null
          status?: string | null
          title?: string | null
          triggered_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      notification_queue: {
        Row: {
          attempts: number | null
          channel: string | null
          created_at: string | null
          data: Json | null
          error_message: string | null
          external_message_id: string | null
          id: string
          last_attempt_at: string | null
          max_retries: number | null
          message: string | null
          notification_type: string
          payload: Json | null
          phone_number: string | null
          priority: number | null
          retry_count: number | null
          scheduled_at: string | null
          sent_at: string | null
          status: string | null
          telegram_chat_id: number | null
          title: string | null
          type: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          attempts?: number | null
          channel?: string | null
          created_at?: string | null
          data?: Json | null
          error_message?: string | null
          external_message_id?: string | null
          id?: string
          last_attempt_at?: string | null
          max_retries?: number | null
          message?: string | null
          notification_type: string
          payload?: Json | null
          phone_number?: string | null
          priority?: number | null
          retry_count?: number | null
          scheduled_at?: string | null
          sent_at?: string | null
          status?: string | null
          telegram_chat_id?: number | null
          title?: string | null
          type?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          attempts?: number | null
          channel?: string | null
          created_at?: string | null
          data?: Json | null
          error_message?: string | null
          external_message_id?: string | null
          id?: string
          last_attempt_at?: string | null
          max_retries?: number | null
          message?: string | null
          notification_type?: string
          payload?: Json | null
          phone_number?: string | null
          priority?: number | null
          retry_count?: number | null
          scheduled_at?: string | null
          sent_at?: string | null
          status?: string | null
          telegram_chat_id?: number | null
          title?: string | null
          type?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_queue_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          content: string | null
          created_at: string | null
          data: Json | null
          id: string
          is_read: boolean | null
          message: string | null
          message_i18n: Json | null
          read_at: string | null
          related_id: string | null
          related_type: string | null
          title: string | null
          title_i18n: Json | null
          type: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          content?: string | null
          created_at?: string | null
          data?: Json | null
          id?: string
          is_read?: boolean | null
          message?: string | null
          message_i18n?: Json | null
          read_at?: string | null
          related_id?: string | null
          related_type?: string | null
          title?: string | null
          title_i18n?: Json | null
          type: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          content?: string | null
          created_at?: string | null
          data?: Json | null
          id?: string
          is_read?: boolean | null
          message?: string | null
          message_i18n?: Json | null
          read_at?: string | null
          related_id?: string | null
          related_type?: string | null
          title?: string | null
          title_i18n?: Json | null
          type?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          created_at: string | null
          currency: string | null
          id: string
          lottery_id: string
          order_number: string | null
          payment_method: string | null
          quantity: number | null
          status: string | null
          ticket_count: number | null
          total_amount: number
          type: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          currency?: string | null
          id?: string
          lottery_id: string
          order_number?: string | null
          payment_method?: string | null
          quantity?: number | null
          status?: string | null
          ticket_count?: number | null
          total_amount: number
          type?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          currency?: string | null
          id?: string
          lottery_id?: string
          order_number?: string | null
          payment_method?: string | null
          quantity?: number | null
          status?: string | null
          ticket_count?: number | null
          total_amount?: number
          type?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_lottery_id_fkey"
            columns: ["lottery_id"]
            isOneToOne: false
            referencedRelation: "lotteries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_config: {
        Row: {
          config: Json
          config_data: Json | null
          config_key: string | null
          config_type: string | null
          created_at: string | null
          currency: string | null
          description_i18n: Json | null
          display_order: number | null
          icon_url: string | null
          id: string
          instructions: Json | null
          is_active: boolean | null
          is_enabled: boolean | null
          max_amount: number | null
          min_amount: number | null
          name: string
          name_i18n: Json | null
          provider: string | null
          require_payer_account: boolean | null
          require_payer_name: boolean | null
          require_payer_phone: boolean | null
          sort_order: number | null
          type: string
          updated_at: string | null
        }
        Insert: {
          config?: Json
          config_data?: Json | null
          config_key?: string | null
          config_type?: string | null
          created_at?: string | null
          currency?: string | null
          description_i18n?: Json | null
          display_order?: number | null
          icon_url?: string | null
          id?: string
          instructions?: Json | null
          is_active?: boolean | null
          is_enabled?: boolean | null
          max_amount?: number | null
          min_amount?: number | null
          name: string
          name_i18n?: Json | null
          provider?: string | null
          require_payer_account?: boolean | null
          require_payer_name?: boolean | null
          require_payer_phone?: boolean | null
          sort_order?: number | null
          type: string
          updated_at?: string | null
        }
        Update: {
          config?: Json
          config_data?: Json | null
          config_key?: string | null
          config_type?: string | null
          created_at?: string | null
          currency?: string | null
          description_i18n?: Json | null
          display_order?: number | null
          icon_url?: string | null
          id?: string
          instructions?: Json | null
          is_active?: boolean | null
          is_enabled?: boolean | null
          max_amount?: number | null
          min_amount?: number | null
          name?: string
          name_i18n?: Json | null
          provider?: string | null
          require_payer_account?: boolean | null
          require_payer_name?: boolean | null
          require_payer_phone?: boolean | null
          sort_order?: number | null
          type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      payment_methods: {
        Row: {
          account_name: string | null
          account_number: string | null
          bank_code: string | null
          bank_name_i18n: Json | null
          branch_name_i18n: Json | null
          code: string
          config: Json | null
          created_at: string | null
          id: string
          is_active: boolean | null
          max_amount: number | null
          min_amount: number | null
          name: string
          processing_time_minutes: number | null
          sort_order: number | null
          transfer_note_i18n: Json | null
          type: string | null
          updated_at: string | null
        }
        Insert: {
          account_name?: string | null
          account_number?: string | null
          bank_code?: string | null
          bank_name_i18n?: Json | null
          branch_name_i18n?: Json | null
          code: string
          config?: Json | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          max_amount?: number | null
          min_amount?: number | null
          name: string
          processing_time_minutes?: number | null
          sort_order?: number | null
          transfer_note_i18n?: Json | null
          type?: string | null
          updated_at?: string | null
        }
        Update: {
          account_name?: string | null
          account_number?: string | null
          bank_code?: string | null
          bank_name_i18n?: Json | null
          branch_name_i18n?: Json | null
          code?: string
          config?: Json | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          max_amount?: number | null
          min_amount?: number | null
          name?: string
          processing_time_minutes?: number | null
          sort_order?: number | null
          transfer_note_i18n?: Json | null
          type?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      pickup_logs: {
        Row: {
          action: string | null
          created_at: string | null
          id: string
          notes: string | null
          operation_type: string
          operator_id: string | null
          order_id: string | null
          order_type: string | null
          pickup_code: string | null
          pickup_point_id: string | null
          prize_id: string | null
          proof_image_url: string | null
          source: string | null
        }
        Insert: {
          action?: string | null
          created_at?: string | null
          id?: string
          notes?: string | null
          operation_type: string
          operator_id?: string | null
          order_id?: string | null
          order_type?: string | null
          pickup_code?: string | null
          pickup_point_id?: string | null
          prize_id?: string | null
          proof_image_url?: string | null
          source?: string | null
        }
        Update: {
          action?: string | null
          created_at?: string | null
          id?: string
          notes?: string | null
          operation_type?: string
          operator_id?: string | null
          order_id?: string | null
          order_type?: string | null
          pickup_code?: string | null
          pickup_point_id?: string | null
          prize_id?: string | null
          proof_image_url?: string | null
          source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pickup_logs_pickup_point_id_fkey"
            columns: ["pickup_point_id"]
            isOneToOne: false
            referencedRelation: "pickup_points"
            referencedColumns: ["id"]
          },
        ]
      }
      pickup_points: {
        Row: {
          address: string
          address_i18n: Json | null
          business_hours: Json | null
          city: string | null
          contact_name: string | null
          contact_person: string | null
          contact_phone: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          is_default: boolean | null
          latitude: number | null
          longitude: number | null
          name: string
          name_i18n: Json | null
          phone: string | null
          photos: Json | null
          region: string | null
          sort_order: number | null
          status: string | null
          updated_at: string | null
          working_hours: string | null
          working_hours_i18n: Json | null
        }
        Insert: {
          address: string
          address_i18n?: Json | null
          business_hours?: Json | null
          city?: string | null
          contact_name?: string | null
          contact_person?: string | null
          contact_phone?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          latitude?: number | null
          longitude?: number | null
          name: string
          name_i18n?: Json | null
          phone?: string | null
          photos?: Json | null
          region?: string | null
          sort_order?: number | null
          status?: string | null
          updated_at?: string | null
          working_hours?: string | null
          working_hours_i18n?: Json | null
        }
        Update: {
          address?: string
          address_i18n?: Json | null
          business_hours?: Json | null
          city?: string | null
          contact_name?: string | null
          contact_person?: string | null
          contact_phone?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          latitude?: number | null
          longitude?: number | null
          name?: string
          name_i18n?: Json | null
          phone?: string | null
          photos?: Json | null
          region?: string | null
          sort_order?: number | null
          status?: string | null
          updated_at?: string | null
          working_hours?: string | null
          working_hours_i18n?: Json | null
        }
        Relationships: []
      }
      pickup_staff_profiles: {
        Row: {
          created_at: string | null
          created_by: string | null
          point_id: string | null
          status: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          point_id?: string | null
          status?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          point_id?: string | null
          status?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pickup_staff_profiles_point_id_fkey"
            columns: ["point_id"]
            isOneToOne: false
            referencedRelation: "pickup_points"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickup_staff_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      prizes: {
        Row: {
          algorithm_data: Json | null
          batch_id: string | null
          claimed_at: string | null
          created_at: string | null
          expires_at: string | null
          id: string
          logistics_status: string | null
          lottery_id: string
          order_number: string | null
          order_type: string | null
          picked_up_at: string | null
          picked_up_by: string | null
          pickup_code: string | null
          pickup_point_id: string | null
          pickup_status: string | null
          prize_image: string | null
          prize_name: string
          prize_name_i18n: Json | null
          prize_value: number | null
          processed_at: string | null
          status: string | null
          ticket_id: string | null
          updated_at: string | null
          user_id: string
          winning_code: string
          won_at: string | null
        }
        Insert: {
          algorithm_data?: Json | null
          batch_id?: string | null
          claimed_at?: string | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          logistics_status?: string | null
          lottery_id: string
          order_number?: string | null
          order_type?: string | null
          picked_up_at?: string | null
          picked_up_by?: string | null
          pickup_code?: string | null
          pickup_point_id?: string | null
          pickup_status?: string | null
          prize_image?: string | null
          prize_name: string
          prize_name_i18n?: Json | null
          prize_value?: number | null
          processed_at?: string | null
          status?: string | null
          ticket_id?: string | null
          updated_at?: string | null
          user_id: string
          winning_code: string
          won_at?: string | null
        }
        Update: {
          algorithm_data?: Json | null
          batch_id?: string | null
          claimed_at?: string | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          logistics_status?: string | null
          lottery_id?: string
          order_number?: string | null
          order_type?: string | null
          picked_up_at?: string | null
          picked_up_by?: string | null
          pickup_code?: string | null
          pickup_point_id?: string | null
          pickup_status?: string | null
          prize_image?: string | null
          prize_name?: string
          prize_name_i18n?: Json | null
          prize_value?: number | null
          processed_at?: string | null
          status?: string | null
          ticket_id?: string | null
          updated_at?: string | null
          user_id?: string
          winning_code?: string
          won_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_prizes_batch_id"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batch_statistics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_prizes_batch_id"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "shipment_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_prizes_pickup_point"
            columns: ["pickup_point_id"]
            isOneToOne: false
            referencedRelation: "pickup_points"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prizes_lottery_id_fkey"
            columns: ["lottery_id"]
            isOneToOne: false
            referencedRelation: "lotteries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prizes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      product_categories: {
        Row: {
          category_id: string
          created_at: string
          id: string
          product_id: string
        }
        Insert: {
          category_id: string
          created_at?: string
          id?: string
          product_id: string
        }
        Update: {
          category_id?: string
          created_at?: string
          id?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_categories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "homepage_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_categories_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "inventory_products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_tags: {
        Row: {
          created_at: string
          id: string
          product_id: string
          tag_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          product_id: string
          tag_id: string
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_tags_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "inventory_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "homepage_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          category: string | null
          created_at: string | null
          description: string | null
          id: string
          image_url: string | null
          is_active: boolean | null
          name: string
          price: number | null
          stock: number | null
          updated_at: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          name: string
          price?: number | null
          stock?: number | null
          updated_at?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          name?: string
          price?: number | null
          stock?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      promoter_daily_logs: {
        Row: {
          contact_count: number
          created_at: string
          id: string
          log_date: string
          note: string | null
          promoter_id: string
          updated_at: string
        }
        Insert: {
          contact_count?: number
          created_at?: string
          id?: string
          log_date?: string
          note?: string | null
          promoter_id: string
          updated_at?: string
        }
        Update: {
          contact_count?: number
          created_at?: string
          id?: string
          log_date?: string
          note?: string | null
          promoter_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "promoter_daily_logs_promoter_id_fkey"
            columns: ["promoter_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      promoter_deposits: {
        Row: {
          amount: number
          bonus_amount: number | null
          created_at: string
          currency: string
          id: string
          idempotency_key: string | null
          note: string | null
          promoter_id: string
          status: string
          target_user_id: string
          transaction_id: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          bonus_amount?: number | null
          created_at?: string
          currency?: string
          id?: string
          idempotency_key?: string | null
          note?: string | null
          promoter_id: string
          status?: string
          target_user_id: string
          transaction_id?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          bonus_amount?: number | null
          created_at?: string
          currency?: string
          id?: string
          idempotency_key?: string | null
          note?: string | null
          promoter_id?: string
          status?: string
          target_user_id?: string
          transaction_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "promoter_deposits_promoter_id_fkey"
            columns: ["promoter_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promoter_deposits_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      promoter_profiles: {
        Row: {
          created_at: string
          daily_base_salary: number
          daily_count_limit: number | null
          daily_deposit_limit: number | null
          hire_date: string | null
          point_id: string | null
          promoter_status: string
          subsidy_balance: number | null
          team_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          daily_base_salary?: number
          daily_count_limit?: number | null
          daily_deposit_limit?: number | null
          hire_date?: string | null
          point_id?: string | null
          promoter_status?: string
          subsidy_balance?: number | null
          team_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          daily_base_salary?: number
          daily_count_limit?: number | null
          daily_deposit_limit?: number | null
          hire_date?: string | null
          point_id?: string | null
          promoter_status?: string
          subsidy_balance?: number | null
          team_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "promoter_profiles_point_id_fkey"
            columns: ["point_id"]
            isOneToOne: false
            referencedRelation: "promotion_points"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promoter_profiles_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "promoter_teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promoter_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      promoter_settlements: {
        Row: {
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          id: string
          note: string | null
          promoter_id: string
          proof_image_url: string | null
          settlement_amount: number | null
          settlement_date: string
          settlement_method: string | null
          settlement_status: string
          total_deposit_amount: number
          total_deposit_count: number
          updated_at: string
        }
        Insert: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          id?: string
          note?: string | null
          promoter_id: string
          proof_image_url?: string | null
          settlement_amount?: number | null
          settlement_date: string
          settlement_method?: string | null
          settlement_status?: string
          total_deposit_amount?: number
          total_deposit_count?: number
          updated_at?: string
        }
        Update: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          id?: string
          note?: string | null
          promoter_id?: string
          proof_image_url?: string | null
          settlement_amount?: number | null
          settlement_date?: string
          settlement_method?: string | null
          settlement_status?: string
          total_deposit_amount?: number
          total_deposit_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "promoter_settlements_promoter_id_fkey"
            columns: ["promoter_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      promoter_teams: {
        Row: {
          created_at: string
          id: string
          leader_user_id: string | null
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          leader_user_id?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          leader_user_id?: string | null
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "promoter_teams_leader_user_id_fkey"
            columns: ["leader_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      promotion_points: {
        Row: {
          address: string | null
          area_size: string
          created_at: string
          id: string
          latitude: number | null
          longitude: number | null
          name: string
          point_status: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          area_size?: string
          created_at?: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          name: string
          point_status?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          area_size?: string
          created_at?: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          name?: string
          point_status?: string
          updated_at?: string
        }
        Relationships: []
      }
      referrals: {
        Row: {
          created_at: string | null
          id: string
          level: number | null
          referee_id: string | null
          referred_id: string | null
          referrer_id: string | null
          status: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          level?: number | null
          referee_id?: string | null
          referred_id?: string | null
          referrer_id?: string | null
          status?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          level?: number | null
          referee_id?: string | null
          referred_id?: string | null
          referrer_id?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "referrals_referee_id_fkey"
            columns: ["referee_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      resale_items: {
        Row: {
          created_at: string | null
          discount_percentage: number | null
          id: string
          is_active: boolean | null
          listing_price: number | null
          lottery_id: string | null
          price: number | null
          resale_id: string | null
          seller_id: string | null
          ticket_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          discount_percentage?: number | null
          id?: string
          is_active?: boolean | null
          listing_price?: number | null
          lottery_id?: string | null
          price?: number | null
          resale_id?: string | null
          seller_id?: string | null
          ticket_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          discount_percentage?: number | null
          id?: string
          is_active?: boolean | null
          listing_price?: number | null
          lottery_id?: string | null
          price?: number | null
          resale_id?: string | null
          seller_id?: string | null
          ticket_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "resale_items_lottery_id_fkey"
            columns: ["lottery_id"]
            isOneToOne: false
            referencedRelation: "lotteries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resale_items_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      resales: {
        Row: {
          buyer_id: string | null
          created_at: string | null
          id: string
          listed_at: string | null
          lottery_id: string | null
          original_price: number | null
          resale_price: number | null
          seller_id: string | null
          sold_at: string | null
          status: string | null
          ticket_id: string | null
          total_amount: number | null
          updated_at: string | null
        }
        Insert: {
          buyer_id?: string | null
          created_at?: string | null
          id?: string
          listed_at?: string | null
          lottery_id?: string | null
          original_price?: number | null
          resale_price?: number | null
          seller_id?: string | null
          sold_at?: string | null
          status?: string | null
          ticket_id?: string | null
          total_amount?: number | null
          updated_at?: string | null
        }
        Update: {
          buyer_id?: string | null
          created_at?: string | null
          id?: string
          listed_at?: string | null
          lottery_id?: string | null
          original_price?: number | null
          resale_price?: number | null
          seller_id?: string | null
          sold_at?: string | null
          status?: string | null
          ticket_id?: string | null
          total_amount?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "resales_lottery_id_fkey"
            columns: ["lottery_id"]
            isOneToOne: false
            referencedRelation: "lotteries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resales_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          permission: string
          permissions: Json | null
          role: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          permission: string
          permissions?: Json | null
          role: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          permission?: string
          permissions?: Json | null
          role?: string
        }
        Relationships: []
      }
      sessions_null_count: {
        Row: {
          checked_at: string | null
          count: number | null
          id: number
          null_count: number | null
          table_name: string | null
          total_count: number | null
        }
        Insert: {
          checked_at?: string | null
          count?: number | null
          id?: number
          null_count?: number | null
          table_name?: string | null
          total_count?: number | null
        }
        Update: {
          checked_at?: string | null
          count?: number | null
          id?: number
          null_count?: number | null
          table_name?: string | null
          total_count?: number | null
        }
        Relationships: []
      }
      share_logs: {
        Row: {
          created_at: string | null
          id: string
          platform: string | null
          share_data: Json | null
          share_target: string | null
          share_type: string | null
          shared_at: string | null
          target_id: string | null
          target_type: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          platform?: string | null
          share_data?: Json | null
          share_target?: string | null
          share_type?: string | null
          shared_at?: string | null
          target_id?: string | null
          target_type?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          platform?: string | null
          share_data?: Json | null
          share_target?: string | null
          share_type?: string | null
          shared_at?: string | null
          target_id?: string | null
          target_type?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "share_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_batches: {
        Row: {
          admin_note: string | null
          arrival_notes: string | null
          arrival_photos: string[] | null
          arrived_at: string | null
          batch_no: string
          china_tracking_no: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string | null
          created_by: string
          damaged_orders: number | null
          estimated_arrival_date: string | null
          id: string
          metadata: Json | null
          missing_orders: number | null
          normal_orders: number | null
          shipped_at: string
          status: string
          tajikistan_tracking_no: string | null
          total_orders: number | null
          updated_at: string | null
        }
        Insert: {
          admin_note?: string | null
          arrival_notes?: string | null
          arrival_photos?: string[] | null
          arrived_at?: string | null
          batch_no: string
          china_tracking_no?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string | null
          created_by: string
          damaged_orders?: number | null
          estimated_arrival_date?: string | null
          id?: string
          metadata?: Json | null
          missing_orders?: number | null
          normal_orders?: number | null
          shipped_at?: string
          status?: string
          tajikistan_tracking_no?: string | null
          total_orders?: number | null
          updated_at?: string | null
        }
        Update: {
          admin_note?: string | null
          arrival_notes?: string | null
          arrival_photos?: string[] | null
          arrived_at?: string | null
          batch_no?: string
          china_tracking_no?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string | null
          created_by?: string
          damaged_orders?: number | null
          estimated_arrival_date?: string | null
          id?: string
          metadata?: Json | null
          missing_orders?: number | null
          normal_orders?: number | null
          shipped_at?: string
          status?: string
          tajikistan_tracking_no?: string | null
          total_orders?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      shipping: {
        Row: {
          address_id: string | null
          admin_notes: string | null
          carrier: string | null
          created_at: string | null
          delivered_at: string | null
          id: string
          notes: string | null
          order_id: string | null
          order_type: string | null
          prize_id: string | null
          recipient_address: string | null
          recipient_city: string | null
          recipient_country: string | null
          recipient_name: string | null
          recipient_phone: string | null
          recipient_postal_code: string | null
          recipient_region: string | null
          requested_at: string | null
          shipped_at: string | null
          shipping_company: string | null
          shipping_cost: number | null
          shipping_method: string | null
          status: string | null
          tracking_number: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          address_id?: string | null
          admin_notes?: string | null
          carrier?: string | null
          created_at?: string | null
          delivered_at?: string | null
          id?: string
          notes?: string | null
          order_id?: string | null
          order_type?: string | null
          prize_id?: string | null
          recipient_address?: string | null
          recipient_city?: string | null
          recipient_country?: string | null
          recipient_name?: string | null
          recipient_phone?: string | null
          recipient_postal_code?: string | null
          recipient_region?: string | null
          requested_at?: string | null
          shipped_at?: string | null
          shipping_company?: string | null
          shipping_cost?: number | null
          shipping_method?: string | null
          status?: string | null
          tracking_number?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          address_id?: string | null
          admin_notes?: string | null
          carrier?: string | null
          created_at?: string | null
          delivered_at?: string | null
          id?: string
          notes?: string | null
          order_id?: string | null
          order_type?: string | null
          prize_id?: string | null
          recipient_address?: string | null
          recipient_city?: string | null
          recipient_country?: string | null
          recipient_name?: string | null
          recipient_phone?: string | null
          recipient_postal_code?: string | null
          recipient_region?: string | null
          requested_at?: string | null
          shipped_at?: string | null
          shipping_company?: string | null
          shipping_cost?: number | null
          shipping_method?: string | null
          status?: string | null
          tracking_number?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipping_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      shipping_addresses: {
        Row: {
          address: string
          city: string | null
          country: string | null
          created_at: string | null
          district: string | null
          id: string
          is_default: boolean | null
          phone: string
          postal_code: string | null
          recipient_name: string
          recipient_phone: string | null
          region: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          address: string
          city?: string | null
          country?: string | null
          created_at?: string | null
          district?: string | null
          id?: string
          is_default?: boolean | null
          phone: string
          postal_code?: string | null
          recipient_name: string
          recipient_phone?: string | null
          region?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          address?: string
          city?: string | null
          country?: string | null
          created_at?: string | null
          district?: string | null
          id?: string
          is_default?: boolean | null
          phone?: string
          postal_code?: string | null
          recipient_name?: string
          recipient_phone?: string | null
          region?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipping_addresses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      shipping_history: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          location: string | null
          operator_id: string | null
          shipping_id: string | null
          shipping_record_id: string | null
          shipping_request_id: string | null
          status: string
          timestamp: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          location?: string | null
          operator_id?: string | null
          shipping_id?: string | null
          shipping_record_id?: string | null
          shipping_request_id?: string | null
          status: string
          timestamp?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          location?: string | null
          operator_id?: string | null
          shipping_id?: string | null
          shipping_record_id?: string | null
          shipping_request_id?: string | null
          status?: string
          timestamp?: string | null
        }
        Relationships: []
      }
      shipping_records: {
        Row: {
          carrier: string | null
          created_at: string | null
          delivered_at: string | null
          id: string
          notes: string | null
          order_id: string | null
          order_type: string | null
          prize_id: string | null
          recipient_name: string | null
          recipient_phone: string | null
          shipped_at: string | null
          shipping_address: string | null
          shipping_company: string | null
          status: string | null
          tracking_number: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          carrier?: string | null
          created_at?: string | null
          delivered_at?: string | null
          id?: string
          notes?: string | null
          order_id?: string | null
          order_type?: string | null
          prize_id?: string | null
          recipient_name?: string | null
          recipient_phone?: string | null
          shipped_at?: string | null
          shipping_address?: string | null
          shipping_company?: string | null
          status?: string | null
          tracking_number?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          carrier?: string | null
          created_at?: string | null
          delivered_at?: string | null
          id?: string
          notes?: string | null
          order_id?: string | null
          order_type?: string | null
          prize_id?: string | null
          recipient_name?: string | null
          recipient_phone?: string | null
          shipped_at?: string | null
          shipping_address?: string | null
          shipping_company?: string | null
          status?: string | null
          tracking_number?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipping_records_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      shipping_requests: {
        Row: {
          address_id: string | null
          admin_note: string | null
          created_at: string | null
          delivered_at: string | null
          id: string
          lottery_id: string | null
          order_id: string | null
          prize_id: string | null
          processed_at: string | null
          recipient_address: string | null
          recipient_city: string | null
          recipient_country: string | null
          recipient_name: string | null
          recipient_phone: string | null
          recipient_postal_code: string | null
          recipient_region: string | null
          requested_at: string | null
          reviewed_at: string | null
          shipped_at: string | null
          status: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          address_id?: string | null
          admin_note?: string | null
          created_at?: string | null
          delivered_at?: string | null
          id?: string
          lottery_id?: string | null
          order_id?: string | null
          prize_id?: string | null
          processed_at?: string | null
          recipient_address?: string | null
          recipient_city?: string | null
          recipient_country?: string | null
          recipient_name?: string | null
          recipient_phone?: string | null
          recipient_postal_code?: string | null
          recipient_region?: string | null
          requested_at?: string | null
          reviewed_at?: string | null
          shipped_at?: string | null
          status?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          address_id?: string | null
          admin_note?: string | null
          created_at?: string | null
          delivered_at?: string | null
          id?: string
          lottery_id?: string | null
          order_id?: string | null
          prize_id?: string | null
          processed_at?: string | null
          recipient_address?: string | null
          recipient_city?: string | null
          recipient_country?: string | null
          recipient_name?: string | null
          recipient_phone?: string | null
          recipient_postal_code?: string | null
          recipient_region?: string | null
          requested_at?: string | null
          reviewed_at?: string | null
          shipped_at?: string | null
          status?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipping_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      showoff_comments: {
        Row: {
          content: string
          created_at: string | null
          id: string
          is_deleted: boolean | null
          parent_id: string | null
          post_id: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: string
          is_deleted?: boolean | null
          parent_id?: string | null
          post_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: string
          is_deleted?: boolean | null
          parent_id?: string | null
          post_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "showoff_comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      showoff_likes: {
        Row: {
          created_at: string | null
          id: string
          post_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          post_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          post_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "showoff_likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      showoff_posts: {
        Row: {
          comments_count: number | null
          content: string | null
          created_at: string | null
          id: string
          image_urls: string[] | null
          images: string[] | null
          likes_count: number | null
          lottery_id: string | null
          prize_id: string | null
          reviewed_at: string | null
          reviewer_id: string | null
          status: string | null
          title: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          comments_count?: number | null
          content?: string | null
          created_at?: string | null
          id?: string
          image_urls?: string[] | null
          images?: string[] | null
          likes_count?: number | null
          lottery_id?: string | null
          prize_id?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          status?: string | null
          title?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          comments_count?: number | null
          content?: string | null
          created_at?: string | null
          id?: string
          image_urls?: string[] | null
          images?: string[] | null
          likes_count?: number | null
          lottery_id?: string | null
          prize_id?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          status?: string | null
          title?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "showoff_posts_lottery_id_fkey"
            columns: ["lottery_id"]
            isOneToOne: false
            referencedRelation: "lotteries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "showoff_posts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      showoffs: {
        Row: {
          admin_note: string | null
          approved_at: string | null
          comments_count: number | null
          content: string | null
          created_at: string | null
          display_avatar_url: string | null
          display_username: string | null
          id: string
          image_urls: string[] | null
          images: string[] | null
          inventory_product_id: string | null
          is_hidden: boolean
          likes_count: number | null
          lottery_id: string | null
          prize_id: string | null
          rejected_reason: string | null
          reviewed_at: string | null
          reward_coins: number | null
          source: string
          status: string | null
          title: string | null
          title_i18n: Json | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          admin_note?: string | null
          approved_at?: string | null
          comments_count?: number | null
          content?: string | null
          created_at?: string | null
          display_avatar_url?: string | null
          display_username?: string | null
          id?: string
          image_urls?: string[] | null
          images?: string[] | null
          inventory_product_id?: string | null
          is_hidden?: boolean
          likes_count?: number | null
          lottery_id?: string | null
          prize_id?: string | null
          rejected_reason?: string | null
          reviewed_at?: string | null
          reward_coins?: number | null
          source?: string
          status?: string | null
          title?: string | null
          title_i18n?: Json | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          admin_note?: string | null
          approved_at?: string | null
          comments_count?: number | null
          content?: string | null
          created_at?: string | null
          display_avatar_url?: string | null
          display_username?: string | null
          id?: string
          image_urls?: string[] | null
          images?: string[] | null
          inventory_product_id?: string | null
          is_hidden?: boolean
          likes_count?: number | null
          lottery_id?: string | null
          prize_id?: string | null
          rejected_reason?: string | null
          reviewed_at?: string | null
          reward_coins?: number | null
          source?: string
          status?: string | null
          title?: string | null
          title_i18n?: Json | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "showoffs_lottery_id_fkey"
            columns: ["lottery_id"]
            isOneToOne: false
            referencedRelation: "lotteries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "showoffs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      spin_records: {
        Row: {
          created_at: string | null
          id: string
          is_winner: boolean | null
          reward_amount: number | null
          reward_id: string | null
          reward_name: string | null
          reward_type: string | null
          spin_source: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_winner?: boolean | null
          reward_amount?: number | null
          reward_id?: string | null
          reward_name?: string | null
          reward_type?: string | null
          spin_source?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_winner?: boolean | null
          reward_amount?: number | null
          reward_id?: string | null
          reward_name?: string | null
          reward_type?: string | null
          spin_source?: string | null
          user_id?: string
        }
        Relationships: []
      }
      spin_rewards: {
        Row: {
          created_at: string | null
          display_order: number | null
          id: string
          is_active: boolean | null
          is_jackpot: boolean | null
          probability: number
          reward_amount: number | null
          reward_name: string
          reward_name_i18n: Json | null
          reward_type: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean | null
          is_jackpot?: boolean | null
          probability: number
          reward_amount?: number | null
          reward_name: string
          reward_name_i18n?: Json | null
          reward_type?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean | null
          is_jackpot?: boolean | null
          probability?: number
          reward_amount?: number | null
          reward_name?: string
          reward_name_i18n?: Json | null
          reward_type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      system_config: {
        Row: {
          description: string | null
          key: string
          updated_at: string | null
          value: Json
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string | null
          value: Json
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string | null
          value?: Json
        }
        Relationships: []
      }
      tickets: {
        Row: {
          created_at: string | null
          id: string
          is_winning: boolean | null
          lottery_id: string | null
          order_id: string | null
          ticket_number: number
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_winning?: boolean | null
          lottery_id?: string | null
          order_id?: string | null
          ticket_number: number
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_winning?: boolean | null
          lottery_id?: string | null
          order_id?: string | null
          ticket_number?: number
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tickets_lottery_id_fkey"
            columns: ["lottery_id"]
            isOneToOne: false
            referencedRelation: "lotteries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      topic_placements: {
        Row: {
          card_variant_name: string | null
          cover_image_default: string | null
          cover_image_ru: string | null
          cover_image_tg: string | null
          cover_image_zh: string | null
          created_at: string
          end_time: string | null
          feed_position: number
          id: string
          is_active: boolean
          placement_name: string
          sort_order: number
          start_time: string | null
          subtitle_i18n: Json | null
          title_i18n: Json | null
          topic_id: string
          updated_at: string
        }
        Insert: {
          card_variant_name?: string | null
          cover_image_default?: string | null
          cover_image_ru?: string | null
          cover_image_tg?: string | null
          cover_image_zh?: string | null
          created_at?: string
          end_time?: string | null
          feed_position?: number
          id?: string
          is_active?: boolean
          placement_name?: string
          sort_order?: number
          start_time?: string | null
          subtitle_i18n?: Json | null
          title_i18n?: Json | null
          topic_id: string
          updated_at?: string
        }
        Update: {
          card_variant_name?: string | null
          cover_image_default?: string | null
          cover_image_ru?: string | null
          cover_image_tg?: string | null
          cover_image_zh?: string | null
          created_at?: string
          end_time?: string | null
          feed_position?: number
          id?: string
          is_active?: boolean
          placement_name?: string
          sort_order?: number
          start_time?: string | null
          subtitle_i18n?: Json | null
          title_i18n?: Json | null
          topic_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "topic_placements_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "homepage_topics"
            referencedColumns: ["id"]
          },
        ]
      }
      topic_products: {
        Row: {
          badge_text_i18n: Json | null
          created_at: string
          id: string
          note_i18n: Json | null
          product_id: string
          sort_order: number
          story_group: number | null
          story_text_i18n: Json | null
          topic_id: string
          updated_at: string
        }
        Insert: {
          badge_text_i18n?: Json | null
          created_at?: string
          id?: string
          note_i18n?: Json | null
          product_id: string
          sort_order?: number
          story_group?: number | null
          story_text_i18n?: Json | null
          topic_id: string
          updated_at?: string
        }
        Update: {
          badge_text_i18n?: Json | null
          created_at?: string
          id?: string
          note_i18n?: Json | null
          product_id?: string
          sort_order?: number
          story_group?: number | null
          story_text_i18n?: Json | null
          topic_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "topic_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "inventory_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_products_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "homepage_topics"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          amount: number
          balance_after: number | null
          balance_before: number | null
          created_at: string | null
          currency: string | null
          description: string | null
          id: string
          notes: string | null
          reference_id: string | null
          reference_type: string | null
          related_id: string | null
          related_type: string | null
          status: string | null
          type: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          amount: number
          balance_after?: number | null
          balance_before?: number | null
          created_at?: string | null
          currency?: string | null
          description?: string | null
          id?: string
          notes?: string | null
          reference_id?: string | null
          reference_type?: string | null
          related_id?: string | null
          related_type?: string | null
          status?: string | null
          type: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          amount?: number
          balance_after?: number | null
          balance_before?: number | null
          created_at?: string | null
          currency?: string | null
          description?: string | null
          id?: string
          notes?: string | null
          reference_id?: string | null
          reference_type?: string | null
          related_id?: string | null
          related_type?: string | null
          status?: string | null
          type?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_behavior_events: {
        Row: {
          created_at: string
          device_info: Json | null
          entity_id: string | null
          entity_type: string | null
          event_name: string
          id: string
          inventory_product_id: string | null
          lottery_id: string | null
          metadata: Json
          order_id: string | null
          page_name: string
          position: string | null
          session_id: string
          source_category_id: string | null
          source_page: string | null
          source_placement_id: string | null
          source_topic_id: string | null
          trace_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          device_info?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          event_name: string
          id?: string
          inventory_product_id?: string | null
          lottery_id?: string | null
          metadata?: Json
          order_id?: string | null
          page_name: string
          position?: string | null
          session_id: string
          source_category_id?: string | null
          source_page?: string | null
          source_placement_id?: string | null
          source_topic_id?: string | null
          trace_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          device_info?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          event_name?: string
          id?: string
          inventory_product_id?: string | null
          lottery_id?: string | null
          metadata?: Json
          order_id?: string | null
          page_name?: string
          position?: string | null
          session_id?: string
          source_category_id?: string | null
          source_page?: string | null
          source_placement_id?: string | null
          source_topic_id?: string | null
          trace_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string | null
          display_name: string | null
          full_name: string | null
          id: string
          id_card_name: string | null
          id_card_number: string | null
          kyc_level: number | null
          kyc_status: string | null
          language: string | null
          language_code: string | null
          location: string | null
          timezone: string | null
          total_lotteries: number | null
          total_spent: number | null
          total_won: number | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string | null
          display_name?: string | null
          full_name?: string | null
          id?: string
          id_card_name?: string | null
          id_card_number?: string | null
          kyc_level?: number | null
          kyc_status?: string | null
          language?: string | null
          language_code?: string | null
          location?: string | null
          timezone?: string | null
          total_lotteries?: number | null
          total_spent?: number | null
          total_won?: number | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string | null
          display_name?: string | null
          full_name?: string | null
          id?: string
          id_card_name?: string | null
          id_card_number?: string | null
          kyc_level?: number | null
          kyc_status?: string | null
          language?: string | null
          language_code?: string | null
          location?: string | null
          timezone?: string | null
          total_lotteries?: number | null
          total_spent?: number | null
          total_won?: number | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_sessions: {
        Row: {
          created_at: string | null
          device_info: Json | null
          expires_at: string | null
          id: string
          ip_address: string | null
          is_active: boolean | null
          session_token: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          device_info?: Json | null
          expires_at?: string | null
          id?: string
          ip_address?: string | null
          is_active?: boolean | null
          session_token?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          device_info?: Json | null
          expires_at?: string | null
          id?: string
          ip_address?: string | null
          is_active?: boolean | null
          session_token?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_spin_balance: {
        Row: {
          created_at: string | null
          id: string
          last_spin_at: string | null
          spin_count: number | null
          total_earned: number | null
          total_spins_used: number | null
          total_used: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          last_spin_at?: string | null
          spin_count?: number | null
          total_earned?: number | null
          total_spins_used?: number | null
          total_used?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          last_spin_at?: string | null
          spin_count?: number | null
          total_earned?: number | null
          total_spins_used?: number | null
          total_used?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          avatar: string | null
          avatar_url: string | null
          balance: number | null
          bonus_balance: number | null
          commission_balance: number | null
          commission_rate: number | null
          created_at: string | null
          deleted_at: string | null
          display_name: string | null
          email: string | null
          first_name: string | null
          has_completed_onboarding: boolean | null
          id: string
          invite_code: string | null
          invited_by: string | null
          is_active: boolean | null
          is_blocked: boolean | null
          is_verified: boolean | null
          kyc_level: string | null
          language_code: string | null
          last_active_at: string | null
          last_login_at: string | null
          last_name: string | null
          level: number | null
          lucky_coins: number | null
          onboarding_completed: boolean | null
          password_hash: string | null
          phone_number: string | null
          preferred_language: string | null
          referral_code: string | null
          referral_count: number | null
          referral_level: number | null
          referred_by: string | null
          referred_by_id: string | null
          referrer_id: string | null
          status: string | null
          telegram_id: string | null
          telegram_username: string | null
          total_lotteries: number | null
          total_spent: number | null
          total_won: number | null
          two_factor_enabled: boolean | null
          updated_at: string | null
          vip_level: number | null
          whatsapp_opt_in: boolean | null
          winning_rate: number | null
        }
        Insert: {
          avatar?: string | null
          avatar_url?: string | null
          balance?: number | null
          bonus_balance?: number | null
          commission_balance?: number | null
          commission_rate?: number | null
          created_at?: string | null
          deleted_at?: string | null
          display_name?: string | null
          email?: string | null
          first_name?: string | null
          has_completed_onboarding?: boolean | null
          id?: string
          invite_code?: string | null
          invited_by?: string | null
          is_active?: boolean | null
          is_blocked?: boolean | null
          is_verified?: boolean | null
          kyc_level?: string | null
          language_code?: string | null
          last_active_at?: string | null
          last_login_at?: string | null
          last_name?: string | null
          level?: number | null
          lucky_coins?: number | null
          onboarding_completed?: boolean | null
          password_hash?: string | null
          phone_number?: string | null
          preferred_language?: string | null
          referral_code?: string | null
          referral_count?: number | null
          referral_level?: number | null
          referred_by?: string | null
          referred_by_id?: string | null
          referrer_id?: string | null
          status?: string | null
          telegram_id?: string | null
          telegram_username?: string | null
          total_lotteries?: number | null
          total_spent?: number | null
          total_won?: number | null
          two_factor_enabled?: boolean | null
          updated_at?: string | null
          vip_level?: number | null
          whatsapp_opt_in?: boolean | null
          winning_rate?: number | null
        }
        Update: {
          avatar?: string | null
          avatar_url?: string | null
          balance?: number | null
          bonus_balance?: number | null
          commission_balance?: number | null
          commission_rate?: number | null
          created_at?: string | null
          deleted_at?: string | null
          display_name?: string | null
          email?: string | null
          first_name?: string | null
          has_completed_onboarding?: boolean | null
          id?: string
          invite_code?: string | null
          invited_by?: string | null
          is_active?: boolean | null
          is_blocked?: boolean | null
          is_verified?: boolean | null
          kyc_level?: string | null
          language_code?: string | null
          last_active_at?: string | null
          last_login_at?: string | null
          last_name?: string | null
          level?: number | null
          lucky_coins?: number | null
          onboarding_completed?: boolean | null
          password_hash?: string | null
          phone_number?: string | null
          preferred_language?: string | null
          referral_code?: string | null
          referral_count?: number | null
          referral_level?: number | null
          referred_by?: string | null
          referred_by_id?: string | null
          referrer_id?: string | null
          status?: string | null
          telegram_id?: string | null
          telegram_username?: string | null
          total_lotteries?: number | null
          total_spent?: number | null
          total_won?: number | null
          two_factor_enabled?: boolean | null
          updated_at?: string | null
          vip_level?: number | null
          whatsapp_opt_in?: boolean | null
          winning_rate?: number | null
        }
        Relationships: []
      }
      v_config_value: {
        Row: {
          value: Json | null
        }
        Insert: {
          value?: Json | null
        }
        Update: {
          value?: Json | null
        }
        Relationships: []
      }
      wallet_transactions: {
        Row: {
          amount: number
          balance_after: number | null
          balance_before: number | null
          created_at: string | null
          description: string | null
          id: string
          metadata: Json | null
          processed_at: string | null
          reference_id: string | null
          reference_type: string | null
          related_id: string | null
          related_lottery_id: string | null
          related_order_id: string | null
          status: string | null
          type: string
          updated_at: string | null
          wallet_id: string
        }
        Insert: {
          amount: number
          balance_after?: number | null
          balance_before?: number | null
          created_at?: string | null
          description?: string | null
          id?: string
          metadata?: Json | null
          processed_at?: string | null
          reference_id?: string | null
          reference_type?: string | null
          related_id?: string | null
          related_lottery_id?: string | null
          related_order_id?: string | null
          status?: string | null
          type: string
          updated_at?: string | null
          wallet_id: string
        }
        Update: {
          amount?: number
          balance_after?: number | null
          balance_before?: number | null
          created_at?: string | null
          description?: string | null
          id?: string
          metadata?: Json | null
          processed_at?: string | null
          reference_id?: string | null
          reference_type?: string | null
          related_id?: string | null
          related_lottery_id?: string | null
          related_order_id?: string | null
          status?: string | null
          type?: string
          updated_at?: string | null
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallet_transactions_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      wallets: {
        Row: {
          balance: number | null
          created_at: string | null
          currency: string | null
          first_deposit_bonus_amount: number | null
          first_deposit_bonus_claimed: boolean | null
          frozen_balance: number | null
          id: string
          is_active: boolean | null
          is_bonus: boolean | null
          total_deposits: number | null
          total_withdrawals: number | null
          type: string
          updated_at: string | null
          user_id: string
          version: number | null
        }
        Insert: {
          balance?: number | null
          created_at?: string | null
          currency?: string | null
          first_deposit_bonus_amount?: number | null
          first_deposit_bonus_claimed?: boolean | null
          frozen_balance?: number | null
          id?: string
          is_active?: boolean | null
          is_bonus?: boolean | null
          total_deposits?: number | null
          total_withdrawals?: number | null
          type?: string
          updated_at?: string | null
          user_id: string
          version?: number | null
        }
        Update: {
          balance?: number | null
          created_at?: string | null
          currency?: string | null
          first_deposit_bonus_amount?: number | null
          first_deposit_bonus_claimed?: boolean | null
          frozen_balance?: number | null
          id?: string
          is_active?: boolean | null
          is_bonus?: boolean | null
          total_deposits?: number | null
          total_withdrawals?: number | null
          type?: string
          updated_at?: string | null
          user_id?: string
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "wallets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      withdrawal_requests: {
        Row: {
          account_holder: string | null
          account_number: string | null
          admin_id: string | null
          admin_note: string | null
          amount: number
          bank_account_name: string | null
          bank_account_number: string | null
          bank_branch: string | null
          bank_name: string | null
          completed_at: string | null
          created_at: string | null
          currency: string | null
          estimated_arrival: string | null
          failure_reason: string | null
          id: string
          id_card_name: string | null
          id_card_number: string | null
          idempotency_key: string | null
          mobile_wallet_name: string | null
          mobile_wallet_number: string | null
          order_number: string | null
          payment_account: string | null
          payment_method: string | null
          phone_number: string | null
          processed_at: string | null
          reject_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string | null
          transaction_hash: string | null
          transaction_id: string | null
          transfer_proof_images: Json | null
          transfer_reference: string | null
          updated_at: string | null
          user_id: string | null
          withdrawal_address: string | null
          withdrawal_method: string | null
        }
        Insert: {
          account_holder?: string | null
          account_number?: string | null
          admin_id?: string | null
          admin_note?: string | null
          amount: number
          bank_account_name?: string | null
          bank_account_number?: string | null
          bank_branch?: string | null
          bank_name?: string | null
          completed_at?: string | null
          created_at?: string | null
          currency?: string | null
          estimated_arrival?: string | null
          failure_reason?: string | null
          id?: string
          id_card_name?: string | null
          id_card_number?: string | null
          idempotency_key?: string | null
          mobile_wallet_name?: string | null
          mobile_wallet_number?: string | null
          order_number?: string | null
          payment_account?: string | null
          payment_method?: string | null
          phone_number?: string | null
          processed_at?: string | null
          reject_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          transaction_hash?: string | null
          transaction_id?: string | null
          transfer_proof_images?: Json | null
          transfer_reference?: string | null
          updated_at?: string | null
          user_id?: string | null
          withdrawal_address?: string | null
          withdrawal_method?: string | null
        }
        Update: {
          account_holder?: string | null
          account_number?: string | null
          admin_id?: string | null
          admin_note?: string | null
          amount?: number
          bank_account_name?: string | null
          bank_account_number?: string | null
          bank_branch?: string | null
          bank_name?: string | null
          completed_at?: string | null
          created_at?: string | null
          currency?: string | null
          estimated_arrival?: string | null
          failure_reason?: string | null
          id?: string
          id_card_name?: string | null
          id_card_number?: string | null
          idempotency_key?: string | null
          mobile_wallet_name?: string | null
          mobile_wallet_number?: string | null
          order_number?: string | null
          payment_account?: string | null
          payment_method?: string | null
          phone_number?: string | null
          processed_at?: string | null
          reject_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          transaction_hash?: string | null
          transaction_id?: string | null
          transfer_proof_images?: Json | null
          transfer_reference?: string | null
          updated_at?: string | null
          user_id?: string | null
          withdrawal_address?: string | null
          withdrawal_method?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "withdrawal_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      withdrawals: {
        Row: {
          account_holder: string
          account_number: string
          admin_note: string | null
          amount: number
          bank_name: string
          created_at: string | null
          currency: string | null
          id: string
          notes: string | null
          processed_at: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string | null
          transaction_id: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          account_holder: string
          account_number: string
          admin_note?: string | null
          amount: number
          bank_name: string
          created_at?: string | null
          currency?: string | null
          id?: string
          notes?: string | null
          processed_at?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          transaction_id?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          account_holder?: string
          account_number?: string
          admin_note?: string | null
          amount?: number
          bank_name?: string
          created_at?: string | null
          currency?: string | null
          id?: string
          notes?: string | null
          processed_at?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          transaction_id?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "withdrawals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      batch_sku_summary: {
        Row: {
          batch_id: string | null
          damaged_quantity: number | null
          missing_quantity: number | null
          normal_quantity: number | null
          pending_quantity: number | null
          product_image: string | null
          product_name: string | null
          product_name_i18n: Json | null
          product_sku: string | null
          total_quantity: number | null
        }
        Relationships: [
          {
            foreignKeyName: "batch_order_items_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batch_statistics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_order_items_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "shipment_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      batch_statistics: {
        Row: {
          arrived_at: string | null
          batch_no: string | null
          created_at: string | null
          damaged_items: number | null
          estimated_arrival_date: string | null
          id: string | null
          missing_items: number | null
          normal_items: number | null
          notified_items: number | null
          pending_items: number | null
          shipped_at: string | null
          status: string | null
          total_items: number | null
          transit_days: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      _admin_build_filter_clause: { Args: { v_filter: Json }; Returns: string }
      _admin_build_value_expr: {
        Args: { p_data: Json; p_key: string; p_table: string }
        Returns: string
      }
      _admin_parse_or_filter: { Args: { p_or_filter: string }; Returns: string }
      _admin_quote_conflict_cols: { Args: { p_cols: string }; Returns: string }
      add_bonus_balance: {
        Args: { p_amount: number; p_description?: string; p_user_id: string }
        Returns: boolean
      }
      add_user_lucky_coins: {
        Args: { p_amount: number; p_description?: string; p_user_id: string }
        Returns: number
      }
      add_user_spin_count: {
        Args: { p_count?: number; p_source?: string; p_user_id: string }
        Returns: boolean
      }
      admin_count: {
        Args: {
          p_filters?: Json
          p_or_filters?: string
          p_session_token: string
          p_table: string
        }
        Returns: Json
      }
      admin_create_signed_upload_url: {
        Args: { p_bucket: string; p_file_path: string; p_session_token: string }
        Returns: Json
      }
      admin_get_permissions: {
        Args: { p_session_token: string }
        Returns: Json
      }
      admin_login: {
        Args: { p_password_hash: string; p_username: string }
        Returns: Json
      }
      admin_logout: { Args: { p_session_token: string }; Returns: Json }
      admin_mutate: {
        Args: {
          p_action: string
          p_data?: Json
          p_filters?: Json
          p_on_conflict?: string
          p_or_filters?: string
          p_session_token: string
          p_table: string
        }
        Returns: Json
      }
      admin_query: {
        Args: {
          p_filters?: Json
          p_head?: boolean
          p_limit?: number
          p_offset?: number
          p_or_filters?: string
          p_order_asc?: boolean
          p_order_by?: string
          p_select?: string
          p_session_token: string
          p_table: string
        }
        Returns: Json
      }
      allocate_lottery_tickets: {
        Args: {
          p_lottery_id: string
          p_order_id?: string
          p_quantity: number
          p_user_id: string
        }
        Returns: {
          entry_id: string
          participation_code: string
          ticket_number: number
        }[]
      }
      approve_deposit_atomic: {
        Args: {
          p_action: string
          p_admin_id: string
          p_admin_note?: string
          p_request_id: string
        }
        Returns: Json
      }
      approve_withdrawal_request: {
        Args: {
          p_admin_id: string
          p_admin_note?: string
          p_withdrawal_id: string
        }
        Returns: boolean
      }
      auto_draw_lotteries: { Args: never; Returns: number }
      cancel_order_and_refund: {
        Args: { p_order_id: string; p_reason?: string }
        Returns: Json
      }
      check_pickup_staff_status: { Args: { p_user_id: string }; Returns: Json }
      cleanup_completed_events: {
        Args: { retention_days?: number }
        Returns: number
      }
      cleanup_expired_admin_sessions: { Args: never; Returns: number }
      confirm_promoter_settlement: {
        Args: {
          p_admin_id?: string
          p_note?: string
          p_proof_image_url?: string
          p_settlement_amount: number
          p_settlement_id: string
          p_settlement_method?: string
        }
        Returns: Json
      }
      count_distinct_ai_users: { Args: never; Returns: number }
      debug_coupon_query: { Args: { p_user_id: string }; Returns: Json }
      debug_coupon_query2: { Args: { p_user_id: string }; Returns: Json }
      decrease_commission_balance: {
        Args: { p_amount: number; p_user_id: string }
        Returns: boolean
      }
      decrease_user_balance: {
        Args: { p_amount: number; p_user_id: string; p_wallet_type?: string }
        Returns: boolean
      }
      decrement_likes_count:
        | { Args: { p_post_id: string }; Returns: number }
        | {
            Args: { p_target_id: string; p_target_type: string }
            Returns: undefined
          }
      decrement_showoff_likes: {
        Args: { showoff_id_param: string }
        Returns: undefined
      }
      decrement_user_balance: {
        Args: { p_amount: number; p_user_id: string; p_wallet_type?: string }
        Returns: boolean
      }
      deduct_user_spin_count: {
        Args: { p_count?: number; p_user_id: string }
        Returns: boolean
      }
      draw_lottery: { Args: { p_lottery_id: string }; Returns: Json }
      exchange_balance_atomic: {
        Args: { p_amount: number; p_user_id: string }
        Returns: Json
      }
      exchange_real_to_bonus_balance: {
        Args: { p_amount: number; p_exchange_rate?: number; p_user_id: string }
        Returns: boolean
      }
      execute_sql: { Args: { p_sql: string }; Returns: Json }
      generate_batch_no: { Args: never; Returns: string }
      generate_lottery_id: { Args: never; Returns: string }
      generate_pickup_code: { Args: never; Returns: string }
      get_active_products_with_sessions: { Args: never; Returns: Json }
      get_admin_deposit_cross_check: { Args: never; Returns: Json }
      get_admin_deposit_list: {
        Args: {
          p_end_date: string
          p_page?: number
          p_page_size?: number
          p_promoter_id?: string
          p_search?: string
          p_start_date: string
          p_status?: string
        }
        Returns: Json
      }
      get_admin_deposit_summary: {
        Args: { p_end_date: string; p_start_date: string }
        Returns: Json
      }
      get_admin_promoter_stats: {
        Args: { p_end_date: string; p_start_date: string }
        Returns: Json
      }
      get_admin_settlement_list: {
        Args: { p_settlement_date: string }
        Returns: Json
      }
      get_channel_stats: {
        Args: {
          p_prev_end?: string
          p_prev_start?: string
          p_range_end?: string
          p_range_start?: string
        }
        Returns: Json
      }
      get_commission_settings: { Args: never; Returns: Json }
      get_dashboard_stats: { Args: never; Returns: Json }
      get_promoter_center_data: {
        Args: { p_time_range?: string; p_user_id: string }
        Returns: Json
      }
      get_promoter_command_center: {
        Args: {
          p_prev_end: string
          p_prev_start: string
          p_range_end: string
          p_range_start: string
        }
        Returns: Json
      }
      get_promoter_daily_trend: {
        Args: { p_end_date?: string; p_start_date?: string }
        Returns: Json
      }
      get_promoter_dashboard_stats: {
        Args: { p_end_date?: string; p_start_date?: string }
        Returns: Json
      }
      get_promoter_deposit_stats: {
        Args: { p_date?: string; p_promoter_id: string }
        Returns: Json
      }
      get_promoter_leaderboard: {
        Args: { p_end_date?: string; p_limit?: number; p_start_date?: string }
        Returns: Json
      }
      get_revenue_by_day: {
        Args: { p_days?: number }
        Returns: {
          date: string
          revenue: number
        }[]
      }
      get_session_token_from_header: { Args: never; Returns: string }
      get_session_user_id: { Args: never; Returns: string }
      get_user_referral_stats: { Args: { p_user_id: string }; Returns: Json }
      get_user_wallet_balance: {
        Args: { p_currency?: string; p_user_id: string }
        Returns: number
      }
      http_header: {
        Args: { field: string; value: string }
        Returns: unknown
        SetofOptions: {
          from: "*"
          to: "http_header"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      increase_commission_balance: {
        Args: { p_amount: number; p_user_id: string }
        Returns: boolean
      }
      increase_user_balance: {
        Args: { p_amount: number; p_user_id: string; p_wallet_type?: string }
        Returns: boolean
      }
      increment_ai_quota_bonus: {
        Args: { p_amount: number; p_date: string; p_user_id: string }
        Returns: undefined
      }
      increment_ai_quota_used: {
        Args: { p_date: string; p_user_id: string }
        Returns: undefined
      }
      increment_contact_count: {
        Args: { p_log_date?: string; p_promoter_id: string }
        Returns: Json
      }
      increment_likes_count:
        | { Args: { p_post_id: string }; Returns: number }
        | {
            Args: { p_target_id: string; p_target_type: string }
            Returns: undefined
          }
      increment_showoff_comments: {
        Args: { showoff_id_param: string }
        Returns: undefined
      }
      increment_showoff_likes: {
        Args: { showoff_id_param: string }
        Returns: undefined
      }
      increment_sold_quantity:
        | {
            Args: { p_lottery_id: string; p_quantity?: number }
            Returns: boolean
          }
        | { Args: { amount?: number; product_id: string }; Returns: undefined }
      increment_user_balance: {
        Args: { p_amount: number; p_user_id: string; p_wallet_type?: string }
        Returns: boolean
      }
      log_admin_action: {
        Args: {
          p_action: string
          p_admin_id: string
          p_details?: Json
          p_duration_ms?: number
          p_error_message?: string
          p_ip_address?: string
          p_new_data?: Json
          p_old_data?: Json
          p_source?: string
          p_status?: string
          p_target_id?: string
          p_target_type?: string
          p_user_agent?: string
        }
        Returns: string
      }
      log_edge_function_action: {
        Args: {
          p_action: string
          p_details?: Json
          p_duration_ms?: number
          p_error_message?: string
          p_function_name: string
          p_ip_address?: string
          p_request_body?: Json
          p_response_status?: number
          p_status?: string
          p_target_id?: string
          p_target_type?: string
          p_user_id?: string
        }
        Returns: string
      }
      market_purchase_atomic: {
        Args: { p_buyer_id: string; p_listing_id: string }
        Returns: Json
      }
      perform_promoter_deposit: {
        Args: {
          p_amount: number
          p_idempotency_key?: string
          p_note?: string
          p_promoter_id: string
          p_target_user_id: string
        }
        Returns: Json
      }
      place_lottery_order: {
        Args: {
          p_lottery_id: string
          p_ticket_count: number
          p_user_id: string
        }
        Returns: Json
      }
      process_deposit_with_bonus: {
        Args: {
          p_bonus_amount: number
          p_deposit_amount: number
          p_order_number: string
          p_request_id: string
          p_user_id: string
        }
        Returns: Json
      }
      process_mixed_payment: {
        Args: {
          p_lottery_id: string
          p_order_id: string
          p_order_type: string
          p_total_amount: number
          p_use_coupon: boolean
          p_user_id: string
        }
        Returns: Json
      }
      purchase_lottery_atomic: {
        Args: {
          p_lottery_id: string
          p_quantity: number
          p_total_amount: number
          p_user_id: string
        }
        Returns: Json
      }
      purchase_lottery_with_concurrency_control: {
        Args: {
          p_lottery_id: string
          p_order_number: string
          p_payment_method: string
          p_quantity: number
          p_total_amount: number
          p_user_id: string
          p_wallet_id: string
        }
        Returns: Json
      }
      reject_withdrawal_request: {
        Args: {
          p_admin_id: string
          p_admin_note?: string
          p_withdrawal_id: string
        }
        Returns: boolean
      }
      revert_wallet_deduction: {
        Args: { p_amount: number; p_description?: string; p_wallet_id: string }
        Returns: Json
      }
      rollback_lottery_sold_tickets: {
        Args: { p_lottery_id: string; p_quantity: number }
        Returns: undefined
      }
      rpc_admin_get_category_product_counts: {
        Args: { p_session_token: string }
        Returns: Json
      }
      rpc_admin_get_tag_usage_counts: {
        Args: { p_session_token: string }
        Returns: Json
      }
      rpc_admin_save_product_taxonomy: {
        Args: {
          p_category_ids: string[]
          p_product_id: string
          p_session_token: string
          p_tag_ids: string[]
        }
        Returns: Json
      }
      rpc_admin_save_topic_products: {
        Args: { p_items: Json; p_session_token: string; p_topic_id: string }
        Returns: Json
      }
      rpc_admin_search_topic_products: {
        Args: {
          p_category_ids?: string[]
          p_has_active_lottery?: boolean
          p_keyword?: string
          p_limit?: number
          p_offset?: number
          p_session_token: string
          p_tag_ids?: string[]
        }
        Returns: Json
      }
      rpc_get_home_feed: {
        Args: { p_lang?: string; p_limit?: number }
        Returns: Json
      }
      rpc_get_topic_detail: {
        Args: { p_lang?: string; p_slug: string }
        Returns: Json
      }
      rpc_track_behavior_event: {
        Args: {
          p_device_info?: Json
          p_entity_id?: string
          p_entity_type?: string
          p_event_name?: string
          p_inventory_product_id?: string
          p_lottery_id?: string
          p_metadata?: Json
          p_order_id?: string
          p_page_name?: string
          p_position?: string
          p_session_id: string
          p_source_category_id?: string
          p_source_page?: string
          p_source_placement_id?: string
          p_source_topic_id?: string
          p_trace_id?: string
          p_user_id?: string
        }
        Returns: Json
      }
      save_role_permissions: {
        Args: { p_permissions: Json; p_role: string }
        Returns: undefined
      }
      search_user_for_deposit: { Args: { p_query: string }; Returns: Json }
      update_batch_statistics: {
        Args: { p_batch_id: string }
        Returns: undefined
      }
      update_commission_settings: {
        Args: { p_key: string; p_value: string }
        Returns: boolean
      }
      verify_admin_session: {
        Args: { p_session_token: string }
        Returns: string
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
