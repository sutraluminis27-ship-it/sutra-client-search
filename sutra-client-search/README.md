# Sutra Contact Finder
Flow: vault + saved web results (0 credits) → per-company "Search web" button → Serper → pushed to public.web_contacts.
Deploy: GitHub → vercel.com/new (no build). Env vars:
- SERPER_API_KEY
- SUPABASE_URL  = https://wdnklpmhxymvpuidglnk.supabase.co
- SUPABASE_SERVICE_KEY = service_role / secret key (server-only, never in browser)
- ACCESS_CODE = passphrase
Cost: 3-4 Serper credits only when you press Search web.
