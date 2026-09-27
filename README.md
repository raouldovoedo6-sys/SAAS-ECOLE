# SaaS Frais Scolaires

Architecture complète dans [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Structure

```
supabase/migrations/   Schéma PostgreSQL, RLS, triggers, fonctions RPC
supabase/functions/    Edge Functions (Deno)
frontend/              PWA React + TypeScript
```

## Mise en route

### 1. Backend Supabase

```bash
npm install -g supabase
supabase login
supabase link --project-ref <votre-project-ref>
supabase db push                 # applique toutes les migrations
supabase functions deploy        # déploie toutes les Edge Functions
```

Secrets des Edge Functions (voir `supabase/functions/.env.example`) :

```bash
supabase secrets set CRON_SECRET=... FRONTEND_ORIGIN=https://votre-app.netlify.app
# SMS / WhatsApp : à définir une fois le fournisseur choisi et le compte
# WhatsApp Business Platform validé. Tant qu'ils sont absents, ces canaux
# restent inertes (aucun appel réseau), voir docs/ARCHITECTURE.md.
```

Planifier `process-reminders` et `send-notification-worker` (pg_cron ou
Supabase Scheduled Functions) avec l'en-tête `x-cron-secret: <CRON_SECRET>`.

Créer un premier super administrateur (hors application, directement en
base) :

```sql
insert into platform_admins (user_id) values ('<uuid-auth-users>');
```

### 2. Frontend

```bash
cd frontend
cp .env.example .env   # renseigner VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm install
npm run dev             # développement
npm run build            # build de production (déploiement Netlify)
```

Déploiement Netlify : dossier de build `frontend/dist`, commande de build
`npm run build` avec répertoire de base `frontend`.

## Tests de sécurité

Les migrations ont été validées contre PostgreSQL (isolation inter-écoles,
idempotence des paiements/confirmations/reçus — voir historique de
développement). Avant mise en production, rejouer les 10 tests obligatoires
listés dans `docs/ARCHITECTURE.md` §8.2.
