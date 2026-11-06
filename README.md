# Sutra Contact Finder
Flow: Supabase vault → saved web results → Serper (only if nothing saved) → results pushed to public.web_contacts.
Deploy: GitHub → vercel.com/new (no build). Env vars:
- SERPER_API_KEY
- SUPABASE_URL  = https://wdnklpmhxymvpuidglnk.supabase.co
- SUPABASE_SERVICE_KEY = service_role / secret key (server-only, never in browser)
- ACCESS_CODE = passphrase
Cost: 3-4 Serper credits per new search; repeats served from Supabase (0).
