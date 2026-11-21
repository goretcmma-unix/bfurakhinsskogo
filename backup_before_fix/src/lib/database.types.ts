export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      funds: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          description?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          description?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      categories: {
        Row: {
          id: string;
          fund_id: string;
          name: string;
          type: 'income' | 'expense';
          description: string | null;
          is_active: boolean;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          fund_id: string;
          name: string;
          type: 'income' | 'expense';
          description?: string | null;
          is_active?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          fund_id?: string;
          name?: string;
          type?: 'income' | 'expense';
          description?: string | null;
          is_active?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
      };
      bank_accounts: {
        Row: {
          id: string;
          fund_id: string;
          bank_name: string;
          account_name: string;
          account_number_masked: string;
          currency: string;
          is_active: boolean;
          is_default: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          fund_id: string;
          bank_name: string;
          account_name: string;
          account_number_masked: string;
          currency?: string;
          is_active?: boolean;
          is_default?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          fund_id?: string;
          bank_name?: string;
          account_name?: string;
          account_number_masked?: string;
          currency?: string;
          is_active?: boolean;
          is_default?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      transactions: {
        Row: {
          id: string;
          fund_id: string;
          user_id: string | null;
          transaction_date: string;
          type: 'income' | 'expense';
          amount: number;
          currency: string;
          description: string;
          category_id: string | null;
          sender_name: string | null;
          sender_bank: string | null;
          sender_account_masked: string | null;
          recipient_name: string | null;
          recipient_bank: string | null;
          recipient_account_masked: string | null;
          source_type: 'donation' | 'grant' | 'corporate' | 'event' | 'membership' | 'other' | null;
          comment: string | null;
          document_name: string | null;
          document_path: string | null;
          document_status: 'attached' | 'missing' | 'expected';
          bank_transaction_id: string | null;
          payment_method: 'bank_transfer' | 'cash' | 'card' | 'online' | 'crypto' | 'other' | null;
          is_public: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          fund_id: string;
          user_id?: string | null;
          transaction_date?: string;
          type: 'income' | 'expense';
          amount: number;
          currency?: string;
          description?: string;
          category_id?: string | null;
          sender_name?: string | null;
          sender_bank?: string | null;
          sender_account_masked?: string | null;
          recipient_name?: string | null;
          recipient_bank?: string | null;
          recipient_account_masked?: string | null;
          source_type?: 'donation' | 'grant' | 'corporate' | 'event' | 'membership' | 'other' | null;
          comment?: string | null;
          document_name?: string | null;
          document_path?: string | null;
          document_status?: 'attached' | 'missing' | 'expected';
          bank_transaction_id?: string | null;
          payment_method?: 'bank_transfer' | 'cash' | 'card' | 'online' | 'crypto' | 'other' | null;
          is_public?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          fund_id?: string;
          user_id?: string | null;
          transaction_date?: string;
          type?: 'income' | 'expense';
          amount?: number;
          currency?: string;
          description?: string;
          category_id?: string | null;
          sender_name?: string | null;
          sender_bank?: string | null;
          sender_account_masked?: string | null;
          recipient_name?: string | null;
          recipient_bank?: string | null;
          recipient_account_masked?: string | null;
          source_type?: 'donation' | 'grant' | 'corporate' | 'event' | 'membership' | 'other' | null;
          comment?: string | null;
          document_name?: string | null;
          document_path?: string | null;
          document_status?: 'attached' | 'missing' | 'expected';
          bank_transaction_id?: string | null;
          payment_method?: 'bank_transfer' | 'cash' | 'card' | 'online' | 'crypto' | 'other' | null;
          is_public?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      documents: {
        Row: {
          id: string;
          fund_id: string;
          transaction_id: string;
          name: string;
          storage_path: string;
          mime_type: string;
          size_bytes: number;
          uploaded_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          fund_id: string;
          transaction_id: string;
          name: string;
          storage_path: string;
          mime_type: string;
          size_bytes: number;
          uploaded_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          fund_id?: string;
          transaction_id?: string;
          name?: string;
          storage_path?: string;
          mime_type?: string;
          size_bytes?: number;
          uploaded_by?: string | null;
          created_at?: string;
        };
      };
      organization: {
        Row: {
          id: number;
          fund_id: string;
          name: string;
          mission: string;
          inn: string;
          ogrn: string;
          address: string;
          phone: string;
          email: string;
          website: string;
          donation_url: string;
          updated_at: string;
        };
        Insert: {
          id?: number;
          fund_id: string;
          name?: string;
          mission?: string;
          inn?: string;
          ogrn?: string;
          address?: string;
          phone?: string;
          email?: string;
          website?: string;
          donation_url?: string;
          updated_at?: string;
        };
        Update: {
          id?: number;
          fund_id?: string;
          name?: string;
          mission?: string;
          inn?: string;
          ogrn?: string;
          address?: string;
          phone?: string;
          email?: string;
          website?: string;
          donation_url?: string;
          updated_at?: string;
        };
      };
      user_funds: {
        Row: {
          id: string;
          user_id: string;
          fund_id: string;
          role: 'owner' | 'admin' | 'member' | 'viewer';
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          fund_id: string;
          role?: 'owner' | 'admin' | 'member' | 'viewer';
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          fund_id?: string;
          role?: 'owner' | 'admin' | 'member' | 'viewer';
          is_active?: boolean;
          created_at?: string;
        };
      };
    };
    Views: {
      fund_summary: {
        Row: {
          fund_id: string;
          fund_name: string;
          total_income: number;
          total_expense: number;
          balance: number;
          operations_count: number;
        };
      };
      income_by_source: {
        Row: {
          fund_id: string;
          source_type: 'donation' | 'grant' | 'corporate' | 'event' | 'membership' | 'other' | null;
          total_amount: number;
          count: number;
        };
      };
      expenses_by_category: {
        Row: {
          fund_id: string;
          category_name: string | null;
          category_type: 'income' | 'expense' | null;
          total_amount: number;
          count: number;
        };
      };
      monthly_stats: {
        Row: {
          fund_id: string;
          month: string;
          income: number;
          expense: number;
          net: number;
          operations: number;
        };
      };
      public_stats: {
        Row: {
          donations: number;
          expenses: number;
          balance: number;
          operations: number;
        };
      };
      public_monthly: {
        Row: {
          month: string;
          donations: number;
          expenses: number;
        };
      };
      public_transactions: {
        Row: {
          date: string;
          type: 'income' | 'expense';
          category_id: string | null;
          description: string;
          donor: string | null;
          amount: number;
          document_name: string | null;
          document_status: 'attached' | 'missing' | 'expected';
          payment_method: 'bank_transfer' | 'cash' | 'card' | 'online' | 'crypto' | 'other' | null;
        };
      };
      public_organization: {
        Row: {
          name: string;
          mission: string;
          inn: string;
          ogrn: string;
          address: string;
          phone: string;
          email: string;
          website: string;
          donation_url: string;
        };
      };
    };
    Functions: {
      current_fund_id: {
        Args: Record<PropertyKey, never>;
        Returns: string;
      };
      touch_updated_at: {
        Args: Record<PropertyKey, never>;
        Returns: unknown;
      };
    };
    Enums: {
      fund_role: 'owner' | 'admin' | 'member' | 'viewer';
      transaction_type: 'income' | 'expense';
      category_type: 'income' | 'expense';
      document_status: 'attached' | 'missing' | 'expected';
      source_type: 'donation' | 'grant' | 'corporate' | 'event' | 'membership' | 'other';
      payment_method: 'bank_transfer' | 'cash' | 'card' | 'online' | 'crypto' | 'other';
      transaction_status: 'completed' | 'pending' | 'cancelled';
      donor_type: 'individual' | 'legal';
    };
    CompositeTypes: {
      [key: string]: never;
    };
  };
}