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
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      admin_audit_logs: {
        Row: {
          action: string
          admin_id: string
          created_at: string
          details: Json | null
          id: string
          ip_address: string | null
          resource_id: string | null
          resource_type: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          admin_id: string
          created_at?: string
          details?: Json | null
          id?: string
          ip_address?: string | null
          resource_id?: string | null
          resource_type?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          admin_id?: string
          created_at?: string
          details?: Json | null
          id?: string
          ip_address?: string | null
          resource_id?: string | null
          resource_type?: string | null
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
      admin_users: {
        Row: {
          created_at: string
          created_by: string | null
          display_name: string | null
          email: string | null
          id: string
          last_login_at: string | null
          password_hash: string
          role: string
          status: string
          updated_at: string
          username: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          display_name?: string | null
          email?: string | null
          id?: string
          last_login_at?: string | null
          password_hash: string
          role?: string
          status?: string
          updated_at?: string
          username: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          display_name?: string | null
          email?: string | null
          id?: string
          last_login_at?: string | null
          password_hash?: string
          role?: string
          status?: string
          updated_at?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_users_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
        ]
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
          title: string
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
          title: string
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
          title?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      bot_command_stats: {
        Row: {
          command: string
          created_at: string | null
          id: string
          last_used_at: string | null
          updated_at: string | null
          usage_count: number | null
          user_id: string
        }
        Insert: {
          command: string
          created_at?: string | null
          id?: string
          last_used_at?: string | null
          updated_at?: string | null
          usage_count?: number | null
          user_id: string
        }
        Update: {
          command?: string
          created_at?: string | null
          id?: string
          last_used_at?: string | null
          updated_at?: string | null
          usage_count?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bot_command_stats_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_messages: {
        Row: {
          command: string | null
          content: string | null
          created_at: string | null
          error_message: string | null
          id: string
          message_type: string
          response_content: string | null
          response_sent: boolean | null
          telegram_chat_id: number
          telegram_message_id: number
          updated_at: string | null
          user_id: string
        }
        Insert: {
          command?: string | null
          content?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          message_type?: string
          response_content?: string | null
          response_sent?: boolean | null
          telegram_chat_id: number
          telegram_message_id: number
          updated_at?: string | null
          user_id: string
        }
        Update: {
          command?: string | null
          content?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          message_type?: string
          response_content?: string | null
          response_sent?: boolean | null
          telegram_chat_id?: number
          telegram_message_id?: number
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bot_messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_sessions: {
        Row: {
          context_data: Json | null
          created_at: string | null
          current_state: string | null
          expires_at: string | null
          id: string
          telegram_chat_id: number
          updated_at: string | null
          user_id: string
        }
        Insert: {
          context_data?: Json | null
          created_at?: string | null
          current_state?: string | null
          expires_at?: string | null
          id?: string
          telegram_chat_id: number
          updated_at?: string | null
          user_id: string
        }
        Update: {
          context_data?: Json | null
          created_at?: string | null
          current_state?: string | null
          expires_at?: string | null
          id?: string
          telegram_chat_id?: number
          updated_at?: string | null
          user_id?: string
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
          daily_summary: boolean | null
          id: string
          language_code: string | null
          lottery_notifications: boolean | null
          notifications_enabled: boolean | null
          quiet_hours_end: string | null
          quiet_hours_start: string | null
          referral_notifications: boolean | null
          system_notifications: boolean | null
          telegram_chat_id: number
          timezone: string | null
          updated_at: string | null
          user_id: string
          wallet_notifications: boolean | null
        }
        Insert: {
          created_at?: string | null
          daily_summary?: boolean | null
          id?: string
          language_code?: string | null
          lottery_notifications?: boolean | null
          notifications_enabled?: boolean | null
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          referral_notifications?: boolean | null
          system_notifications?: boolean | null
          telegram_chat_id: number
          timezone?: string | null
          updated_at?: string | null
          user_id: string
          wallet_notifications?: boolean | null
        }
        Update: {
          created_at?: string | null
          daily_summary?: boolean | null
          id?: string
          language_code?: string | null
          lottery_notifications?: boolean | null
          notifications_enabled?: boolean | null
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          referral_notifications?: boolean | null
          system_notifications?: boolean | null
          telegram_chat_id?: number
          timezone?: string | null
          updated_at?: string | null
          user_id?: string
          wallet_notifications?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "bot_user_settings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_settings: {
        Row: {
          created_at: string | null
          description_i18n: Json | null
          id: string
          is_active: boolean | null
          level: number
          min_payout_amount: number | null
          rate: number
          trigger_condition: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description_i18n?: Json | null
          id?: string
          is_active?: boolean | null
          level: number
          min_payout_amount?: number | null
          rate: number
          trigger_condition?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description_i18n?: Json | null
          id?: string
          is_active?: boolean | null
          level?: number
          min_payout_amount?: number | null
          rate?: number
          trigger_condition?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      commissions: {
        Row: {
          amount: number
          created_at: string
          from_user_id: string
          id: string
          level: number
          paid_at: string | null
          rate: number
          related_lottery_id: string | null
          related_order_id: string | null
          source_amount: number
          status: Database["public"]["Enums"]["CommissionStatus"]
          type: Database["public"]["Enums"]["CommissionType"]
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          from_user_id: string
          id?: string
          level: number
          paid_at?: string | null
          rate: number
          related_lottery_id?: string | null
          related_order_id?: string | null
          source_amount: number
          status?: Database["public"]["Enums"]["CommissionStatus"]
          type: Database["public"]["Enums"]["CommissionType"]
          updated_at: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          from_user_id?: string
          id?: string
          level?: number
          paid_at?: string | null
          rate?: number
          related_lottery_id?: string | null
          related_order_id?: string | null
          source_amount?: number
          status?: Database["public"]["Enums"]["CommissionStatus"]
          type?: Database["public"]["Enums"]["CommissionType"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "commissions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      deposit_requests: {
        Row: {
          admin_note: string | null
          amount: number
          created_at: string | null
          currency: string | null
          id: string
          order_number: string
          payer_account: string | null
          payer_name: string | null
          payment_method: string
          payment_proof_images: string[] | null
          payment_reference: string | null
          processed_at: string | null
          processed_by: string | null
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
          order_number: string
          payer_account?: string | null
          payer_name?: string | null
          payment_method: string
          payment_proof_images?: string[] | null
          payment_reference?: string | null
          processed_at?: string | null
          processed_by?: string | null
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
          order_number?: string
          payer_account?: string | null
          payer_name?: string | null
          payment_method?: string
          payment_proof_images?: string[] | null
          payment_reference?: string | null
          processed_at?: string | null
          processed_by?: string | null
          status?: string | null
          updated_at?: string | null
          user_id?: string
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
      draw_algorithms: {
        Row: {
          config: Json | null
          created_at: string | null
          description_i18n: Json | null
          display_name_i18n: Json
          formula_i18n: Json | null
          id: string
          is_active: boolean | null
          is_default: boolean | null
          name: string
          updated_at: string | null
        }
        Insert: {
          config?: Json | null
          created_at?: string | null
          description_i18n?: Json | null
          display_name_i18n?: Json
          formula_i18n?: Json | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          name: string
          updated_at?: string | null
        }
        Update: {
          config?: Json | null
          created_at?: string | null
          description_i18n?: Json | null
          display_name_i18n?: Json
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
          algorithm_name: string
          calculation_steps: Json | null
          created_at: string | null
          draw_time: string
          id: string
          input_data: Json
          lottery_id: string
          vrf_proof: string | null
          vrf_seed: string | null
          winner_order_id: string | null
          winner_user_id: string | null
          winning_number: number
        }
        Insert: {
          algorithm_name: string
          calculation_steps?: Json | null
          created_at?: string | null
          draw_time: string
          id?: string
          input_data: Json
          lottery_id: string
          vrf_proof?: string | null
          vrf_seed?: string | null
          winner_order_id?: string | null
          winner_user_id?: string | null
          winning_number: number
        }
        Update: {
          algorithm_name?: string
          calculation_steps?: Json | null
          created_at?: string | null
          draw_time?: string
          id?: string
          input_data?: Json
          lottery_id?: string
          vrf_proof?: string | null
          vrf_seed?: string | null
          winner_order_id?: string | null
          winner_user_id?: string | null
          winning_number?: number
        }
        Relationships: []
      }
      exchange_records: {
        Row: {
          amount: number
          created_at: string
          currency: string
          exchange_rate: number
          exchange_type: Database["public"]["Enums"]["ExchangeType"]
          id: string
          source_balance_after: number
          source_balance_before: number
          source_wallet_id: string
          target_balance_after: number
          target_balance_before: number
          target_wallet_id: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          exchange_rate?: number
          exchange_type: Database["public"]["Enums"]["ExchangeType"]
          id?: string
          source_balance_after: number
          source_balance_before: number
          source_wallet_id: string
          target_balance_after: number
          target_balance_before: number
          target_wallet_id: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          exchange_rate?: number
          exchange_type?: Database["public"]["Enums"]["ExchangeType"]
          id?: string
          source_balance_after?: number
          source_balance_before?: number
          source_wallet_id?: string
          target_balance_after?: number
          target_balance_before?: number
          target_wallet_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exchange_records_source_wallet_id_fkey"
            columns: ["source_wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exchange_records_target_wallet_id_fkey"
            columns: ["target_wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exchange_records_user_id_fkey"
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
          order_number: string
          order_timestamp: number
          payment_method: string
          product_id: string
          refund_amount: number | null
          refund_lucky_coins: number | null
          refunded_at: string | null
          session_id: string
          status: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string | null
          id?: string
          order_number: string
          order_timestamp: number
          payment_method?: string
          product_id: string
          refund_amount?: number | null
          refund_lucky_coins?: number | null
          refunded_at?: string | null
          session_id: string
          status?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string | null
          id?: string
          order_number?: string
          order_timestamp?: number
          payment_method?: string
          product_id?: string
          refund_amount?: number | null
          refund_lucky_coins?: number | null
          refunded_at?: string | null
          session_id?: string
          status?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_buy_orders_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "group_buy_products"
            referencedColumns: ["id"]
          },
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
            referencedColumns: ["telegram_id"]
          },
        ]
      }
      group_buy_products: {
        Row: {
          created_at: string | null
          created_by: string | null
          description: Json | null
          group_size: number
          id: string
          image_url: string
          images: Json | null
          original_price: number
          price_per_person: number
          product_type: string
          sold_quantity: number
          status: string
          stock_quantity: number
          timeout_hours: number
          title: Json
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          description?: Json | null
          group_size?: number
          id?: string
          image_url: string
          images?: Json | null
          original_price: number
          price_per_person: number
          product_type?: string
          sold_quantity?: number
          status?: string
          stock_quantity?: number
          timeout_hours?: number
          title: Json
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          description?: Json | null
          group_size?: number
          id?: string
          image_url?: string
          images?: Json | null
          original_price?: number
          price_per_person?: number
          product_type?: string
          sold_quantity?: number
          status?: string
          stock_quantity?: number
          timeout_hours?: number
          title?: Json
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "group_buy_products_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
        ]
      }
      group_buy_results: {
        Row: {
          algorithm_data: Json | null
          claimed_at: string | null
          created_at: string | null
          expires_at: string | null
          id: string
          picked_up_at: string | null
          picked_up_by: string | null
          pickup_code: string | null
          pickup_point_id: string | null
          pickup_status: string | null
          product_id: string
          session_id: string
          shipping_info: Json | null
          shipping_status: string | null
          timestamp_sum: number
          total_participants: number
          updated_at: string | null
          winner_id: string
          winner_order_id: string
          winning_index: number
        }
        Insert: {
          algorithm_data?: Json | null
          claimed_at?: string | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          picked_up_at?: string | null
          picked_up_by?: string | null
          pickup_code?: string | null
          pickup_point_id?: string | null
          pickup_status?: string | null
          product_id: string
          session_id: string
          shipping_info?: Json | null
          shipping_status?: string | null
          timestamp_sum: number
          total_participants: number
          updated_at?: string | null
          winner_id: string
          winner_order_id: string
          winning_index: number
        }
        Update: {
          algorithm_data?: Json | null
          claimed_at?: string | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          picked_up_at?: string | null
          picked_up_by?: string | null
          pickup_code?: string | null
          pickup_point_id?: string | null
          pickup_status?: string | null
          product_id?: string
          session_id?: string
          shipping_info?: Json | null
          shipping_status?: string | null
          timestamp_sum?: number
          total_participants?: number
          updated_at?: string | null
          winner_id?: string
          winner_order_id?: string
          winning_index?: number
        }
        Relationships: [
          {
            foreignKeyName: "fk_group_buy_pickup_point"
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
            foreignKeyName: "group_buy_results_winner_id_fkey"
            columns: ["winner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["telegram_id"]
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
          current_participants: number
          drawn_at: string | null
          expires_at: string
          id: string
          initiator_id: string | null
          max_participants: number
          product_id: string
          session_code: string
          started_at: string | null
          status: string
          updated_at: string | null
          winner_id: string | null
          winning_timestamp_sum: number | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          current_participants?: number
          drawn_at?: string | null
          expires_at: string
          id?: string
          initiator_id?: string | null
          max_participants?: number
          product_id: string
          session_code: string
          started_at?: string | null
          status?: string
          updated_at?: string | null
          winner_id?: string | null
          winning_timestamp_sum?: number | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          current_participants?: number
          drawn_at?: string | null
          expires_at?: string
          id?: string
          initiator_id?: string | null
          max_participants?: number
          product_id?: string
          session_code?: string
          started_at?: string | null
          status?: string
          updated_at?: string | null
          winner_id?: string | null
          winning_timestamp_sum?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "group_buy_sessions_initiator_id_fkey"
            columns: ["initiator_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["telegram_id"]
          },
          {
            foreignKeyName: "group_buy_sessions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "group_buy_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_buy_sessions_winner_id_fkey"
            columns: ["winner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["telegram_id"]
          },
        ]
      }
      likes: {
        Row: {
          created_at: string
          id: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "likes_showoff_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "showoffs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      lotteries: {
        Row: {
          actual_draw_time: string | null
          ai_understanding: Json | null
          created_at: string
          currency: Database["public"]["Enums"]["Currency"]
          description: string | null
          description_i18n: Json | null
          details_i18n: Json | null
          draw_algorithm_data: Json | null
          draw_time: string | null
          end_time: string | null
          id: string
          image_url: string | null
          image_urls: string[] | null
          material_i18n: Json | null
          max_per_user: number
          name_i18n: Json | null
          period: string | null
          sold_tickets: number
          specifications_i18n: Json | null
          start_time: string
          status: Database["public"]["Enums"]["LotteryStatus"]
          ticket_price: number
          title: string
          title_i18n: Json | null
          total_tickets: number
          unlimited_purchase: boolean | null
          updated_at: string
          vrf_proof: string | null
          vrf_seed: string | null
          vrf_timestamp: number | null
          winning_numbers: Json | null
          winning_ticket_number: number | null
          winning_user_id: string | null
        }
        Insert: {
          actual_draw_time?: string | null
          ai_understanding?: Json | null
          created_at?: string
          currency?: Database["public"]["Enums"]["Currency"]
          description?: string | null
          description_i18n?: Json | null
          details_i18n?: Json | null
          draw_algorithm_data?: Json | null
          draw_time?: string | null
          end_time?: string | null
          id?: string
          image_url?: string | null
          image_urls?: string[] | null
          material_i18n?: Json | null
          max_per_user: number
          name_i18n?: Json | null
          period?: string | null
          sold_tickets?: number
          specifications_i18n?: Json | null
          start_time: string
          status?: Database["public"]["Enums"]["LotteryStatus"]
          ticket_price: number
          title: string
          title_i18n?: Json | null
          total_tickets: number
          unlimited_purchase?: boolean | null
          updated_at?: string
          vrf_proof?: string | null
          vrf_seed?: string | null
          vrf_timestamp?: number | null
          winning_numbers?: Json | null
          winning_ticket_number?: number | null
          winning_user_id?: string | null
        }
        Update: {
          actual_draw_time?: string | null
          ai_understanding?: Json | null
          created_at?: string
          currency?: Database["public"]["Enums"]["Currency"]
          description?: string | null
          description_i18n?: Json | null
          details_i18n?: Json | null
          draw_algorithm_data?: Json | null
          draw_time?: string | null
          end_time?: string | null
          id?: string
          image_url?: string | null
          image_urls?: string[] | null
          material_i18n?: Json | null
          max_per_user?: number
          name_i18n?: Json | null
          period?: string | null
          sold_tickets?: number
          specifications_i18n?: Json | null
          start_time?: string
          status?: Database["public"]["Enums"]["LotteryStatus"]
          ticket_price?: number
          title?: string
          title_i18n?: Json | null
          total_tickets?: number
          unlimited_purchase?: boolean | null
          updated_at?: string
          vrf_proof?: string | null
          vrf_seed?: string | null
          vrf_timestamp?: number | null
          winning_numbers?: Json | null
          winning_ticket_number?: number | null
          winning_user_id?: string | null
        }
        Relationships: []
      }
      lottery_entries: {
        Row: {
          created_at: string
          id: string
          is_from_market: boolean
          is_winning: boolean
          lottery_id: string
          numbers: Json
          order_id: string
          original_owner: string | null
          prize_amount: number | null
          prize_rank: number | null
          status: Database["public"]["Enums"]["EntryStatus"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_from_market?: boolean
          is_winning?: boolean
          lottery_id: string
          numbers: Json
          order_id: string
          original_owner?: string | null
          prize_amount?: number | null
          prize_rank?: number | null
          status?: Database["public"]["Enums"]["EntryStatus"]
          updated_at: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_from_market?: boolean
          is_winning?: boolean
          lottery_id?: string
          numbers?: Json
          order_id?: string
          original_owner?: string | null
          prize_amount?: number | null
          prize_rank?: number | null
          status?: Database["public"]["Enums"]["EntryStatus"]
          updated_at?: string
          user_id?: string
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
          created_at: string | null
          draw_time: string | null
          id: string
          lottery_id: string
          winner_id: string | null
          winner_ticket_number: number
        }
        Insert: {
          algorithm_data?: Json | null
          created_at?: string | null
          draw_time?: string | null
          id?: string
          lottery_id: string
          winner_id?: string | null
          winner_ticket_number: number
        }
        Update: {
          algorithm_data?: Json | null
          created_at?: string | null
          draw_time?: string | null
          id?: string
          lottery_id?: string
          winner_id?: string | null
          winner_ticket_number?: number
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
            foreignKeyName: "lottery_results_winner_id_fkey"
            columns: ["winner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      market_listings: {
        Row: {
          description: string | null
          entry_id: string
          final_price: number | null
          id: string
          listed_at: string
          listing_price: number
          lottery_id: string
          original_price: number
          seller_id: string
          sold_at: string | null
          status: Database["public"]["Enums"]["MarketListingStatus"]
          updated_at: string
        }
        Insert: {
          description?: string | null
          entry_id: string
          final_price?: number | null
          id?: string
          listed_at?: string
          listing_price: number
          lottery_id: string
          original_price: number
          seller_id: string
          sold_at?: string | null
          status?: Database["public"]["Enums"]["MarketListingStatus"]
          updated_at: string
        }
        Update: {
          description?: string | null
          entry_id?: string
          final_price?: number | null
          id?: string
          listed_at?: string
          listing_price?: number
          lottery_id?: string
          original_price?: number
          seller_id?: string
          sold_at?: string | null
          status?: Database["public"]["Enums"]["MarketListingStatus"]
          updated_at?: string
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
          id: string
          message: string
          metadata: Json | null
          resolved_at: string | null
          resource: string | null
          resource_id: string | null
          severity: string | null
          source: string | null
          status: string | null
          title: string
          triggered_at: string | null
          updated_at: string | null
        }
        Insert: {
          acknowledged_at?: string | null
          alert_type: string
          created_at?: string | null
          id?: string
          message: string
          metadata?: Json | null
          resolved_at?: string | null
          resource?: string | null
          resource_id?: string | null
          severity?: string | null
          source?: string | null
          status?: string | null
          title: string
          triggered_at?: string | null
          updated_at?: string | null
        }
        Update: {
          acknowledged_at?: string | null
          alert_type?: string
          created_at?: string | null
          id?: string
          message?: string
          metadata?: Json | null
          resolved_at?: string | null
          resource?: string | null
          resource_id?: string | null
          severity?: string | null
          source?: string | null
          status?: string | null
          title?: string
          triggered_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      notification_queue: {
        Row: {
          created_at: string | null
          data: Json | null
          error_message: string | null
          id: string
          max_retries: number | null
          message: string
          notification_type: string
          priority: number | null
          retry_count: number | null
          scheduled_at: string | null
          sent_at: string | null
          status: string | null
          telegram_chat_id: number
          title: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          data?: Json | null
          error_message?: string | null
          id?: string
          max_retries?: number | null
          message: string
          notification_type: string
          priority?: number | null
          retry_count?: number | null
          scheduled_at?: string | null
          sent_at?: string | null
          status?: string | null
          telegram_chat_id: number
          title: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          data?: Json | null
          error_message?: string | null
          id?: string
          max_retries?: number | null
          message?: string
          notification_type?: string
          priority?: number | null
          retry_count?: number | null
          scheduled_at?: string | null
          sent_at?: string | null
          status?: string | null
          telegram_chat_id?: number
          title?: string
          updated_at?: string | null
          user_id?: string
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
          content: string
          created_at: string
          expired_at: string | null
          id: string
          is_read: boolean
          push_channels: Json | null
          push_status: Json | null
          read_at: string | null
          related_id: string | null
          related_type: string | null
          title: string
          type: Database["public"]["Enums"]["NotificationType"]
          updated_at: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          expired_at?: string | null
          id?: string
          is_read?: boolean
          push_channels?: Json | null
          push_status?: Json | null
          read_at?: string | null
          related_id?: string | null
          related_type?: string | null
          title: string
          type: Database["public"]["Enums"]["NotificationType"]
          updated_at: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          expired_at?: string | null
          id?: string
          is_read?: boolean
          push_channels?: Json | null
          push_status?: Json | null
          read_at?: string | null
          related_id?: string | null
          related_type?: string | null
          title?: string
          type?: Database["public"]["Enums"]["NotificationType"]
          updated_at?: string
          user_id?: string
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
          created_at: string
          currency: Database["public"]["Enums"]["Currency"]
          expired_at: string | null
          id: string
          lottery_id: string | null
          order_number: string
          paid_at: string | null
          payment_data: Json | null
          payment_id: string | null
          payment_method: Database["public"]["Enums"]["PaymentMethod"]
          quantity: number | null
          selected_numbers: Json | null
          status: Database["public"]["Enums"]["OrderStatus"]
          total_amount: number
          type: Database["public"]["Enums"]["OrderType"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          currency?: Database["public"]["Enums"]["Currency"]
          expired_at?: string | null
          id?: string
          lottery_id?: string | null
          order_number: string
          paid_at?: string | null
          payment_data?: Json | null
          payment_id?: string | null
          payment_method: Database["public"]["Enums"]["PaymentMethod"]
          quantity?: number | null
          selected_numbers?: Json | null
          status?: Database["public"]["Enums"]["OrderStatus"]
          total_amount: number
          type: Database["public"]["Enums"]["OrderType"]
          updated_at: string
          user_id: string
        }
        Update: {
          created_at?: string
          currency?: Database["public"]["Enums"]["Currency"]
          expired_at?: string | null
          id?: string
          lottery_id?: string | null
          order_number?: string
          paid_at?: string | null
          payment_data?: Json | null
          payment_id?: string | null
          payment_method?: Database["public"]["Enums"]["PaymentMethod"]
          quantity?: number | null
          selected_numbers?: Json | null
          status?: Database["public"]["Enums"]["OrderStatus"]
          total_amount?: number
          type?: Database["public"]["Enums"]["OrderType"]
          updated_at?: string
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
          config: Json | null
          config_data: Json
          config_key: string
          config_type: string
          created_at: string
          description_i18n: Json | null
          id: string
          is_active: boolean | null
          is_enabled: boolean
          name_i18n: Json | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          config?: Json | null
          config_data: Json
          config_key: string
          config_type: string
          created_at?: string
          description_i18n?: Json | null
          id?: string
          is_active?: boolean | null
          is_enabled?: boolean
          name_i18n?: Json | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          config?: Json | null
          config_data?: Json
          config_key?: string
          config_type?: string
          created_at?: string
          description_i18n?: Json | null
          id?: string
          is_active?: boolean | null
          is_enabled?: boolean
          name_i18n?: Json | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      pickup_logs: {
        Row: {
          created_at: string | null
          id: string
          notes: string | null
          operation_type: string
          operator_id: string | null
          pickup_code: string
          pickup_point_id: string | null
          prize_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          notes?: string | null
          operation_type: string
          operator_id?: string | null
          pickup_code: string
          pickup_point_id?: string | null
          prize_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          notes?: string | null
          operation_type?: string
          operator_id?: string | null
          pickup_code?: string
          pickup_point_id?: string | null
          prize_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pickup_logs_pickup_point_id_fkey"
            columns: ["pickup_point_id"]
            isOneToOne: false
            referencedRelation: "pickup_points"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickup_logs_prize_id_fkey"
            columns: ["prize_id"]
            isOneToOne: false
            referencedRelation: "prizes"
            referencedColumns: ["id"]
          },
        ]
      }
      pickup_points: {
        Row: {
          address: string
          address_i18n: Json | null
          business_hours: Json | null
          contact_person: string | null
          contact_phone: string | null
          created_at: string | null
          id: string
          latitude: number | null
          longitude: number | null
          name: string
          name_i18n: Json | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          address: string
          address_i18n?: Json | null
          business_hours?: Json | null
          contact_person?: string | null
          contact_phone?: string | null
          created_at?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          name: string
          name_i18n?: Json | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          address?: string
          address_i18n?: Json | null
          business_hours?: Json | null
          contact_person?: string | null
          contact_phone?: string | null
          created_at?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          name?: string
          name_i18n?: Json | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      prizes: {
        Row: {
          algorithm_data: Json | null
          claimed_at: string | null
          created_at: string
          expires_at: string | null
          id: string
          lottery_id: string
          picked_up_at: string | null
          picked_up_by: string | null
          pickup_code: string | null
          pickup_point_id: string | null
          pickup_status: string | null
          prize_image: string | null
          prize_name: string
          prize_value: number
          processed_at: string | null
          status: string
          ticket_id: string | null
          updated_at: string
          user_id: string
          winning_code: string
          won_at: string
        }
        Insert: {
          algorithm_data?: Json | null
          claimed_at?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          lottery_id: string
          picked_up_at?: string | null
          picked_up_by?: string | null
          pickup_code?: string | null
          pickup_point_id?: string | null
          pickup_status?: string | null
          prize_image?: string | null
          prize_name: string
          prize_value?: number
          processed_at?: string | null
          status?: string
          ticket_id?: string | null
          updated_at?: string
          user_id: string
          winning_code: string
          won_at?: string
        }
        Update: {
          algorithm_data?: Json | null
          claimed_at?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          lottery_id?: string
          picked_up_at?: string | null
          picked_up_by?: string | null
          pickup_code?: string | null
          pickup_point_id?: string | null
          pickup_status?: string | null
          prize_image?: string | null
          prize_name?: string
          prize_value?: number
          processed_at?: string | null
          status?: string
          ticket_id?: string | null
          updated_at?: string
          user_id?: string
          winning_code?: string
          won_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_pickup_point"
            columns: ["pickup_point_id"]
            isOneToOne: false
            referencedRelation: "pickup_points"
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
          lottery_id: string
          original_price: number
          resale_price: number
          seller_id: string
          sold_at: string | null
          status: string | null
          ticket_id: string | null
          updated_at: string | null
        }
        Insert: {
          buyer_id?: string | null
          created_at?: string | null
          id?: string
          listed_at?: string | null
          lottery_id: string
          original_price: number
          resale_price: number
          seller_id: string
          sold_at?: string | null
          status?: string | null
          ticket_id?: string | null
          updated_at?: string | null
        }
        Update: {
          buyer_id?: string | null
          created_at?: string | null
          id?: string
          listed_at?: string | null
          lottery_id?: string
          original_price?: number
          resale_price?: number
          seller_id?: string
          sold_at?: string | null
          status?: string | null
          ticket_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "resales_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
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
          {
            foreignKeyName: "resales_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "lottery_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          created_at: string | null
          id: string
          permissions: Json
          role: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          permissions?: Json
          role: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          permissions?: Json
          role?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      shipping: {
        Row: {
          admin_notes: string | null
          created_at: string
          delivered_at: string | null
          id: string
          notes: string | null
          prize_id: string
          recipient_address: string
          recipient_city: string | null
          recipient_country: string | null
          recipient_name: string
          recipient_phone: string
          recipient_postal_code: string | null
          recipient_region: string | null
          requested_at: string
          shipped_at: string | null
          shipping_company: string | null
          shipping_cost: number | null
          shipping_method: string | null
          status: string
          tracking_number: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_notes?: string | null
          created_at?: string
          delivered_at?: string | null
          id?: string
          notes?: string | null
          prize_id: string
          recipient_address: string
          recipient_city?: string | null
          recipient_country?: string | null
          recipient_name: string
          recipient_phone: string
          recipient_postal_code?: string | null
          recipient_region?: string | null
          requested_at?: string
          shipped_at?: string | null
          shipping_company?: string | null
          shipping_cost?: number | null
          shipping_method?: string | null
          status?: string
          tracking_number?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_notes?: string | null
          created_at?: string
          delivered_at?: string | null
          id?: string
          notes?: string | null
          prize_id?: string
          recipient_address?: string
          recipient_city?: string | null
          recipient_country?: string | null
          recipient_name?: string
          recipient_phone?: string
          recipient_postal_code?: string | null
          recipient_region?: string | null
          requested_at?: string
          shipped_at?: string | null
          shipping_company?: string | null
          shipping_cost?: number | null
          shipping_method?: string | null
          status?: string
          tracking_number?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      shipping_history: {
        Row: {
          created_at: string | null
          id: string
          location: string | null
          notes: string | null
          shipping_record_id: string | null
          shipping_request_id: string | null
          status: string
          timestamp: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          location?: string | null
          notes?: string | null
          shipping_record_id?: string | null
          shipping_request_id?: string | null
          status: string
          timestamp?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          location?: string | null
          notes?: string | null
          shipping_record_id?: string | null
          shipping_request_id?: string | null
          status?: string
          timestamp?: string | null
        }
        Relationships: []
      }
      showoff_comments: {
        Row: {
          content: string
          created_at: string | null
          id: string
          parent_id: string | null
          post_id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: string
          parent_id?: string | null
          post_id: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: string
          parent_id?: string | null
          post_id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "showoff_comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "showoff_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "showoff_comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "showoffs"
            referencedColumns: ["id"]
          },
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
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "showoff_likes_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "showoffs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "showoff_likes_user_id_fkey"
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
          comments_count: number | null
          content: string | null
          created_at: string | null
          id: string
          images: string[] | null
          likes_count: number | null
          lottery_id: string | null
          prize_id: string | null
          reviewed_at: string | null
          reward_coins: number | null
          status: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          admin_note?: string | null
          comments_count?: number | null
          content?: string | null
          created_at?: string | null
          id?: string
          images?: string[] | null
          likes_count?: number | null
          lottery_id?: string | null
          prize_id?: string | null
          reviewed_at?: string | null
          reward_coins?: number | null
          status?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          admin_note?: string | null
          comments_count?: number | null
          content?: string | null
          created_at?: string | null
          id?: string
          images?: string[] | null
          likes_count?: number | null
          lottery_id?: string | null
          prize_id?: string | null
          reviewed_at?: string | null
          reward_coins?: number | null
          status?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      system_configs: {
        Row: {
          category: string
          created_at: string
          data_type: string
          description: string | null
          id: string
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          category?: string
          created_at?: string
          data_type?: string
          description?: string | null
          id?: string
          key: string
          updated_at: string
          value: string
        }
        Update: {
          category?: string
          created_at?: string
          data_type?: string
          description?: string | null
          id?: string
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      user_sessions: {
        Row: {
          created_at: string
          device: string | null
          expires_at: string
          id: string
          ip_address: string | null
          is_active: boolean
          location: string | null
          session_token: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          device?: string | null
          expires_at: string
          id?: string
          ip_address?: string | null
          is_active?: boolean
          location?: string | null
          session_token: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          device?: string | null
          expires_at?: string
          id?: string
          ip_address?: string | null
          is_active?: boolean
          location?: string | null
          session_token?: string
          user_agent?: string | null
          user_id?: string
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
      users: {
        Row: {
          avatar_url: string | null
          commission_rate: number | null
          created_at: string
          deleted_at: string | null
          email: string | null
          first_name: string | null
          id: string
          is_verified: boolean
          kyc_level: Database["public"]["Enums"]["KycLevel"]
          language_code: string
          last_active_at: string | null
          last_login_at: string | null
          last_name: string | null
          level: number | null
          lucky_coins: number | null
          phone_number: string | null
          referral_code: string
          referral_level: number | null
          referred_by_id: string | null
          referrer_id: string | null
          status: Database["public"]["Enums"]["UserStatus"]
          telegram_id: string
          telegram_username: string | null
          total_lotteries: number
          total_spent: number
          total_won: number
          two_factor_enabled: boolean
          updated_at: string
          winning_rate: number
        }
        Insert: {
          avatar_url?: string | null
          commission_rate?: number | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          first_name?: string | null
          id?: string
          is_verified?: boolean
          kyc_level?: Database["public"]["Enums"]["KycLevel"]
          language_code?: string
          last_active_at?: string | null
          last_login_at?: string | null
          last_name?: string | null
          level?: number | null
          lucky_coins?: number | null
          phone_number?: string | null
          referral_code: string
          referral_level?: number | null
          referred_by_id?: string | null
          referrer_id?: string | null
          status?: Database["public"]["Enums"]["UserStatus"]
          telegram_id: string
          telegram_username?: string | null
          total_lotteries?: number
          total_spent?: number
          total_won?: number
          two_factor_enabled?: boolean
          updated_at: string
          winning_rate?: number
        }
        Update: {
          avatar_url?: string | null
          commission_rate?: number | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          first_name?: string | null
          id?: string
          is_verified?: boolean
          kyc_level?: Database["public"]["Enums"]["KycLevel"]
          language_code?: string
          last_active_at?: string | null
          last_login_at?: string | null
          last_name?: string | null
          level?: number | null
          lucky_coins?: number | null
          phone_number?: string | null
          referral_code?: string
          referral_level?: number | null
          referred_by_id?: string | null
          referrer_id?: string | null
          status?: Database["public"]["Enums"]["UserStatus"]
          telegram_id?: string
          telegram_username?: string | null
          total_lotteries?: number
          total_spent?: number
          total_won?: number
          two_factor_enabled?: boolean
          updated_at?: string
          winning_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "users_referred_by_id_fkey"
            columns: ["referred_by_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "users_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      wallet_transactions: {
        Row: {
          amount: number
          balance_after: number
          balance_before: number
          created_at: string
          description: string | null
          id: string
          processed_at: string | null
          reference_id: string | null
          related_lottery_id: string | null
          related_order_id: string | null
          status: Database["public"]["Enums"]["TransactionStatus"]
          type: Database["public"]["Enums"]["TransactionType"]
          wallet_id: string
        }
        Insert: {
          amount: number
          balance_after: number
          balance_before: number
          created_at?: string
          description?: string | null
          id?: string
          processed_at?: string | null
          reference_id?: string | null
          related_lottery_id?: string | null
          related_order_id?: string | null
          status?: Database["public"]["Enums"]["TransactionStatus"]
          type: Database["public"]["Enums"]["TransactionType"]
          wallet_id: string
        }
        Update: {
          amount?: number
          balance_after?: number
          balance_before?: number
          created_at?: string
          description?: string | null
          id?: string
          processed_at?: string | null
          reference_id?: string | null
          related_lottery_id?: string | null
          related_order_id?: string | null
          status?: Database["public"]["Enums"]["TransactionStatus"]
          type?: Database["public"]["Enums"]["TransactionType"]
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
          balance: number
          created_at: string
          currency: Database["public"]["Enums"]["Currency"]
          frozen_balance: number
          id: string
          total_deposits: number
          total_withdrawals: number
          type: Database["public"]["Enums"]["WalletType"]
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          balance?: number
          created_at?: string
          currency: Database["public"]["Enums"]["Currency"]
          frozen_balance?: number
          id?: string
          total_deposits?: number
          total_withdrawals?: number
          type: Database["public"]["Enums"]["WalletType"]
          updated_at: string
          user_id: string
          version?: number
        }
        Update: {
          balance?: number
          created_at?: string
          currency?: Database["public"]["Enums"]["Currency"]
          frozen_balance?: number
          id?: string
          total_deposits?: number
          total_withdrawals?: number
          type?: Database["public"]["Enums"]["WalletType"]
          updated_at?: string
          user_id?: string
          version?: number
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
          admin_id: string | null
          admin_note: string | null
          amount: number
          bank_account_name: string | null
          bank_account_number: string | null
          bank_branch: string | null
          bank_name: string | null
          completed_at: string | null
          created_at: string
          currency: string
          id: string
          id_card_name: string | null
          id_card_number: string | null
          mobile_wallet_name: string | null
          mobile_wallet_number: string | null
          order_number: string
          phone_number: string | null
          reviewed_at: string | null
          status: Database["public"]["Enums"]["WithdrawalStatus"]
          transfer_proof_images: Json | null
          transfer_reference: string | null
          updated_at: string
          user_id: string
          withdrawal_method: Database["public"]["Enums"]["WithdrawalMethod"]
        }
        Insert: {
          admin_id?: string | null
          admin_note?: string | null
          amount: number
          bank_account_name?: string | null
          bank_account_number?: string | null
          bank_branch?: string | null
          bank_name?: string | null
          completed_at?: string | null
          created_at?: string
          currency?: string
          id?: string
          id_card_name?: string | null
          id_card_number?: string | null
          mobile_wallet_name?: string | null
          mobile_wallet_number?: string | null
          order_number: string
          phone_number?: string | null
          reviewed_at?: string | null
          status?: Database["public"]["Enums"]["WithdrawalStatus"]
          transfer_proof_images?: Json | null
          transfer_reference?: string | null
          updated_at?: string
          user_id: string
          withdrawal_method: Database["public"]["Enums"]["WithdrawalMethod"]
        }
        Update: {
          admin_id?: string | null
          admin_note?: string | null
          amount?: number
          bank_account_name?: string | null
          bank_account_number?: string | null
          bank_branch?: string | null
          bank_name?: string | null
          completed_at?: string | null
          created_at?: string
          currency?: string
          id?: string
          id_card_name?: string | null
          id_card_number?: string | null
          mobile_wallet_name?: string | null
          mobile_wallet_number?: string | null
          order_number?: string
          phone_number?: string | null
          reviewed_at?: string | null
          status?: Database["public"]["Enums"]["WithdrawalStatus"]
          transfer_proof_images?: Json | null
          transfer_reference?: string | null
          updated_at?: string
          user_id?: string
          withdrawal_method?: Database["public"]["Enums"]["WithdrawalMethod"]
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      approve_withdrawal_request:
        | {
            Args: {
              p_admin_id: string
              p_admin_note?: string
              p_withdrawal_id: string
            }
            Returns: boolean
          }
        | {
            Args: {
              p_admin_id: string
              p_admin_note?: string
              p_withdrawal_id: string
            }
            Returns: boolean
          }
      auto_draw_lotteries: { Args: never; Returns: Json }
      decrement_likes_count: {
        Args: { showoff_id: string }
        Returns: undefined
      }
      decrement_user_balance: {
        Args: { p_amount: number; p_user_id: string }
        Returns: undefined
      }
      draw_lottery: { Args: { p_lottery_id: string }; Returns: Json }
      exchange_real_to_bonus_balance: {
        Args: { p_amount: number; p_user_id: string }
        Returns: number
      }
      generate_pickup_code: { Args: never; Returns: string }
      get_user_referral_stats: {
        Args: { p_user_id: string }
        Returns: {
          bonus_balance: number
          level1_referrals: number
          level2_referrals: number
          level3_referrals: number
          pending_commission: number
          total_commission: number
          total_referrals: number
        }[]
      }
      increment_likes_count: {
        Args: { showoff_id: string }
        Returns: undefined
      }
      increment_sold_quantity: {
        Args: { amount?: number; product_id: string }
        Returns: undefined
      }
      increment_user_balance: {
        Args: { p_amount: number; p_user_id: string }
        Returns: undefined
      }
      place_lottery_order: {
        Args: {
          p_lottery_id: string
          p_ticket_count: number
          p_user_id: string
        }
        Returns: string
      }
      purchase_lottery_atomic: {
        Args: {
          p_lottery_id: string
          p_order_id: string
          p_quantity: number
          p_user_id: string
        }
        Returns: {
          allocated_numbers: Json
          message: string
          success: boolean
        }[]
      }
      reject_withdrawal_request:
        | {
            Args: {
              p_admin_id: string
              p_admin_note?: string
              p_withdrawal_id: string
            }
            Returns: boolean
          }
        | {
            Args: {
              p_admin_id: string
              p_admin_note?: string
              p_withdrawal_id: string
            }
            Returns: boolean
          }
      trigger_commission_for_exchange: {
        Args: { p_amount: number; p_user_id: string }
        Returns: undefined
      }
    }
    Enums: {
      CommentStatus: "PUBLISHED" | "HIDDEN" | "DELETED"
      CommissionStatus: "PENDING" | "PAID" | "CANCELLED"
      CommissionType: "LOTTERY_PURCHASE" | "MARKET_SALE" | "FIRST_PURCHASE"
      Currency: "USD" | "TJS"
      DepositMethod: "ALIF_MOBI" | "DC_BANK" | "OTHER"
      DepositStatus: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED"
      EntryStatus: "ACTIVE" | "TRANSFERRED" | "REFUNDED"
      ExchangeType: "BALANCE_TO_COIN" | "COIN_TO_BALANCE"
      KycLevel: "NONE" | "BASIC" | "INTERMEDIATE" | "ADVANCED"
      LotteryStatus:
        | "UPCOMING"
        | "PENDING"
        | "ACTIVE"
        | "SOLD_OUT"
        | "DRAWING"
        | "COMPLETED"
        | "CANCELLED"
      MarketListingStatus: "ACTIVE" | "SOLD" | "CANCELLED" | "EXPIRED"
      NotificationType:
        | "LOTTERY_RESULT"
        | "LOTTERY_REMINDER"
        | "PAYMENT_SUCCESS"
        | "PAYMENT_FAILED"
        | "MARKET_SOLD"
        | "MARKET_PURCHASED"
        | "REFERRAL_REWARD"
        | "SYSTEM_ANNOUNCEMENT"
        | "ACCOUNT_SECURITY"
        | "SHOWOFF_APPROVED"
        | "SHOWOFF_REJECTED"
        | "GROUP_BUY_WIN"
        | "GROUP_BUY_REFUND"
      OrderStatus:
        | "PENDING"
        | "PAID"
        | "PROCESSING"
        | "COMPLETED"
        | "CANCELLED"
        | "REFUNDED"
        | "FAILED"
      OrderType: "LOTTERY_PURCHASE" | "MARKET_PURCHASE" | "WALLET_RECHARGE"
      PaymentMethod: "BALANCE_WALLET" | "LUCKY_COIN_WALLET" | "EXTERNAL_PAYMENT"
      PostStatus: "DRAFT" | "PUBLISHED" | "HIDDEN" | "DELETED"
      PostType: "SHARE_WIN" | "EXPERIENCE" | "DISCUSSION" | "ANNOUNCEMENT"
      PurchaseStatus: "PENDING" | "COMPLETED" | "CANCELLED" | "FAILED"
      TransactionStatus:
        | "PENDING"
        | "PROCESSING"
        | "COMPLETED"
        | "FAILED"
        | "CANCELLED"
      TransactionType:
        | "DEPOSIT"
        | "WITHDRAWAL"
        | "LOTTERY_PURCHASE"
        | "LOTTERY_REFUND"
        | "LOTTERY_PRIZE"
        | "REFERRAL_BONUS"
        | "COIN_EXCHANGE"
        | "MARKET_PURCHASE"
        | "MARKET_SALE"
        | "ADMIN_ADJUSTMENT"
        | "GROUP_BUY_PURCHASE"
        | "GROUP_BUY_REFUND"
        | "GROUP_BUY_WIN"
      UserStatus: "ACTIVE" | "SUSPENDED" | "BANNED" | "PENDING_VERIFICATION"
      WalletType: "BALANCE" | "LUCKY_COIN"
      WithdrawalMethod: "BANK_TRANSFER" | "ALIF_MOBI" | "DC_BANK" | "OTHER"
      WithdrawalStatus:
        | "PENDING"
        | "APPROVED"
        | "REJECTED"
        | "PROCESSING"
        | "COMPLETED"
        | "CANCELLED"
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
    Enums: {
      CommentStatus: ["PUBLISHED", "HIDDEN", "DELETED"],
      CommissionStatus: ["PENDING", "PAID", "CANCELLED"],
      CommissionType: ["LOTTERY_PURCHASE", "MARKET_SALE", "FIRST_PURCHASE"],
      Currency: ["USD", "TJS"],
      DepositMethod: ["ALIF_MOBI", "DC_BANK", "OTHER"],
      DepositStatus: ["PENDING", "APPROVED", "REJECTED", "CANCELLED"],
      EntryStatus: ["ACTIVE", "TRANSFERRED", "REFUNDED"],
      ExchangeType: ["BALANCE_TO_COIN", "COIN_TO_BALANCE"],
      KycLevel: ["NONE", "BASIC", "INTERMEDIATE", "ADVANCED"],
      LotteryStatus: [
        "UPCOMING",
        "PENDING",
        "ACTIVE",
        "SOLD_OUT",
        "DRAWING",
        "COMPLETED",
        "CANCELLED",
      ],
      MarketListingStatus: ["ACTIVE", "SOLD", "CANCELLED", "EXPIRED"],
      NotificationType: [
        "LOTTERY_RESULT",
        "LOTTERY_REMINDER",
        "PAYMENT_SUCCESS",
        "PAYMENT_FAILED",
        "MARKET_SOLD",
        "MARKET_PURCHASED",
        "REFERRAL_REWARD",
        "SYSTEM_ANNOUNCEMENT",
        "ACCOUNT_SECURITY",
        "SHOWOFF_APPROVED",
        "SHOWOFF_REJECTED",
        "GROUP_BUY_WIN",
        "GROUP_BUY_REFUND",
      ],
      OrderStatus: [
        "PENDING",
        "PAID",
        "PROCESSING",
        "COMPLETED",
        "CANCELLED",
        "REFUNDED",
        "FAILED",
      ],
      OrderType: ["LOTTERY_PURCHASE", "MARKET_PURCHASE", "WALLET_RECHARGE"],
      PaymentMethod: [
        "BALANCE_WALLET",
        "LUCKY_COIN_WALLET",
        "EXTERNAL_PAYMENT",
      ],
      PostStatus: ["DRAFT", "PUBLISHED", "HIDDEN", "DELETED"],
      PostType: ["SHARE_WIN", "EXPERIENCE", "DISCUSSION", "ANNOUNCEMENT"],
      PurchaseStatus: ["PENDING", "COMPLETED", "CANCELLED", "FAILED"],
      TransactionStatus: [
        "PENDING",
        "PROCESSING",
        "COMPLETED",
        "FAILED",
        "CANCELLED",
      ],
      TransactionType: [
        "DEPOSIT",
        "WITHDRAWAL",
        "LOTTERY_PURCHASE",
        "LOTTERY_REFUND",
        "LOTTERY_PRIZE",
        "REFERRAL_BONUS",
        "COIN_EXCHANGE",
        "MARKET_PURCHASE",
        "MARKET_SALE",
        "ADMIN_ADJUSTMENT",
        "GROUP_BUY_PURCHASE",
        "GROUP_BUY_REFUND",
        "GROUP_BUY_WIN",
      ],
      UserStatus: ["ACTIVE", "SUSPENDED", "BANNED", "PENDING_VERIFICATION"],
      WalletType: ["BALANCE", "LUCKY_COIN"],
      WithdrawalMethod: ["BANK_TRANSFER", "ALIF_MOBI", "DC_BANK", "OTHER"],
      WithdrawalStatus: [
        "PENDING",
        "APPROVED",
        "REJECTED",
        "PROCESSING",
        "COMPLETED",
        "CANCELLED",
      ],
    },
  },
} as const
