/// <reference types="vite/client" />

declare const __BUILD_TIME__: string

interface ImportMetaEnv {
  readonly VITE_APP_VERSION?: string
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
  readonly VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY?: string
  readonly NEXT_PUBLIC_SUPABASE_URL?: string
  readonly NEXT_PUBLIC_SUPABASE_ANON_KEY?: string
  readonly NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string
  readonly NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
