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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      cloud_orders: {
        Row: {
          bill_no: string
          created_at: string
          id: string
          payload: Json
          user_id: string
        }
        Insert: {
          bill_no: string
          created_at?: string
          id?: string
          payload: Json
          user_id: string
        }
        Update: {
          bill_no?: string
          created_at?: string
          id?: string
          payload?: Json
          user_id?: string
        }
        Relationships: []
      }
      inventory_items: {
        Row: {
          id: string
          low_stock_threshold: number
          menu_item_id: string | null
          name: string
          quantity: number
          unit: string
          updated_at: string
          user_id: string
        }
        Insert: {
          id?: string
          low_stock_threshold?: number
          menu_item_id?: string | null
          name: string
          quantity?: number
          unit?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          id?: string
          low_stock_threshold?: number
          menu_item_id?: string | null
          name?: string
          quantity?: number
          unit?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      restaurant_invites: {
        Row: {
          created_at: string
          email: string
          id: string
          invited_by: string | null
          restaurant_id: string
          role: Database["public"]["Enums"]["restaurant_role"]
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          invited_by?: string | null
          restaurant_id: string
          role: Database["public"]["Enums"]["restaurant_role"]
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          invited_by?: string | null
          restaurant_id?: string
          role?: Database["public"]["Enums"]["restaurant_role"]
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_invites_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_members: {
        Row: {
          created_at: string
          display_name: string
          email: string
          restaurant_id: string
          role: Database["public"]["Enums"]["restaurant_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string
          email?: string
          restaurant_id: string
          role: Database["public"]["Enums"]["restaurant_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string
          email?: string
          restaurant_id?: string
          role?: Database["public"]["Enums"]["restaurant_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_members_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_records: {
        Row: {
          deleted: boolean
          kind: string
          payload: Json
          record_id: string
          restaurant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          deleted?: boolean
          kind: string
          payload?: Json
          record_id: string
          restaurant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          deleted?: boolean
          kind?: string
          payload?: Json
          record_id?: string
          restaurant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_records_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      account_events: {
        Row: {
          account_id: string
          amount: number | null
          by_user: string | null
          created_at: string
          detail: Json
          id: number
          kind: string
        }
        Insert: {
          account_id: string
          amount?: number | null
          by_user?: string | null
          created_at?: string
          detail?: Json
          id?: number
          kind: string
        }
        Update: {
          account_id?: string
          amount?: number | null
          by_user?: string | null
          created_at?: string
          detail?: Json
          id?: number
          kind?: string
        }
        Relationships: []
      }
      accounts: {
        Row: {
          billing_email: string
          billing_gstin: string
          billing_phone: string
          created_at: string
          id: string
          name: string
          notes: string
          owner_id: string | null
          paid_until: string | null
          plan_id: string
          status: string
          trial_ends_at: string | null
        }
        Insert: {
          billing_email?: string
          billing_gstin?: string
          billing_phone?: string
          created_at?: string
          id?: string
          name: string
          notes?: string
          owner_id?: string | null
          paid_until?: string | null
          plan_id?: string
          status?: string
          trial_ends_at?: string | null
        }
        Update: {
          billing_email?: string
          billing_gstin?: string
          billing_phone?: string
          created_at?: string
          id?: string
          name?: string
          notes?: string
          owner_id?: string | null
          paid_until?: string | null
          plan_id?: string
          status?: string
          trial_ends_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounts_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      guest_orders: {
        Row: {
          bill_no: string | null
          channel: string
          code: string
          created_at: string
          customer_name: string
          customer_phone: string
          handled_by: string
          id: string
          lines: Json
          note: string
          order_uid: string | null
          payment: string
          pickup_at: string | null
          reason: string
          restaurant_id: string
          status: string
          subtotal: number
          table_id: string | null
          table_label: string | null
          token: string
          upi_ref: string
          updated_at: string
        }
        Insert: {
          bill_no?: string | null
          channel: string
          code: string
          created_at?: string
          customer_name?: string
          customer_phone?: string
          handled_by?: string
          id?: string
          lines: Json
          note?: string
          order_uid?: string | null
          payment?: string
          pickup_at?: string | null
          reason?: string
          restaurant_id: string
          status?: string
          subtotal?: number
          table_id?: string | null
          table_label?: string | null
          token?: string
          upi_ref?: string
          updated_at?: string
        }
        Update: {
          bill_no?: string | null
          channel?: string
          code?: string
          created_at?: string
          customer_name?: string
          customer_phone?: string
          handled_by?: string
          id?: string
          lines?: Json
          note?: string
          order_uid?: string | null
          payment?: string
          pickup_at?: string | null
          reason?: string
          restaurant_id?: string
          status?: string
          subtotal?: number
          table_id?: string | null
          table_label?: string | null
          token?: string
          upi_ref?: string
          updated_at?: string
        }
        Relationships: []
      }
      plans: {
        Row: {
          active: boolean
          features: Json
          id: string
          max_outlets: number
          max_staff: number
          monthly_price: number
          name: string
          sort: number
          yearly_price: number
        }
        Insert: {
          active?: boolean
          features?: Json
          id: string
          max_outlets?: number
          max_staff?: number
          monthly_price?: number
          name: string
          sort?: number
          yearly_price?: number
        }
        Update: {
          active?: boolean
          features?: Json
          id?: string
          max_outlets?: number
          max_staff?: number
          monthly_price?: number
          name?: string
          sort?: number
          yearly_price?: number
        }
        Relationships: []
      }
      platform_admins: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      restaurants: {
        Row: {
          account_id: string | null
          city: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          ordering: Json
          slug: string | null
        }
        Insert: {
          account_id?: string | null
          city?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          ordering?: Json
          slug?: string | null
        }
        Update: {
          account_id?: string | null
          city?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          ordering?: Json
          slug?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "restaurants_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      account_feature: { Args: { _account: string; _feature: string }; Returns: boolean }
      account_is_live: { Args: { _account: string }; Returns: boolean }
      admin_accounts: { Args: never; Returns: Json }
      admin_record_payment: { Args: { _amount: number; _id: string; _months: number; _reference: string }; Returns: string }
      admin_save_plan: {
        Args: { _active: boolean; _features: Json; _id: string; _max_outlets: number; _max_staff: number; _monthly: number; _name: string; _yearly: number }
        Returns: undefined
      }
      admin_update_account: {
        Args: { _id: string; _notes: string; _paid_until: string | null; _plan: string; _status: string; _trial_ends_at: string | null }
        Returns: undefined
      }
      create_outlet: { Args: { _account: string; _city?: string; _copy_from?: string | null; _name: string }; Returns: string }
      guest_order_status: { Args: { _id: string; _token: string }; Returns: Json }
      guest_order_update: { Args: { _cancel?: boolean; _id: string; _token: string; _upi_ref?: string | null }; Returns: string }
      is_account_member: { Args: { _account: string }; Returns: boolean }
      is_account_owner: { Args: { _account: string }; Returns: boolean }
      is_platform_admin: { Args: never; Returns: boolean }
      outlet_sales: {
        Args: { _from: string; _outlets: string[]; _to: string }
        Returns: { aggregator: number; bills: number; day: string; delivery: number; dine_in: number; guest_ordered: number; net: number; restaurant_id: string; takeaway: number; tax: number }[]
      }
      place_guest_order: {
        Args: { _channel: string; _lines: Json; _name: string; _note: string; _payment?: string; _phone: string; _pickup_at?: string | null; _slug: string; _table_id: string | null }
        Returns: Json
      }
      public_storefront: { Args: { _slug: string }; Returns: Json }
      push_menu: { Args: { _from: string; _to: string[] }; Returns: number }
      update_account_billing: { Args: { _account: string; _email: string; _gstin: string; _name: string; _phone: string }; Returns: undefined }
      accept_restaurant_invites: { Args: never; Returns: undefined }
      create_restaurant: { Args: { _name: string }; Returns: string }
      has_restaurant_role: {
        Args: {
          _rid: string
          _roles: Database["public"]["Enums"]["restaurant_role"][]
          _uid: string
        }
        Returns: boolean
      }
      is_member: { Args: { _rid: string; _uid: string }; Returns: boolean }
      is_restaurant_admin: {
        Args: { _restaurant_id: string }
        Returns: boolean
      }
      is_restaurant_member: {
        Args: { _restaurant_id: string }
        Returns: boolean
      }
      remove_member: {
        Args: { _restaurant_id: string; _user_id: string }
        Returns: undefined
      }
      restaurant_role_of: {
        Args: { _restaurant_id: string }
        Returns: Database["public"]["Enums"]["restaurant_role"]
      }
      set_member_role: {
        Args: {
          _restaurant_id: string
          _role: Database["public"]["Enums"]["restaurant_role"]
          _user_id: string
        }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "owner" | "staff"
      restaurant_role: "owner" | "manager" | "cashier" | "captain" | "kitchen"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_role: ["owner", "staff"],
      restaurant_role: ["owner", "manager", "cashier", "captain", "kitchen"],
    },
  },
} as const
