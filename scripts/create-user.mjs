// Maak (of werk bij) een gebruiker in de Neon-database.
//
//   node scripts/create-user.mjs <email> <wachtwoord> [naam] [userId]
//   node scripts/create-user.mjs pieter@example.com geheim123 "Pieter" 001
//
// Vereist DATABASE_URL in de environment (Neon connection string). Lokaal:
//   - Windows PowerShell:  $env:DATABASE_URL="postgres://..."; node scripts/create-user.mjs ...
//   - of via Vercel:       vercel env pull .env.local  (dan dotenv laden)
//
// Het wachtwoord wordt gehasht met bcrypt (cost 10) en nooit in plaintext opgeslagen.

import bcrypt from 'bcryptjs';
import { neon } from '@neondatabase/serverless';

const [, , email, wachtwoord, naam, userId = '001'] = process.argv;

if (!email || !wachtwoord) {
  console.error('Gebruik: node scripts/create-user.mjs <email> <wachtwoord> [naam] [userId]');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('FOUT: DATABASE_URL ontbreekt in de environment.');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

// Tabel zekerheidshalve aanmaken zodat het script ook werkt vóór /api/db/migrate is gedraaid.
await sql`
  CREATE TABLE IF NOT EXISTS app_user (
    id              SERIAL PRIMARY KEY,
    email           TEXT UNIQUE NOT NULL,
    wachtwoord_hash TEXT NOT NULL,
    naam            TEXT,
    user_id         TEXT NOT NULL DEFAULT '001',
    created_at      TIMESTAMPTZ DEFAULT NOW()
  )
`;

const hash = await bcrypt.hash(String(wachtwoord), 10);

await sql`
  INSERT INTO app_user (email, wachtwoord_hash, naam, user_id)
  VALUES (${email.toLowerCase().trim()}, ${hash}, ${naam ?? null}, ${userId})
  ON CONFLICT (email) DO UPDATE
    SET wachtwoord_hash = EXCLUDED.wachtwoord_hash,
        naam            = EXCLUDED.naam,
        user_id         = EXCLUDED.user_id
`;

console.log(`✓ Gebruiker ${email.toLowerCase().trim()} aangemaakt/bijgewerkt (userId ${userId}).`);
process.exit(0);
